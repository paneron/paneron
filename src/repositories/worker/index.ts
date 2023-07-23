// NOTE: electron-log cannot be used within a Node worker.
// For some reason it fails to obtain the paths
// required for file transport.

// TODO: Check whether electron-log is broken as of active versions, if yes fix it somehow

import { expose } from 'threads/worker';
import { Observable, Subject } from 'threads/observable';
import { type ModuleMethods } from 'threads/dist/types/master';

import { Mutex, withTimeout } from 'async-mutex';
import { throttle } from 'throttle-debounce';

import type {
  GitOperationParams,
  RepoStatus,
  RepoStatusUpdater,
} from '../types';

import WorkerMethods, { RepoUpdate } from './types';

import { getBufferDataset, readBuffers, readBuffersAtVersion } from './buffers/read';
import { deleteTree, moveTree, updateBuffers, addExternalBuffers } from './buffers/update';
import { resolveChanges } from './buffers/list';
import commits from './git/commits';
import remotes from './git/remotes';
import sync from './git/sync';
import workDir from './git/work-dir';


const repoWriteLock = new Mutex();


require('events').EventEmitter.defaultMaxListeners = 20;


type RepoOperation<I extends GitOperationParams, O> =
  (opts: I) => Promise<O>;

/**
 * Operation on an opened local repository.
 * Does not allow “workDir” in input parameters.
 */
type OpenedRepoOperation<I extends GitOperationParams, O> =
  (opts: Omit<I, 'workDir'>) => Promise<O>;

function openedRepoOperation<I extends GitOperationParams, O>(
  func: RepoOperation<I, O>
): OpenedRepoOperation<I, O> {
  return async function (args) {
    if (openedRepository === null) {
      throw new Error("Repository is not opened");
    } else {
      const params = {
        ...args,
        // TODO: Validate that `workDir` is a descendant of a safe directory under user’s home
        workDir: openedRepository.workDirPath,
      } as I;
      return await func(params);
    }
  };
}

/**
 * Some repository operations cannot run in parallel.
 * This includes writing new commits, for example.
 *
 * Even though we have a single worker per working directory,
 * async event loop in worker can result in multiple write operations
 * running simultaneously.
 *
 * This wrapper ensures that wrapped function is run within a lock.
 *
 * It is caller’s responsibility to run only one worker
 * that performs mutating operations per repository.
 */
function lockingRepoOperation<I extends GitOperationParams, O>(
  func: RepoOperation<I, O>,
  lockOpts?: {
    failIfBusy?: boolean

    /** If lock is busy, how long can we wait before starting the operation. */
    timeout?: number
  },
): OpenedRepoOperation<I, O> {
  return openedRepoOperation(async (args) => {
    if (lockOpts?.failIfBusy === true && repoWriteLock.isLocked()) {
      throw new Error("Working directory is locked by another Git operation");
    }
    const timeout = lockOpts?.timeout;
    const lock = timeout
      ? withTimeout(repoWriteLock, timeout)
      : repoWriteLock;
    return await lock.runExclusive(async () => {
      return await func(args);
    });
  });
}


type RepoOperationWithStatusReporter<I extends GitOperationParams, O> =
  (opts: I, updateStatus: RepoStatusUpdater) => Promise<O>;

function lockingRepoOperationWithStatusReporter<I extends GitOperationParams, O>(
  func: RepoOperationWithStatusReporter<I, O>,
  lockOpts?: { failIfBusy?: boolean, timeout?: number },
): OpenedRepoOperation<I, O> {
  return lockingRepoOperation(async (args) => {
    if (openedRepository === null) {
      throw new Error("Repository is not initialized");
    }
    console.debug("Got repository lock");
    return await func(args, getRepoStatusUpdater());
  }, lockOpts);
}


/** Worker API */
export type WorkerSpec = ModuleMethods & WorkerMethods;


// Repositories

let openedRepository: {
  workDirPath: string
  statusSubject: Subject<RepoStatus>
  updateSubject: Subject<RepoUpdate>
  latestStatus: RepoStatus
} | null = null;

