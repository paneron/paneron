// NOTE: electron-log cannot be used within a Node worker.
// For some reason it fails to obtain the paths
// required for file transport.

// TODO: Check whether electron-log is broken as of active versions, if yes fix it somehow

import { expose } from 'threads/worker';
import { Observable, Subject } from 'threads/observable';
import { ModuleMethods } from 'threads/dist/types/master';

import AsyncLock from 'async-lock';
import { throttle } from 'throttle-debounce';

import {
  GitOperationParams,
  RepoStatus,
  RepoStatusUpdater,
} from '../types';

import WorkerMethods from './types';

import { getBufferDataset, readBuffers, readBuffersAtVersion } from './buffers/read';
import { deleteTree, moveTree, updateBuffers, addExternalBuffers } from './buffers/update';
import { resolveChanges } from './buffers/list';
import commits from './git/commits';
import remotes from './git/remotes';
import sync from './git/sync';
import workDir from './git/work-dir';


const gitLock = new AsyncLock({ timeout: 60000, maxPending: 100 });


require('events').EventEmitter.defaultMaxListeners = 20;


// TODO: Validate that `msg.workDir` is a descendant of a safe directory
// under user’s home?


type RepoOperation<I extends GitOperationParams, O> =
  (opts: I) => Promise<O>;

type ExposedRepoOperation<I extends GitOperationParams, O> =
  (opts: Omit<I, 'workDir'>) => Promise<O>;

function repoOperation<I extends GitOperationParams, O>(
  func: RepoOperation<I, O>
): ExposedRepoOperation<I, O> {
  return async function (args: Omit<I, 'workDir'>) {
    if (repositoryStatus === null) {
      throw new Error("Repository is not initialized with a working directory");
    }
    const params = {
      ...args,
      workDir: repositoryStatus.workDirPath,
    } as I;
    return await func(params);
  };
}

function lockingRepoOperation<I extends GitOperationParams, O>(
  func: RepoOperation<I, O>,
  lockOpts?: { failIfBusy?: boolean, timeout?: number },
): ExposedRepoOperation<I, O> {
  return repoOperation(async (args) => {
    if (lockOpts?.failIfBusy === true && gitLock.isBusy('1')) {
      throw new Error("Lock is busy");
    }
    // TODO: No need for locking within single-threaded Node worker code
    return await gitLock.acquire('1', async () => {
      return await func(args);
    }, { timeout: lockOpts?.timeout });
  });
}


type RepoOperationWithStatusReporter<I extends GitOperationParams, O> =
  (opts: I, updateStatus: RepoStatusUpdater) => Promise<O>;

function lockingRepoOperationWithStatusReporter<I extends GitOperationParams, O>(
  func: RepoOperationWithStatusReporter<I, O>,
  lockOpts?: { failIfBusy?: boolean, timeout?: number },
): ExposedRepoOperation<I, O> {
  return lockingRepoOperation(async (args) => {
    if (repositoryStatus === null) {
      throw new Error("Repository is not initialized");
    }
    console.debug("Got repository lock");
    return await func(args, getRepoStatusUpdater(repositoryStatus.workDirPath));
  }, lockOpts);
}


/** Worker API */
export type WorkerSpec = ModuleMethods & WorkerMethods;


// Repositories

interface RepositoryStatus {
  workDirPath: string
  statusSubject: Subject<RepoStatus>
  latestStatus: RepoStatus
}

let repositoryStatus: RepositoryStatus | null = null;

function getRepoStatusUpdater(workDir: string) {
  function updater(newStatus: RepoStatus) {
    if (repositoryStatus === null) {
      throw new Error("Repository is not initialized");
    }
    //console.debug("repo status updater: reporting status", workDir, newStatus)
    repositoryStatus.statusSubject.next(newStatus);
  }

  const updaterDebounced = throttle(100, false, updater);

  return (newStatus: RepoStatus) => {
    if (repositoryStatus === null) {
      throw new Error("Repository is not initialized");
    }

    repositoryStatus.latestStatus = newStatus;

    if (newStatus.busy && repositoryStatus?.latestStatus?.busy) {
      return updaterDebounced(newStatus);
    } else {
      updaterDebounced.cancel();
      return updater(newStatus);
    }
  };
}


const methods: WorkerSpec = {

  async destroy() {
    repositoryStatus?.statusSubject.complete();
  },

  initialize({ workDirPath }) {
    if (repositoryStatus !== null && repositoryStatus.workDirPath !== workDirPath) {
      throw new Error("Repository already initialized with a different working directory path");
    }

    if (repositoryStatus?.workDirPath === workDirPath) {
      // Already initialized?
      console.warn("Worker: Repository already initialized", workDirPath);

    } else {
      const defaultStatus: RepoStatus = {
        status: 'ready', // TODO: Should say “initializing”, probably
      };
      repositoryStatus = {
        workDirPath,
        statusSubject: new Subject<RepoStatus>(),
        latestStatus: defaultStatus,
      };
      repositoryStatus.statusSubject.next(defaultStatus);
    }

    return Observable.from(repositoryStatus.statusSubject);
  },


  // Git features

  git_workDir_validate: workDir.validate,

  git_describeRemote: remotes.describe,
  git_addOrigin: repoOperation(remotes.addOrigin),
  git_deleteOrigin: repoOperation(remotes.deleteOrigin),

  git_init: lockingRepoOperation(workDir.init, { failIfBusy: true }),
  git_delete: workDir.delete,

  git_clone: lockingRepoOperationWithStatusReporter(sync.clone, { timeout: 120000 }),
  git_pull: lockingRepoOperationWithStatusReporter(sync.pull),
  git_push: lockingRepoOperationWithStatusReporter(sync.push),


  // Buffer management.
  // TODO: Rename buffers to blobs? They are referred to as “buffers”, but actually we operate on Uint8Array here.

  repo_getCurrentCommit: commits.getCurrentCommit,
  repo_chooseMostRecentCommit: commits.chooseMostRecentCommit,
  repo_updateBuffers: lockingRepoOperationWithStatusReporter(updateBuffers),
  repo_addExternalBuffers: lockingRepoOperationWithStatusReporter(addExternalBuffers),
  repo_readBuffers: repoOperation(readBuffers),
  repo_readBuffersAtVersion: repoOperation(readBuffersAtVersion),
  repo_getBufferDataset: repoOperation(getBufferDataset),
  repo_deleteTree: lockingRepoOperation(deleteTree),
  repo_moveTree: lockingRepoOperation(moveTree),
  repo_resolveChanges: lockingRepoOperation(resolveChanges),

  git_workDir_discardUncommittedChanges: lockingRepoOperation(workDir.discardUncommitted),

}


expose(methods);
