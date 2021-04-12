// NOTE: electron-log cannot be used within a Node worker.
// For some reason it fails to obtain the paths
// required for file transport.

// TODO: Make electron-log work somehow

import path from 'path';
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
import { deleteTree, updateBuffers } from './buffers/update';
import { resolveChanges } from './buffers/list';
import remotes from './git/remotes';
import sync from './git/sync';
import workDir from './git/work-dir';


const gitLock = new AsyncLock({ timeout: 60000, maxPending: 100 });


require('events').EventEmitter.defaultMaxListeners = 20;


// TODO: Split methods into sub-modules?

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


// Worker API

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
    console.debug("repo status updater: reporting status", workDir, newStatus)
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
      console.warn("Repository already initialized", workDirPath);

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

  //async pull(msg) {
  //  const { workDir } = msg;

  //  const changedBuffers:
  //  Record<string, ChangeStatus> | null =
  //    await gitLock.acquire(workDir, async () => {
  //      return await sync.pull(msg, getRepoStatusUpdater(workDir));
  //    });

  //  return { success: true, changedBuffers };
  //},


  // Working with structured data

  repo_updateBuffers: lockingRepoOperationWithStatusReporter(updateBuffers),
  repo_readBuffers: ({ workDir, rootPath }) =>
    readBuffers(path.join(workDir, rootPath)),
  repo_readBuffersAtVersion: ({ workDir, rootPath, commitHash }) =>
    readBuffersAtVersion(workDir, path.join(workDir, rootPath), commitHash),
  repo_getBufferDataset: getBufferDataset,
  repo_deleteTree: lockingRepoOperation(deleteTree),
  repo_resolveChanges: lockingRepoOperation(resolveChanges),

  git_workDir_discardUncommittedChanges: lockingRepoOperation(workDir.discardUncommitted),


  // TBD: migration

  // async changeObjects(msg) {
  //   const { workDir, objectChangeset, author, commitMessage, _dangerouslySkipValidation } = msg;

  //   const onNewStatus = getRepoStatusUpdater(workDir);

  //   // Isomorphic Git doesn’t like leading slashes in filepath parameter
  //   // TODO: Should probably catch inconsistent use of slashes earlier and fail loudly?
  //   const objectPaths = Object.keys(writeObjectContents).map(stripLeadingSlash);
  //   const changeset = Object.entries(writeObjectContents).
  //   map(([path, data]) => ({ [stripLeadingSlash(path)]: data })).
  //   reduce((p, c) => ({ ...p, ...c }), {});

  //   if (objectPaths.length < 1) {
  //     throw new Error("Nothing to commit");
  //   }
  //   if ((author.email || '').trim() === '' || (author.name || '').trim() === '') {
  //     throw new Error("Missing author information");
  //   }
  //   if ((commitMessage || '').trim() === '') {
  //     throw new Error("Missing commit message");
  //   }
  //   if (Object.values(changeset).find(val => val.encoding !== 'utf-8' && val.encoding !== undefined) !== undefined) {
  //     throw new Error("Supplied encoding is not supported");
  //   }

  //   const result: CommitOutcome = await gitLock.acquire(workDir, async () => {
  //     onNewStatus({
  //       busy: {
  //         operation: 'committing',
  //       },
  //     });

  //     const dataRequest = objectPaths.
  //     map(p => ({ [p]: !changeset[p].encoding ? 'binary' : changeset[p].encoding } as ObjectDataRequest)).
  //     reduce((prev, curr) => ({ ...prev, ...curr }));

  //     let firstCommit = false;
  //     try {
  //       await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });
  //       firstCommit = false;
  //     } catch (e) {
  //       if (e.name === 'NotFoundError') {
  //         // Presume the first commit is being created.
  //         firstCommit = true;
  //       } else {
  //         throw e;
  //       }
  //     } finally {
  //       onNewStatus({
  //         status: 'ready',
  //       });
  //     }
  //     let conflicts: Record<string, true>;
  //     if (!firstCommit) {
  //       try {
  //         const oldData = await lockFree_readBufferData(workDir, dataRequest);
  //         conflicts = findConflicts(changeset, oldData, !_dangerouslySkipValidation);
  //       } catch (e) {
  //         throw e;
  //       } finally {
  //         onNewStatus({
  //           status: 'ready',
  //         });
  //       }
  //     } else {
  //       conflicts = {};
  //     }
  //     if (Object.keys(conflicts).length > 0) {
  //       return { newCommitHash: undefined, conflicts };
  //     }

  //     // Write objects
  //     const newCommitHash: string = await makeChanges(
  //       { ...msg, writeObjectContents: changeset },
  //       getRepoStatusUpdater(msg.workDir));
  //     return { newCommitHash, conflicts };
  //   });

  //   return result;
  // },

}


expose(methods);
