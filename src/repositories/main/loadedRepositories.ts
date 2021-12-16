import fs from 'fs-extra';
import { Subscription } from 'observable-fns';
import { app } from 'electron';
import log from 'electron-log';

import { PathChanges } from '@riboseinc/paneron-extension-kit/types/changes';

import { GitRepository, RepoStatus } from '../types';
import { repositoryBuffersChanged, loadedRepositoryStatusChanged } from '../ipc';

import { getRepoWorkers, RepoWorkers, terminateRepoWorkers } from './workerManager';
import { readRepoConfig } from './readRepoConfig';
import { getAuth } from './remoteAuth';


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

const INITIAL_STATUS: RepoStatus = { busy: { operation: 'initializing' } };


/**
 * Returns loaded repository structure only if it’s already loaded.
 * If not loaded, throws an error and does not cause the repository to load.
 */
export function getLoadedRepository(workDir: string) {
  if (loadedRepositories[workDir]) {
    return loadedRepositories[workDir];
  } else {
    throw new Error("Repository is not loaded");
  }
}


/**
 * Loads a repository, unless it’s already loaded.
 * Loading a repo causes it to sync in background.
 * Unloading can be monitored via loadedRepositoryStatusChanged event.
 *
 * @param workingCopyPath path to Git working directory
 * @returns RepoStatus
 */
export async function loadRepository(workingCopyPath: string): Promise<RepoStatus> {
  if (loadedRepositories[workingCopyPath]) {
    log.silly(
      "Repositories: Load: Already loaded",
      workingCopyPath,
      loadedRepositories[workingCopyPath].latestStatus);
    return loadedRepositories[workingCopyPath].latestStatus ?? { status: 'ready' };
  }

  const loadedSorted = Object.entries(loadedRepositories).
    sort((r1, r2) => r1[1].loadTime > r2[1].loadTime ? -1 : 1);
  for (const [workDir] of loadedSorted.slice(0, MAX_LOADED_REPOSITORIES)) {
    log.debug("Repositories: Load: Unloading first to free resources", workDir, "for", workingCopyPath);
    await unloadRepository(workDir);
  }

  log.silly("Repositories: Load: Reading config", workingCopyPath);

  let repoCfg: GitRepository;
  try {
    repoCfg = await readRepoConfig(workingCopyPath);
  } catch (e) {
    log.warn("Repositories: Configuration for working copy cannot be read.", workingCopyPath);
    return { status: 'invalid-working-copy' };
  }

  log.silly("Repositories: Load: Validating working directory path", workingCopyPath);

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
      log.debug("Repositories: Configuration for working copy exists, but working copy directory is missing. Will attempt to clone again.", workingCopyPath);
      workDirPathExists = false;
      workDirPathIsWorkable = true;
    }
  }

  if (!workDirPathIsWorkable) {
    log.error("Repositories: Working copy in filesystem is invalid (not a directory?)", workingCopyPath);
    return { status: 'invalid-working-copy' };
  }

  async function reportStatus(status: RepoStatus) {
    const statusChanged = (
      JSON.stringify(loadedRepositories[workingCopyPath]?.latestStatus ?? {}) !==
      JSON.stringify(status));
    if (statusChanged) {
      await loadedRepositoryStatusChanged.main!.trigger({
        workingCopyPath,
        status,
      });
    }
    if (loadedRepositories[workingCopyPath]) {
      loadedRepositories[workingCopyPath].latestStatus = status;
    } else {
      statusStream.unsubscribe();
    }
  }

  log.silly("Repositories: Load: Spawning workers", workingCopyPath);

  const workers = await getRepoWorkers(workingCopyPath);

  log.silly("Repositories: Load: Subscribing to status updates", workingCopyPath);

  const statusStream = workers.sync.streamStatus().subscribe(reportStatus);

  loadedRepositories[workingCopyPath] = {
    workers,
    statusStream,
    loadTime: new Date(),
  };

  log.silly("Repositories: Load: Kicking off sync", workingCopyPath);

  syncRepoRepeatedly(workingCopyPath, undefined, workers);

  app.on('quit', () => { unloadRepository(workingCopyPath); });

  log.silly("Repositories: Load: Validating working directory", workingCopyPath);

  const workDirIsValid = await workers.sync.git_workDir_validate({
    workDir: workingCopyPath,
  });

  if (workDirPathExists && !workDirIsValid) {
    log.warn("Repositories: Load: Working copy in filesystem is invalid (not a Git repo?)", workingCopyPath);
    await loadedRepositoryStatusChanged.main!.trigger({
      workingCopyPath,
      status: { busy: { operation: 'initializing' } },
    });
    return INITIAL_STATUS;

  } else {
    log.silly("Repositories: Load: Finishing", workingCopyPath);
    await loadedRepositoryStatusChanged.main!.trigger({
      workingCopyPath,
      status: { status: 'ready' },
    });
    return { status: 'ready' };
  }
}


/**
 * Unload effectively cancels repo status subscription,
 * clears update timeout, terminates workers, and sends an unloaded event.
 *
 * Has no effect if is not loaded.
 */
export async function unloadRepository(workingCopyPath: string) {
  await terminateRepoWorkers(workingCopyPath);

  if (loadedRepositories[workingCopyPath]) {
    loadedRepositories[workingCopyPath].statusStream?.unsubscribe();
    const timeout = loadedRepositories[workingCopyPath].nextSyncTimeout;
    timeout ? clearTimeout(timeout) : void 0;
    delete loadedRepositories[workingCopyPath];
  }

  await loadedRepositoryStatusChanged.main!.trigger({
    workingCopyPath,
    status: { status: 'unloaded' },
  });
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
      repoSyncLog('info', "Not loaded; clearing status cache and aborting sync");
      return await unloadRepository(workingCopyPath);
    } else {
      repoSyncLog('debug', "Checking configuration");
      try {
        repoCfg = await readRepoConfig(workingCopyPath);
        if (!repoCfg.author && repoCfg.remote) {
          repoSyncLog('error', "Configuration is missing author info required for remote sync");
          return await unloadRepository(workingCopyPath);
        }
      } catch (e) {
        repoSyncLog('error', "Configuration cannot be read");
        return await unloadRepository(workingCopyPath);
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
            branch: repoCfg.mainBranch,
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
      if (repoCfg.remote && repoCfg.author) {
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

        repoSyncLog('info', "Finishing sync attempt");

        if (loadedRepositories[workingCopyPath]) {
          repoSyncLog('debug', "Cooldown before next sync", REPOSITORY_SYNC_INTERVAL_MS);
          loadedRepositories[workingCopyPath].nextSyncTimeout = setTimeout(_sync, REPOSITORY_SYNC_INTERVAL_MS);
        }

      } else {
        repoSyncLog('debug', "Remote or author is not specified, cancelling sync");
        return;
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


app.on('quit', async () => {
  for (const workingCopyPath of Object.keys(loadedRepositories)) {
    await unloadRepository(workingCopyPath);
  }
});
