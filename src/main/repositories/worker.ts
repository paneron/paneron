// NOTE: This module cannot use electron-log, since it for some reason
// fails to obtain the paths required for file transport to work
// when in Node worker context.

// TODO: Make electron-log work somehow

import { expose } from 'threads/worker';
import { Observable, Subject } from 'threads/observable';
import { ModuleMethods } from 'threads/dist/types/master';

import * as fs from 'fs-extra';
import * as path from 'path';

import * as AsyncLock from 'async-lock';
import * as globby from 'globby';
import { throttle } from 'throttle-debounce';

import git, { ServerRef } from 'isomorphic-git';
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
  ObjectChangeset,
  ObjectData,
  FileChangeType,
  AuthoringGitOperationParams,
  GitOperationParams,
  DatasetOperationParams,
  IndexStatus,
} from '../../repositories/types';

import {
  clone,
  lockFree_getObjectContents,
  getObjectPathsChangedBetweenCommits,
  makeChanges,
  pull,
  push,
  stripLeadingSlash,
  normalizeURL,
  __readFileAt,
} from './git-methods';
import { ObjectDataRequest } from '@riboseinc/paneron-extension-kit/types';
import { SerializableObjectSpec } from '@riboseinc/paneron-extension-kit/types/object-spec';


const gitLock = new AsyncLock({ timeout: 60000, maxPending: 100 });


// TODO: Split methods into sub-modules?

// TODO: Validate that `msg.workDir` is a descendant of a safe directory
// under user’s home?


// Worker API

export interface Methods {
  destroyWorker: () => Promise<void>

  streamStatus: (msg: StatusRequestMessage) => Observable<RepoStatus>


  // Git features

  workingCopyIsValid: (msg: { workDir: string }) => Promise<boolean>

  queryRemote:
    (msg: { url: string, auth: GitAuthentication }) =>
    Promise<{ isBlank: boolean, canPush: boolean }>

  addOrigin:
    (msg: { workDir: string, url: string }) => Promise<{ success: true }>
  deleteOrigin:
    (msg: { workDir: string }) => Promise<{ success: true }>

  init: (msg: InitRequestMessage) => Promise<{ success: true }>
  clone: (msg: CloneRequestMessage) => Promise<{ success: true }>
  pull: (msg: PullRequestMessage) => Promise<{
    success: true
    changedObjects: Record<string, Exclude<FileChangeType, "unchanged">> | null
  }>
  push: (msg: PushRequestMessage) => Promise<{ success: true }>
  delete: (msg: DeleteRequestMessage) => Promise<{ success: true }>


  // Working with structured datasets

  /* Associates object specs with dataset path.
     Specs are used when reading and updating objects and when building indexes.
     Kicks off background (re)building of base object index, if needed.
     Base object index is used when querying objects by path.
  */
  registerObjectSpecs:
    (msg: GitOperationParams & {
      specs: { [datasetDir: string]: SerializableObjectSpec[] }
    }) => void

  /* Returns structured data of objects matching given paths.
     Uses object specs to build objects from buffers. */
  readObjects:
    (msg: GitOperationParams & { objectPaths: string[] }) =>
    Promise<{ [objectPath: string]: Record<string, any> }>

  /* Converts given objects to buffers using previously registered object specs,
     makes changes to buffers in working area, stages, commits, and returns commit hash. */
  updateObjects:
    (msg: AuthoringGitOperationParams & DatasetOperationParams & {
      objectPaths: string[]
      objectData: {
        [objectPath: string]: {
          // A null value below means nonexistend object at this path.
          // newValue: null means delete object, if it exists.
          newValue: Record<string, any> | null
          oldValue?: Record<string, any> | null
          // Undefined oldValue means no consistency check
        }
      }
      commitMessage: string
      _dangerouslySkipValidation: true
    }) =>
    Promise<{ commitHash: string }>


  // Working with indexes

  /* Queues building an index according to given query expression.
     Query expression is evaluated in context of given object data.
     Returns index ID, which can be used to monitor for status. */
  getOrCreateIndex:
    (msg: DatasetOperationParams & { queryExpression: string }) =>
    { indexID: string }

  getIndexStatus:
    (msg: DatasetOperationParams & { indexID: string }) =>
    { status: IndexStatus, stream: Observable<IndexStatus> }


  /* Called when e.g. dataset window is closed. */
  stopIndexing: (msg: DatasetOperationParams) => void

  refreshIndex: (msg: { indexID: string }) => void

  countIndexedObjects:
    (msg: DatasetOperationParams & { indexID: string }) =>
    Promise<{ objectCount: number }>

  getIndexedObjectData:
    (msg: DatasetOperationParams & { indexID: string, start: number, end: number }) =>
    Promise<{ [itemID: number]: { path: string, data: Record<string, any> } }>

  listObjects:
    (msg: DatasetOperationParams & { queryExpression?: string }) =>
    Promise<{ objectPaths: string[] }>


  // Working with raw unstructured data (deprecated/internal)

  getObjectContents: (msg: ObjectDataRequestMessage) =>
    Promise<ObjectDataset>

  getBlobs: (msg: GitOperationParams & { paths: string[] }) =>
    Promise<Record<string, Uint8Array | null>>

  changeObjects: (msg: CommitRequestMessage) => Promise<CommitOutcome>

  deleteTree: (msg: AuthoringGitOperationParams & {
    treeRoot: string
    commitMessage: string
  }) => Promise<CommitOutcome>

  /* Non-recursively lists files and directories under given prefix,
     optionally checking for substring. */
  listObjectPaths: (msg: GitOperationParams & {
    query: {
      pathPrefix: string
      contentSubstring?: string
    }
  }) => Promise<string[]>