function getRepoStatusUpdater() {
  function updater(newStatus: RepoStatus) {
    if (openedRepository === null) {
      throw new Error("Repository is not initialized");
    }
    //console.debug("repo status updater: reporting status", workDir, newStatus)
    openedRepository.statusSubject.next(newStatus);
  }

  const updaterDebounced = throttle(100, false, updater);

  return (newStatus: RepoStatus) => {
    if (openedRepository === null) {
      throw new Error("Repository is not initialized");
    }

    openedRepository.latestStatus = newStatus;

    if (newStatus.busy && openedRepository.latestStatus?.busy) {
      // To avoid excess communication, debounce repeated updates
      // with “busy” status (meaning an operation is in progress).
      updaterDebounced(newStatus);
    } else {
      // Otherwise, revoke debouncer and update immediately.
      updaterDebounced.cancel();
      updater(newStatus);
    }
  };
}


// Main API

const methods: WorkerSpec = {

  async destroy() {
    openedRepository?.statusSubject.complete();
  },

  async openLocalRepo(workDirPath) {
    if (openedRepository !== null && openedRepository.workDirPath !== workDirPath) {
      throw new Error("Repository already initialized with a different working directory path");
    } else if (openedRepository?.workDirPath === workDirPath) {
      // Already opened?
      console.warn("Worker: Repository already initialized", workDirPath);
    } else {
      const defaultStatus: RepoStatus = {
        status: 'ready', // TODO: Should say “initializing”, probably
      };
      openedRepository = {
        workDirPath,
        statusSubject: new Subject<RepoStatus>(),
        updateSubject: new Subject<RepoUpdate>(),
        latestStatus: defaultStatus,
      };
      openedRepository.statusSubject.next(defaultStatus);
    }
  },

  streamStatus() {
    if (openedRepository === null) {
      throw new Error("Repository is not initialized");
    }
    return Observable.from(openedRepository.statusSubject);
  },

  streamChanges() {
    if (openedRepository === null) {
      throw new Error("Repository is not initialized");
    }
    return Observable.from(openedRepository.updateSubject);
  },


  // Git features

  git_workDir_validate: workDir.validate,
  git_delete: workDir.delete,
  git_describeRemote: remotes.describe,

  git_init: lockingRepoOperation(workDir.init, { failIfBusy: true }),
  git_addOrigin: openedRepoOperation(remotes.addOrigin),
  git_deleteOrigin: openedRepoOperation(remotes.deleteOrigin),
  git_clone: lockingRepoOperationWithStatusReporter(sync.clone, { timeout: 120000 }),
  git_pull: lockingRepoOperationWithStatusReporter(sync.pull),
  git_push: lockingRepoOperationWithStatusReporter(sync.push),


  // Buffer management.
  // TODO: Rename buffers to blobs? They are referred to as “buffers”, but actually we operate on Uint8Array here.

  repo_getCurrentCommit: openedRepoOperation(commits.getCurrentCommit),
  repo_describeCommit: openedRepoOperation(commits.describeCommit),
  repo_undoLatestCommit: lockingRepoOperation(commits.undoLatest, { failIfBusy: true }),
  repo_listCommits: openedRepoOperation(commits.listCommits),
  repo_chooseMostRecentCommit: openedRepoOperation(commits.chooseMostRecentCommit),
  repo_updateBuffers: lockingRepoOperationWithStatusReporter(updateBuffers),
  repo_addExternalBuffers: lockingRepoOperationWithStatusReporter(addExternalBuffers),
  repo_readBuffers: openedRepoOperation(readBuffers),
  repo_readBuffersAtVersion: openedRepoOperation(readBuffersAtVersion),
  repo_getBufferDataset: openedRepoOperation(getBufferDataset),
  repo_deleteTree: lockingRepoOperation(deleteTree),
  repo_moveTree: lockingRepoOperation(moveTree),
  repo_resolveChanges: lockingRepoOperation(resolveChanges),

  git_workDir_discardUncommittedChanges: lockingRepoOperation(workDir.discardUncommitted),

}

expose(methods);
