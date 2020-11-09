// NOTE: This module cannot use electron-log, since it for some reason
// fails to obtain the paths required for file transport to work
// when in Node worker context.

// TODO: Make electron-log work somehow

import { debounce } from 'throttle-debounce';
import { expose } from 'threads/worker';
import { Observable, Subject } from 'threads/observable';
import { ModuleMethods } from 'threads/dist/types/master';

import * as fs from 'fs-extra';
import * as path from 'path';
import * as AsyncLock from 'async-lock';

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

import {
  RepoStatus,
  CloneRequestMessage,
  DeleteRequestMessage,
  PullRequestMessage,
  PushRequestMessage,
  StatusRequestMessage,
  InitRequestMessage,
  CommitRequestMessage,
  ObjectDataRequestMessage,
  ObjectDataset,
  GitAuthentication,
  CommitOutcome,
  ObjectDataRequest,
  ObjectChangeset,
  ObjectData,
  FileChangeType
} from '../../repositories/types';

import {
  clone,
  lockFree_getObjectContents,
  getObjectPathsChangedBetweenCommits,
  makeChanges,
  pull,
  push,
  stripLeadingSlash,
} from './git-methods';


const gitLock = new AsyncLock({ timeout: 12000, maxPending: 1000 });


// TODO: Split methods into sub-modules?

// TODO: Validate that `msg.workDir` is a descendant of a safe directory
// under user’s home?

export interface Methods {
  destroyWorker: () => Promise<void>

  streamStatus: (msg: StatusRequestMessage) => Observable<RepoStatus>

  workingCopyIsValid: (msg: { workDir: string }) => Promise<boolean>

  /* Checks that remote is valid to start sharing. */
  remoteIsValid: (msg: { url: string, auth: GitAuthentication }) => Promise<boolean>

  addOrigin: (msg: { workDir: string, url: string }) => Promise<{ success: true }>

  init: (msg: InitRequestMessage) => Promise<{ success: true }>
  clone: (msg: CloneRequestMessage) => Promise<{ success: true }>
  pull: (msg: PullRequestMessage) => Promise<{
    success: true
    changedObjects: Record<string, Exclude<FileChangeType, "unchanged">> | null
  }>
  push: (msg: PushRequestMessage) => Promise<{ success: true }>
  delete: (msg: DeleteRequestMessage) => Promise<{ success: true }>

  changeObjects: (msg: CommitRequestMessage) => Promise<CommitOutcome>
  getObjectContents: (msg: ObjectDataRequestMessage) => Promise<ObjectDataset>

  /* Non-recursively lists files and directories under given prefix, optionally checking for substring. */
  listObjectPaths: (msg: { workDir: string, query: { pathPrefix: string, contentSubstring?: string } }) => Promise<string[]>

  /* Recursively lists files under given path prefix.
     Returns { path: status } as one big flat object.
     NOTE: paths are relative to repo root and have leading slashes. */
  listAllObjectPathsWithSyncStatus: (msg: { workDir: string }) => Promise<Record<string, FileChangeType>>
}

export type WorkerSpec = ModuleMethods & Methods;


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
  const updaterDebounced = debounce(100, updater);
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


