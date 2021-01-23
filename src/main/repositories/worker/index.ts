// NOTE: electron-log cannot be used within a Node worker.
// For some reason it fails to obtain the paths
// required for file transport.

// TODO: Make electron-log work somehow

import { expose } from 'threads/worker';
import { Observable, Subject } from 'threads/observable';
import { ModuleMethods } from 'threads/dist/types/master';

import * as fs from 'fs-extra';
import * as AsyncLock from 'async-lock';
import { throttle } from 'throttle-debounce';

import git from 'isomorphic-git';

import {
  GitOperationParams,
  RepoStatus,
  RepoStatusUpdater,
} from '../../../repositories/types';

import WorkerMethods from './types';

import datasets from './datasets';
import { getObjectDataset } from './objects/read';
import { updateObjects } from './objects/update';
import { getBufferDataset } from './buffers/read';
import { deleteTree, updateBuffers } from './buffers/update';
import remotes from './git/remotes';
import sync from './git/sync';
import workDir from './git/work-dir';


const gitLock = new AsyncLock({ timeout: 60000, maxPending: 100 });


// TODO: Split methods into sub-modules?

// TODO: Validate that `msg.workDir` is a descendant of a safe directory
// under user’s home?


type RepoOperation<T extends GitOperationParams> =
  (opts: T) => any;

function lockingRepoOperation(
  func: RepoOperation<any>,
  lockOpts?: { failIfBusy?: boolean },
): RepoOperation<any> {
  return async function (args: { workDir: string }) {
    if (lockOpts?.failIfBusy === true && gitLock.isBusy(args.workDir)) {
      throw new Error("Lock is busy");
    }
    return await gitLock.acquire(args.workDir, async () => {
      return await func(args);
    });
  }
}


type RepoOperationWithStatusReporter<T extends GitOperationParams> =
  (opts: T, updateStatus: RepoStatusUpdater) => any;

function lockingRepoOperationWithStatusReporter(
  func: RepoOperationWithStatusReporter<any>,
  lockOpts?: { failIfBusy?: boolean },
): RepoOperation<any> {
  return async function (opts: { workDir: string }) {
    if (lockOpts?.failIfBusy === true && gitLock.isBusy(opts.workDir)) {
      throw new Error("Lock is busy");
    }
    return await gitLock.acquire(opts.workDir, async () => {
      return await func(opts, getRepoStatusUpdater(opts.workDir));
    });
  }
}


// Worker API

export type WorkerSpec = ModuleMethods & WorkerMethods;


// Repositories

let repositoryStatus: {
  [workingCopyPath: string]: {
    statusSubject: Subject<RepoStatus>
    latestStatus: RepoStatus
  }
} = {};

function initRepoStatus(workDir: string) {
  const defaultStatus: RepoStatus = {
    status: 'ready',
  };
  repositoryStatus[workDir] = {
    statusSubject: new Subject<RepoStatus>(),
    latestStatus: defaultStatus,
  };
  repositoryStatus[workDir].statusSubject.next(defaultStatus);
}

function getRepoStatusUpdater(workDir: string) {
  if (!repositoryStatus[workDir]) {
    initRepoStatus(workDir);
  }
  function updater(newStatus: RepoStatus) {
    repositoryStatus[workDir].statusSubject.next(newStatus);
  }
  const updaterDebounced = throttle(100, updater);
  return (newStatus: RepoStatus) => {
    repositoryStatus[workDir].latestStatus = newStatus;

    if (newStatus.busy && repositoryStatus[workDir]?.latestStatus?.busy) {
      return updaterDebounced(newStatus);
    } else {
      updaterDebounced.cancel();
      return updater(newStatus);
    }
  };
}


