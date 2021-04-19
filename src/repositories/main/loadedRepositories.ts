import fs from 'fs-extra';
import { Subscription } from 'observable-fns';
import { app } from 'electron';
import log from 'electron-log';

import { PathChanges } from '@riboseinc/paneron-extension-kit/types/changes';

import { GitRepository, RepoStatus } from '../types';
import { repositoryBuffersChanged, repositoryStatusChanged } from '../ipc';

import { getRepoWorkers, RepoWorkers, terminateRepoWorkers } from './workerManager';
import { readRepoConfig } from './readRepoConfig';
import { getAuth } from './repoAuth';


const loadedRepositories: {
  [workingCopyPath: string]: {
    workers: RepoWorkers;
    loadTime: Date;

    statusStream: Subscription<RepoStatus>;
    // This status is set by subscription to worker events and is not to be relied on.
    latestStatus?: RepoStatus;

    nextSyncTimeout?: ReturnType<typeof setTimeout>;
  };
} = {};


const MAX_LOADED_REPOSITORIES: number = 1;


export function getLoadedRepository(workDir: string) {
  if (loadedRepositories[workDir]) {
    return loadedRepositories[workDir];
  } else {
    throw new Error("Repository is not loaded");
  }
}


export async function loadRepository(workingCopyPath: string): Promise<RepoStatus> {
  if (loadedRepositories[workingCopyPath]) {
    log.debug("Repositories: Load: Already loaded", workingCopyPath, loadedRepositories[workingCopyPath]?.latestStatus);
    return loadedRepositories[workingCopyPath]?.latestStatus || { status: 'ready' };
  }

  const loadedSorted = Object.entries(loadedRepositories).
    sort((r1, r2) => r1[1].loadTime > r2[1].loadTime ? -1 : 1);
  for (const [workDir] of loadedSorted.slice(0, MAX_LOADED_REPOSITORIES)) {
    log.debug("Repositories: Load: Unloading first to free resources", workDir, workingCopyPath);
    await unloadRepository(workDir);
  }

  log.debug("Repositories: Load: Reading config", workingCopyPath);

  let repoCfg: GitRepository;
  try {
    repoCfg = await readRepoConfig(workingCopyPath);
  } catch (e) {
    log.warn("Repositories: Configuration for working copy cannot be read.", workingCopyPath);
    return { status: 'invalid-working-copy' };
  }

  log.debug("Repositories: Load: Validating working directory path", workingCopyPath);

  let workDirPathExists: boolean;
  let workDirPathIsWorkable: boolean;
  try {
    workDirPathIsWorkable = (await fs.stat(workingCopyPath)).isDirectory() === true;
    workDirPathExists = true;
  } catch (e) {
    if (!repoCfg.remote?.url) {
      log.error("Repositories: Configuration for working copy exists, but working copy directory is missing and no remote is specified.", workingCopyPath);
      return { status: 'invalid-working-copy' };
    } else {
      log.warn("Repositories: Configuration for working copy exists, but working copy directory is missing. Will attempt to clone again.", workingCopyPath);
      workDirPathExists = false;
      workDirPathIsWorkable = true;
    }
  }

  if (!workDirPathIsWorkable) {
    log.error("Repositories: Working copy in filesystem is invalid (not a directory?)", workingCopyPath);
    return { status: 'invalid-working-copy' };
  }

  async function reportStatus(status: RepoStatus) {
    if (loadedRepositories[workingCopyPath]) {
      const statusChanged = (
        JSON.stringify(loadedRepositories[workingCopyPath].latestStatus) !==
        JSON.stringify(status));
      if (statusChanged) {
        await repositoryStatusChanged.main!.trigger({
          workingCopyPath,
          status,
        });
      }
      loadedRepositories[workingCopyPath].latestStatus = status;
    } else {
      streamSubscription.unsubscribe();
    }
  }

  log.debug("Repositories: Load: Spawning workers", workingCopyPath);

  const workers = await getRepoWorkers(workingCopyPath);

  log.debug("Repositories: Load: Initializing read worker", workingCopyPath);

  workers.reader.initialize({ workDirPath: workingCopyPath });

  log.debug("Repositories: Load: Initializing sync worker & subscribing to status updates", workingCopyPath);

  const streamSubscription = workers.sync.
    initialize({ workDirPath: workingCopyPath }).
    subscribe(reportStatus);

  loadedRepositories[workingCopyPath] = {
    workers,
    statusStream: streamSubscription,
    loadTime: new Date(),
  };

  log.debug("Repositories: Load: Kicking off sync", workingCopyPath);

  syncRepoRepeatedly(workingCopyPath, undefined, workers);

  app.on('quit', () => { unloadRepository(workingCopyPath); });

  log.debug("Repositories: Load: Validating working directory", workingCopyPath);

  const workDirIsValid = await workers.sync.git_workDir_validate({
    workDir: workingCopyPath,
  });

  if (workDirPathExists && !workDirIsValid) {
    log.warn("Repositories: Working copy in filesystem is invalid (not a Git repo?)", workingCopyPath);
    return { busy: { operation: 'initializing' } };
  } else {
    log.debug("Repositories: Load: Finishing", workingCopyPath);
    return { status: 'ready' };
  }
}