/* Returns true if given path does not exist. */
async function pathIsTaken(path: string): Promise<boolean> {
  let taken: boolean;
  try {
    await fs.stat(path);
    taken = true;
  } catch (e) {
    await fs.ensureDir(path);
    taken = false;
  }
  return taken;
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

  async delete(msg) {
    await gitLock.acquire(msg.workDir, async () => {
      fs.remove(msg.workDir);
    });
    return { success: true };
  },

  async init(msg) {
    await gitLock.acquire(msg.workDir, async () => {
      if (await pathIsTaken(msg.workDir)) {
        throw new Error("Selected directory already exists");
      }
      await fs.ensureDir(msg.workDir);

      try {
        await git.init({
          fs,
          dir: msg.workDir,
          defaultBranch: 'master',
        });
      } catch (e) {
        await fs.remove(msg.workDir);
        throw e;
      }
    });
    return { success: true };
  },

  async remoteIsValid({ url, auth }) {
    const refs = await git.listServerRefs({
      http,
      url: `${url}.git`,
      forPush: true,
      onAuth: () => auth,
      onAuthFailure: () => ({ cancel: true }),
    });
    return refs.length === 0;
  },

  async addOrigin({ workDir, url }) {
    await git.addRemote({
      fs,
      dir: workDir,
      remote: 'origin',
      url: `${url}.git`,
    });
    return { success: true };
  },

  async clone(msg) {
    await gitLock.acquire(msg.workDir, async () => {
      if (await pathIsTaken(msg.workDir)) {
        throw new Error("Cannot clone into an already existing directory");
      }
      await fs.ensureDir(msg.workDir);
      await clone(msg, getRepoStatusUpdater(msg.workDir));
    });
    return { success: true };
  },

  async pull(msg) {
    const { workDir } = msg;

    const changedObjects:
    Record<string, Exclude<FileChangeType, "unchanged">> | null =
    await gitLock.acquire(workDir, async () => {

      return await pull(msg, getRepoStatusUpdater(workDir));

    });
    return { success: true, changedObjects };
  },

  async push(msg) {
    await gitLock.acquire(msg.workDir, async () => {
      return await push(msg, getRepoStatusUpdater(msg.workDir));
    });
    return { success: true };
  },

  async workingCopyIsValid({ workDir }) {
    try {
      await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });
    } catch (e) {
      return false;
    }
    return true;
  },

  async getObjectContents({ workDir, readObjectContents }) {
    return await lockFree_getObjectContents(workDir, readObjectContents);
  },

  async listObjectPaths({ workDir, query }) {
    const pathPrefix = query.pathPrefix.replace(/\/$/, '');
    const items = fs.readdirSync(path.join(workDir, query.pathPrefix), { withFileTypes: true });

    return (items.
      filter(i => {
        if (query.contentSubstring !== undefined && i.isFile()) {
          const contents = fs.readFileSync(path.join(pathPrefix, i.name), { encoding: 'utf-8' })
          return contents.indexOf(query.contentSubstring) >= 0;
        }
        return true;
      }).
      map(i => {
        return `${pathPrefix}/${i.name}`;
      }));
  },

  async listAllObjectPathsWithSyncStatus({ workDir }) {
    const latestCommit = await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });

    let latestCommitInOrigin: string;
    try {
      latestCommitInOrigin = await git.resolveRef({ fs, dir: workDir, ref: 'refs/remotes/origin/master' });
      // TODO: Check that no one else pushed to origin in meantime? Otherwise change status may be confusing
    } catch (e) {
      latestCommitInOrigin = latestCommit;
    }

    return await getObjectPathsChangedBetweenCommits(
      latestCommitInOrigin,
      latestCommit,
      workDir,
      { returnUnchanged: true });
  },

  async changeObjects(msg) {
    const { workDir, writeObjectContents, author, commitMessage, _dangerouslySkipValidation } = msg;

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
          const oldData = await lockFree_getObjectContents(workDir, dataRequest);
          conflicts = canBeApplied(changeset, oldData, !_dangerouslySkipValidation);
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


/* Returns an object where keys are object paths that have conflicts and values are “true”. */
export function canBeApplied(changeset: ObjectChangeset, dataset: ObjectDataset, strict = true): Record<string, true> {
  const dPaths = new Set(Object.keys(dataset));
  const cPaths = new Set(Object.keys(changeset));

  if (dPaths.size !== cPaths.size || JSON.stringify([...dPaths].sort()) !== JSON.stringify([...cPaths].sort())) {
    throw new Error("Cannot compare changeset and dataset containing different sets of object paths");
  }

  const conflicts: Record<string, true> = {};

  for (const path of dPaths) {
    const cRecord = changeset[path];

    // NOTE: Skipping conflict check because old snapshot was not provided
    if (cRecord.oldValue === undefined) {
      if (strict === true) {
        throw new Error("Missing reference value in changeset for comparison");
      } else {
        continue;
      }
    }

    const existingData = dataset[path];

    let referenceData: ObjectData;
    if (cRecord.oldValue === null) {
      referenceData = null;
    } else if (cRecord.encoding === undefined) {
      referenceData = { value: cRecord.oldValue, encoding: undefined };
    } else {
      referenceData = { value: cRecord.oldValue, encoding: cRecord.encoding };
    }

    if (existingData === null || referenceData === null) {
      if (referenceData !== existingData) {
        // Only one is null
        conflicts[path] = true;
      }
    } else {
      if (existingData.encoding === undefined &&
          (referenceData.encoding !== undefined || !_arrayBuffersAreEqual(existingData.value.buffer, referenceData.value.buffer))) {
        // Mismatching binary contents (or reference data encoding is unexpectedly not binary)
        conflicts[path] = true;
      } else if (existingData.encoding !== undefined &&
          (referenceData.encoding === undefined || existingData.value !== referenceData.value)) {
        // Mismatching string contents (or reference data encoding is unexpectedly binary)
        conflicts[path] = true;
      }
    }
  }

  return conflicts;
}

function _arrayBuffersAreEqual(a: ArrayBuffer, b: ArrayBuffer) {
  return _dataViewsAreEqual(new DataView(a), new DataView(b));
}

function _dataViewsAreEqual(a: DataView, b: DataView) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i=0; i < a.byteLength; i++) {
    if (a.getUint8(i) !== b.getUint8(i)) return false;
  }
  return true;
}