const methods: WorkerSpec = {

  async destroyWorker() {
    for (const { statusSubject } of Object.values(repositoryStatus)) {
      statusSubject.complete();
    }
  },

  streamStatus(msg) {
    initRepoStatus(msg.workDir);
    return Observable.from(repositoryStatus[msg.workDir].statusSubject);
  },


  // Git features

  git_workDir_validate: workDir.validate,

  git_describeRemote: remotes.describe,
  git_addOrigin: remotes.addOrigin,
  git_deleteOrigin: remotes.deleteOrigin,

  git_init: lockingRepoOperation(workDir.init, { failIfBusy: true }),
  git_delete: lockingRepoOperation(workDir.delete, { failIfBusy: true }),

  git_clone: lockingRepoOperationWithStatusReporter(sync.clone),
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

  ds_load: datasets.load,
  ds_unload: datasets.unload,
  ds_updateObjects: updateObjects,
  ds_getObjectDataset: getObjectDataset,

  ds_index_getOrCreateFiltered: datasets.getOrCreateFilteredIndex,
  ds_index_describe: datasets.describeIndex,
  ds_index_getObject: datasets.getIndexedObject,

  repo_updateBuffers: updateBuffers,
  repo_getBufferDataset: getBufferDataset,
  repo_deleteTree: lockingRepoOperation(deleteTree),

  git_workDir_discardUncommittedChanges: lockingRepoOperation(workDir.discardUncommitted),


  // TBD: migration

  async changeObjects(msg) {
    const { workDir, objectChangeset, author, commitMessage, _dangerouslySkipValidation } = msg;

    const onNewStatus = getRepoStatusUpdater(workDir);

    // Isomorphic Git doesn’t like leading slashes in filepath parameter
    // TODO: Should probably catch inconsistent use of slashes earlier and fail loudly?
    const objectPaths = Object.keys(writeObjectContents).map(stripLeadingSlash);
    const changeset = Object.entries(writeObjectContents).
    map(([path, data]) => ({ [stripLeadingSlash(path)]: data })).
    reduce((p, c) => ({ ...p, ...c }), {});

    if (objectPaths.length < 1) {
      throw new Error("Nothing to commit");
    }
    if ((author.email || '').trim() === '' || (author.name || '').trim() === '') {
      throw new Error("Missing author information");
    }
    if ((commitMessage || '').trim() === '') {
      throw new Error("Missing commit message");
    }
    if (Object.values(changeset).find(val => val.encoding !== 'utf-8' && val.encoding !== undefined) !== undefined) {
      throw new Error("Supplied encoding is not supported");
    }

    const result: CommitOutcome = await gitLock.acquire(workDir, async () => {
      onNewStatus({
        busy: {
          operation: 'committing',
        },
      });

      const dataRequest = objectPaths.
      map(p => ({ [p]: !changeset[p].encoding ? 'binary' : changeset[p].encoding } as ObjectDataRequest)).
      reduce((prev, curr) => ({ ...prev, ...curr }));

      let firstCommit = false;
      try {
        await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });
        firstCommit = false;
      } catch (e) {
        if (e.name === 'NotFoundError') {
          // Presume the first commit is being created.
          firstCommit = true;
        } else {
          throw e;
        }
      } finally {
        onNewStatus({
          status: 'ready',
        });
      }
      let conflicts: Record<string, true>;
      if (!firstCommit) {
        try {
          const oldData = await lockFree_readBufferData(workDir, dataRequest);
          conflicts = findConflicts(changeset, oldData, !_dangerouslySkipValidation);
        } catch (e) {
          throw e;
        } finally {
          onNewStatus({
            status: 'ready',
          });
        }
      } else {
        conflicts = {};
      }
      if (Object.keys(conflicts).length > 0) {
        return { newCommitHash: undefined, conflicts };
      }

      // Write objects
      const newCommitHash: string = await makeChanges(
        { ...msg, writeObjectContents: changeset },
        getRepoStatusUpdater(msg.workDir));
      return { newCommitHash, conflicts };
    });

    return result;
  },

}


expose(methods);
