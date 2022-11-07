import type {
  BinaryInvocationRequest,
  ProcessTerminationMetadata,
  SubprocessDescription,
} from '@riboseinc/paneron-extension-kit/types/binary-invocation';
import { makeEndpoint, _ } from '../ipc';


/**
 * Launches a bundled (within Paneron’s own bin) executable and returns subprocess PID.
 * The ID is arbitrary and caller-provided. If ID a
 * 
 * Following limitations apply:
 * - Only string (utf-8) stdout/stderr output is supported.
 * - No stdin is supported.
 * - No IPC messaging, even if the bina
 */
export const execBundled = makeEndpoint.main(
  'execBundled',
  <{ id: string, opts: Pick<BinaryInvocationRequest, 'binaryName' | 'cliArgs' | 'useShell'> }>_,
  <SubprocessDescription>_,
);


/**
 * Given binary filename, returns fullPath
 * or throws an error if said binary cannot be found in Paneron package.
 */
export const describeBundledExecutable = makeEndpoint.main(
  'describeBundledExecutable',
  <{ name: string }>_,
  <{ fullPath: string }>_,
);


/**
 * Returns information about process by its ID.
 * Can be used if a launched bundled executable hangs.
 */
export const describeSubprocess = makeEndpoint.main(
  'describeSubprocess',
  <{ id: string }>_,
  <SubprocessDescription>_,
);


/**
 * Kills subprocess by ID forcefully (SIGKILL).
 * Can be used if a launched bundled executable hangs.
 */
export const killSubprocess = makeEndpoint.main(
  'killSubprocess',
  <{ id: string }>_,
  <{ success: true }>_,
);


/**
 * Called when subprocess emits something.
 * Can be used for monitoring the subprocess.
 */
export const subprocessEvent = makeEndpoint.renderer(
  'subprocessEvent',
  <{ id: string, stdOut?: string, stdErr?: string, termination?: ProcessTerminationMetadata }>_,
);