  /* Recursively lists files, and checks sync status against latest remote commit (if available).
     Returns { path: sync status } as one big flat object.
     NOTE: Paths are relative to repo root and have leading slashes. */
  listAllObjectPathsWithSyncStatus:
    (msg: GitOperationParams) => Promise<Record<string, FileChangeType>>

  /* Recursively lists files. Returns paths as one big flat list.
     NOTE: Paths are relative to repo root and have leading slashes. */
  listAllObjectPaths:
    (msg: GitOperationParams) => Promise<string[]>


  // These are not supposed to be commonly used.

  _resetUncommittedChanges:
    (msg: GitOperationParams & { pathSpec?: string }) =>
    Promise<{ success: true }>

  _commitAnyOutstandingChanges:
    (msg: AuthoringGitOperationParams & { commitMessage: string }) =>
    Promise<{ newCommitHash: string }>
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
    if (gitLock.isBusy(msg.workDir)) {
      throw new Error("Lock is busy");
    } else {
      fs.remove(msg.workDir);
      return { success: true };
    }
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

  async queryRemote({ url, auth }) {
    const normalizedURL = normalizeURL(url);

    let canPush: boolean;
    let refs: ServerRef[];

    try {
      refs = await git.listServerRefs({
        http,
        url: normalizedURL,
        forPush: true,
        onAuth: () => auth,
        onAuthFailure: () => ({ cancel: true }),
      });
      canPush = true;

    } catch (e) {
      refs = await git.listServerRefs({
        http,
        url: normalizedURL,
        forPush: false,
        onAuth: () => auth,
        onAuthFailure: () => ({ cancel: true }),
      });
      canPush = false;
    }

    const isBlank = refs.length === 0;

    return {
      isBlank,
      canPush,
    }
  },

  async addOrigin({ workDir, url }) {
    await git.addRemote({
      fs,
      dir: workDir,
      remote: 'origin',
      url: normalizeURL(url),
    });
    return { success: true };
  },

  async deleteOrigin({ workDir }) {
    await git.deleteRemote({
      fs,
      dir: workDir,
      remote: 'origin',
    });
    return { success: true };
  },

  async clone(msg) {
    if (gitLock.isBusy(msg.workDir)) {
      throw new Error("Lock is busy");
    }
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

  async getObjectContents2({ workDir, pathPrefix }) {
    const paths = await listAllObjectPaths({ workDir });
    const filteredPaths = pathPrefix
      ? paths.filter(p => p.startsWith(pathPrefix))
      : paths;

    return (await Promise.all(filteredPaths.map(async (path) => {
      const p = pathPrefix
        ? path.replace(pathPrefix, '')
        : path;
      return {
        [p]: await __readFileAt(path, workDir),
      };
    }))).reduce((prev, curr) => ({ ...prev, ...curr }), {});
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

  async listAllObjectPaths({ workDir }) {
    return await listAllObjectPaths({ workDir });
  },

  async deleteTree({ workDir, treeRoot, commitMessage, author }) {
    return await gitLock.acquire(workDir, async () => {

      // This will throw in case something is off
      // and workDir is not a Git repository.
      await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });

      try {
        const fullPath = path.join(workDir, treeRoot);

        await fs.remove(fullPath);

        const WORKDIR = 2, FILE = 0;
        const deletedPaths = (await git.statusMatrix({ fs, dir: workDir })).
          filter(row => row[WORKDIR] === 0).
          filter(row => row[FILE].startsWith(`${treeRoot}/`)).
          map(row => row[FILE]);

        for (const dp of deletedPaths) {
          await git.remove({ fs, dir: workDir, filepath: dp });
        }
      } catch (e) {
        await git.checkout({
          fs,
          dir: workDir,
          force: true,
          filepaths: [treeRoot],
        });
        throw e;
      }

      const newCommitHash = await git.commit({
        fs,
        dir: workDir,
        message: commitMessage,
        author: author,
      });

      return { newCommitHash };
    });
  },

  async _resetUncommittedChanges({ workDir, pathSpec }) {
    await gitLock.acquire(workDir, async () => {
      await git.checkout({
        fs,
        dir: workDir,
        force: true,
        filepaths: pathSpec ? [pathSpec] : undefined,
      });
    });
    return { success: true };
  },

  // WARNING: Stages everything inside given working directory, then commits.
  async _commitAnyOutstandingChanges({ workDir, commitMessage, author }) {
    const repo = { fs, dir: workDir };

    // Add any modified or unstaged files (git add --no-all)
    const modifiedOrUntrackedPaths: string[] =
    await globby(['./**', './**/.*'], {
      gitignore: true,
      cwd: workDir,
    });
    for (const filepath of modifiedOrUntrackedPaths) {
      await git.add({ ...repo, filepath });
    }

    // Delete deleted files (git add -A)
    const removedPaths: string[] =
    await git.statusMatrix(repo).then((status) =>
      status.
        filter(([_1, _2, worktreeStatus]) => worktreeStatus < 1).
        map(([filepath, _1, _2]) => filepath)
    );
    for (const filepath of removedPaths) {
      await git.remove({ ...repo, filepath });
    }

    // Commit staged
    const newCommitHash = await git.commit({
      fs,
      dir: workDir,
      message: commitMessage,
      author,
    });

    return { newCommitHash };
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


async function listAllObjectPaths(opts: { workDir: string }) {
  const { workDir } = opts;
  const latestCommit = await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });
  return Object.entries(await getObjectPathsChangedBetweenCommits(
    latestCommit,
    latestCommit,
    workDir,
    { returnUnchanged: true })).
  filter(([_, status]) => status !== 'removed').
  map(([path, _]) => path);
}


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
