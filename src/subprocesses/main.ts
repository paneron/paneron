import path from 'path';
import fs from 'fs';
import { ChildProcessByStdio, spawn } from 'child_process';
import { Readable } from 'stream';
import { throttle } from 'throttle-debounce';
import { ProcessTerminationMetadata, SubprocessDescription } from '@riboseinc/paneron-extension-kit/types/binary-invocation';
import { describeBundledExecutable, describeSubprocess, execBundled, killSubprocess, subprocessEvent } from '.';


interface SubprocessRegistry {
  [id: string]: {
    handle: ChildProcessByStdio<null, Readable, Readable>
  } & SubprocessDescription
}
const SUBPROCESSES: SubprocessRegistry = {};


function getPlatformSpecificBundledBinaryPath(binaryName: string): string {
  return path.join(process.resourcesPath, 'bin', binaryName);
}


function withoutHandle(sp: SubprocessDescription): SubprocessDescription {
  const { pid, opts, stdout, stderr, termination } = sp;
  return { pid, opts, stdout, stderr, termination };
}


describeBundledExecutable.main!.handle(async ({ name }) => {
  const filePath = getPlatformSpecificBundledBinaryPath(name);
  const stat = fs.statSync(filePath);
  if (stat.isFile()) {
    return { fullPath: filePath };
  } else {
    throw new Error("Executable is not a file");
  }
});


execBundled.main!.handle(async ({ id, opts: { binaryName, cliArgs, useShell } }) => {
  return await new Promise((resolve, reject) => {
    const previouslySpawned = SUBPROCESSES[id];

    if (previouslySpawned && previouslySpawned.termination !== undefined) {
      throw new Error("Process is already running");
    }

    function _notifyRenderer(opts: { stdOut: string } | { stdErr: string } | { termination: ProcessTerminationMetadata }) {
      subprocessEvent.main!.trigger({
        id,
        ...opts,
      });
    }
    const notifyRenderer = throttle(500, false, _notifyRenderer);

    const sp = spawn(
      getPlatformSpecificBundledBinaryPath(binaryName),
      cliArgs,
      { shell: useShell, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });

    SUBPROCESSES[id] = {
      handle: sp,
      pid: sp.pid ?? -1,
      stdout: '',
      stderr: '',
      opts: {
        binaryName,
        cliArgs,
        useShell,
      },
    };

    sp.stdout.setEncoding('utf8');
    sp.stderr.setEncoding('utf8');

    sp.once('spawn', () => {
      if (!sp.pid) {
        reject(`Failed to spawn (no PID in spawn handler)`);
      } else {
        SUBPROCESSES[id].pid = sp.pid;
        resolve(SUBPROCESSES[id]);
      }
    });

    sp.once('error', err => {
      const errS = err.toString();
      if (!sp.pid) {
        const termination = { code: null, signal: null, error: errS };
        SUBPROCESSES[id].termination = termination;
        notifyRenderer({ termination });
        reject(`Failed to spawn (${errS})`);
      }
    });

    sp.once('close', (code, signal) => {
      if (SUBPROCESSES[id].termination?.error === null) {
        const termination = { code, signal, error: null };
        notifyRenderer({ termination });
        SUBPROCESSES[id].termination = termination;
      }
    });

    sp.stdout.on('data', (data) => {
      SUBPROCESSES[id].stdout += data;
      notifyRenderer({ stdOut: SUBPROCESSES[id].stdout });
    });

    sp.stderr.on('data', (data) => {
      SUBPROCESSES[id].stderr += data;
      notifyRenderer({ stdErr: SUBPROCESSES[id].stderr });
    });

    return { pid: SUBPROCESSES[id].pid };

  });
});


describeSubprocess.main!.handle(async ({ id }) => {
  const spawned = SUBPROCESSES[id];
  if (spawned) {
    return withoutHandle(spawned);
  } else {
    throw new Error("Unable to find spawned subprocess");
  }
});


killSubprocess.main!.handle(async ({ id }) => {
  const spawned = SUBPROCESSES[id];
  if (spawned) {
    spawned.handle.kill();
  } else {
    throw new Error("Unable to find spawned subprocess");
  }
  return { success: true };
});