/* Cancels repo status subscription, clears update timeout, and removes status. */
export async function unloadRepository(workingCopyPath: string) {
  loadedRepositories[workingCopyPath]?.statusStream?.unsubscribe();
  const timeout = loadedRepositories[workingCopyPath]?.nextSyncTimeout;
  timeout ? clearTimeout(timeout) : void 0;
  delete loadedRepositories[workingCopyPath];
  await terminateRepoWorkers(workingCopyPath);
}


// Sync sequence

const REPOSITORY_SYNC_INTERVAL_MS = 5000;
const REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS = 15000;

// TODO: Only sync a repository if one of its datasets is opened?
function syncRepoRepeatedly(
  workingCopyPath: string,
  logLevel: 'all' | 'warnings' = 'warnings',
  workers: RepoWorkers,
): void {
  const repoSyncLog: (
    meth: 'silly' | 'debug' | 'info' | 'warn' | 'error',
    ...args: Parameters<typeof log.debug>
  ) => ReturnType<typeof log.debug> = (meth, ...args) => {
    const _msg = args.shift();
    const doLog = (
      logLevel === 'all' ||
      logLevel === 'warnings' && (meth === 'warn' || meth === 'error'));
    if (doLog) {
      const msg = `Repositories: Syncing ${workingCopyPath}: ${_msg}`;
      log[meth](msg, ...args);
    }
  };

  async function _sync(): Promise<void> {
    const w = workers.sync;

    repoSyncLog('info', "Beginning sync attempt");

    // Do our best to avoid multiple concurrent sync runs on one repo and clear sync timeout, if exists.
    const timeout = loadedRepositories[workingCopyPath]?.nextSyncTimeout;
    timeout ? clearTimeout(timeout) : void 0;

    // 1. Check that repository is OK.
    // If something is broken or operation in latest status snapshot
    // indicates that we are awaiting user input, clear status and cancel further sync.
    // If latest operation indicates we are awaiting user input, skip sync during this run.

    // 1.1. Check configuration
    let repoCfg: GitRepository | null;
    if (!loadedRepositories[workingCopyPath]) {
      repoSyncLog('warn', "Removing status and aborting sync");
      return unloadRepository(workingCopyPath);
    } else {
      repoSyncLog('debug', "Checking configuration");
      try {
        repoCfg = await readRepoConfig(workingCopyPath);
        if (!repoCfg.author) {
          repoSyncLog('error', "Configuration is missing author info");
          return unloadRepository(workingCopyPath);
        }
      } catch (e) {
        repoSyncLog('error', "Configuration cannot be read");
        return unloadRepository(workingCopyPath);
      }

      const isBusy = loadedRepositories[workingCopyPath].latestStatus?.busy;
      switch (isBusy?.operation) {
        case 'pulling':
        case 'pushing':
        case 'cloning':
          if (isBusy.awaitingPassword) {
            repoSyncLog('warn', "An operation is already in progress", JSON.stringify(isBusy.operation));
            return;
          }
      }
      repoSyncLog('debug', "No operation is in progress, proceeding…");
    }

    // 1.2. Check that working copy is OK.
    // If copy is missing, skip sync during this run and try to re-clone instead.
    try {
      await fs.stat(workingCopyPath);
    } catch (e) {
      repoSyncLog('warn', "Working copy path failed to stat", e);
      if (repoCfg.remote) {
        repoSyncLog('info', "Attempting to re-clone");
        const auth = await getAuth(repoCfg.remote.url, repoCfg.remote.username);
        try {
          await w.git_clone({
            repoURL: repoCfg.remote.url,
            auth,
          });
          await repositoryBuffersChanged.main!.trigger({
            workingCopyPath,
          });
        } catch (e) {
          repoSyncLog('error', "Re-cloning failed", e);
        }
      }
      if (loadedRepositories[workingCopyPath]) {
        repoSyncLog('error', "Working copy path doesn’t stat and remote is not specified, cancelling sync");
        // repoSyncLog('debug', "Cooldown before next sync", REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS);
        // loadedRepositories[workingCopyPath].nextSyncTimeout = setTimeout(_sync, REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS);
      }
      return;
    }


    // 2. Perform actual sync.
    try {
      if (repoCfg.remote) {
        const auth = await getAuth(repoCfg.remote.url, repoCfg.remote.username);

        repoSyncLog('info', "Got auth data; pulling…");

        const { oidBeforePull, oidAfterPull } = await w.git_pull({
          repoURL: repoCfg.remote.url,
          auth,
          author: repoCfg.author,
          _presumeCanceledErrorMeansAwaitingAuth: true,
        });

        repoSyncLog('info', `Pull completed: from ${oidBeforePull} to ${oidAfterPull}`);

        if (repoCfg.remote.writeAccess) {
          repoSyncLog('debug', "Got write access; pushing…");
          await w.git_push({
            repoURL: repoCfg.remote.url,
            auth,
            _presumeRejectedPushMeansNothingToPush: true,
            _presumeCanceledErrorMeansAwaitingAuth: true,
          });
        }

        repoSyncLog('info', "Finishing sync attemtp");

        if (loadedRepositories[workingCopyPath]) {
          repoSyncLog('debug', "Cooldown before next sync", REPOSITORY_SYNC_INTERVAL_MS);
          loadedRepositories[workingCopyPath].nextSyncTimeout = setTimeout(_sync, REPOSITORY_SYNC_INTERVAL_MS);
        }

      } else {
        repoSyncLog('error', "Remote is not specified, cancelling sync");
        // repoSyncLog('debug', "Cooldown before next sync", REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS);
        // if (loadedRepositories[workingCopyPath]) {
        //   loadedRepositories[workingCopyPath].nextSyncTimeout = setTimeout(_sync, REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS);
        // }
      }

    } catch (e) {
      repoSyncLog('error', "Sync failed", e);
      repoSyncLog('debug', "Cooldown before next sync", REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS);
      if (loadedRepositories[workingCopyPath]) {
        loadedRepositories[workingCopyPath].nextSyncTimeout = setTimeout(_sync, REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS);
      }
    }
  }

  repoSyncLog('debug', "Scheduling sync immediately");
  const timeout = loadedRepositories[workingCopyPath]?.nextSyncTimeout;
  timeout ? clearTimeout(timeout) : void 0;
  if (loadedRepositories[workingCopyPath]) {
    loadedRepositories[workingCopyPath].nextSyncTimeout = setTimeout(_sync, 100);
  }
}


export async function reportBufferChanges(
  workingCopyPath: string,
  changedPaths: PathChanges,
) {
  if (Object.keys(changedPaths).length > 0) {
    await repositoryBuffersChanged.main!.trigger({
      workingCopyPath,
      changedPaths,
    });
  }
}


app.on('quit', () => {
  for (const workingCopyPath of Object.keys(loadedRepositories)) {
    unloadRepository(workingCopyPath);
  }
});
