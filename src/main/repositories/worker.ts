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


const gitLock = new AsyncLock({ timeout: 20000, maxPending: 1000 });


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

  /* Recursively lists files under given path prefix. Returns { path: status } as one big flat object. */
  listAllObjectPathsWithSyncStatus: (msg: { workDir: string }) => Promise<Record<string, FileChangeType>>
}

export type WorkerSpec = ModuleMethods & Methods;


let repositoryStatus: {
  [workingCopyPath: string]: Subject<RepoStatus>
} = {};


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
    for (const subject of Object.values(repositoryStatus)) {
      subject.complete();
    }
  },

  streamStatus(msg) {
    if (!repositoryStatus[msg.workDir]) {
      repositoryStatus[msg.workDir] = new Subject();
      repositoryStatus[msg.workDir].next({
        status: 'ready',
      });
    }
    return Observable.from(repositoryStatus[msg.workDir]);
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

      try {
        await git.clone({
          url: `${msg.repoURL}.git`,
          // ^^ .git suffix is required here:
          // https://github.com/isomorphic-git/isomorphic-git/issues/1145#issuecomment-653819147
          // TODO: Support non-GitHub repositories by removing force-adding this suffix here,
          // and provide migration instructions for Coulomb-based apps that work with GitHub.
          http,
          fs,
          dir: msg.workDir,
          ref: 'master',
          singleBranch: true,
          depth: 5,
          onAuth: () => msg.auth,
          onAuthFailure: () => {
            repositoryStatus[msg.workDir]?.next({
              busy: {
                operation: 'cloning',
                awaitingPassword: true,
              },
            });
            return { cancel: true };
          },
          onProgress: (progress) => {
            repositoryStatus[msg.workDir]?.next({
              busy: {
                operation: 'cloning',
                progress,
              },
            });
          },
        });
        repositoryStatus[msg.workDir]?.next({
          status: 'ready',
        });
      } catch (e) {
        //log.error(`C/db/isogit/worker: Error cloning repository`, e);
        if (e.code !== 'UserCanceledError') {
          repositoryStatus[msg.workDir]?.next({
            busy: {
              operation: 'cloning',
              networkError: true,
            },
          });
        }
        // Clean up failed clone
        fs.removeSync(msg.workDir);
        throw e;
      }
    });
    return { success: true };
  },

  async pull({ workDir, repoURL, auth, author, _presumeCanceledErrorMeansAwaitingAuth }) {
    const changedObjects: Record<string, Exclude<FileChangeType, "unchanged">> | null = await gitLock.acquire(workDir, async () => {

      const oidBeforePull = await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });

      try {
        await git.pull({
          http,
          fs,
          dir: workDir,
          url: `${repoURL}.git`,
          singleBranch: true,
          fastForwardOnly: true,
          author: author,
          onAuth: () => auth,
          onAuthFailure: () => {
            repositoryStatus[workDir]?.next({
              busy: {
                operation: 'pulling',
                awaitingPassword: true,
              },
            });
            return { cancel: true };
          },
          onProgress: (progress) => {
            repositoryStatus[workDir]?.next({
              busy: {
                operation: 'pulling',
                progress,
              },
            });
          },
        });
        repositoryStatus[workDir]?.next({
          status: 'ready',
        });
      } catch (e) {
        //log.error(`C/db/isogit/worker: Error pulling from repository`, e);
        const suppress: boolean =
          (e.code === 'UserCanceledError' && _presumeCanceledErrorMeansAwaitingAuth === true);
        if (!suppress) {
          repositoryStatus[workDir]?.next({
            busy: {
              operation: 'pulling',
              networkError: true,
            },
          });
        }
        throw e;
      }

      const oidAfterPull = await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });

      if (oidAfterPull !== oidBeforePull) {
        try {
          const changeStatus = await getObjectPathsChangedBetweenCommits(oidBeforePull, oidAfterPull, workDir);
          return changeStatus as Record<string, Exclude<FileChangeType, "unchanged">>;
        } catch (e) {
          return null;
        }
      } else {
        return {};
      }

    });
    return { success: true, changedObjects };
  },

  async push({ workDir, repoURL, auth,
      _presumeRejectedPushMeansNothingToPush,
      _presumeCanceledErrorMeansAwaitingAuth }) {
    await gitLock.acquire(workDir, async () => {
      try {
        await git.push({
          http,
          fs,
          dir: workDir,
          url: `${repoURL}.git`,
          onAuth: () => auth,
          onAuthFailure: () => {
            repositoryStatus[workDir]?.next({
              busy: {
                operation: 'pushing',
                awaitingPassword: true,
              },
            });
            return { cancel: true };
          },
          onProgress: (progress) => {
            repositoryStatus[workDir]?.next({
              busy: {
                operation: 'pushing',
                progress,
              },
            });
          },
        });
        repositoryStatus[workDir]?.next({
          status: 'ready',
        });
      } catch (e) {
        //log.error(`C/db/isogit/worker: Error pushing to repository`, e);
        const suppress: boolean =
          (e.code === 'UserCanceledError' && _presumeCanceledErrorMeansAwaitingAuth === true) ||
          (e.code === 'PushRejectedError' && _presumeRejectedPushMeansNothingToPush === true);
        if (!suppress) {
          repositoryStatus[workDir]?.next({
            busy: {
              operation: 'pushing',
              networkError: true,
            },
          });
        }
        throw e;
      }
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
    return await _lockFree_getObjectContents(workDir, readObjectContents);
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

  async changeObjects({ workDir, writeObjectContents, author, commitMessage, _dangerouslySkipValidation }) {
    const objectPaths = Object.keys(writeObjectContents);

    if (objectPaths.length < 1) {
      throw new Error("Nothing to commit");
    }
    if ((author.email || '').trim() === '' || (author.name || '').trim() === '') {
      throw new Error("Missing author information");
    }
    if ((commitMessage || '').trim() === '') {
      throw new Error("Missing commit message");
    }
    if (Object.values(writeObjectContents).find(val => val.encoding !== 'utf-8' && val.encoding !== undefined) !== undefined) {
      throw new Error("Supplied encoding is not supported");
    }

    const result: CommitOutcome = await gitLock.acquire(workDir, async () => {
      repositoryStatus[workDir]?.next({
        busy: {
          operation: 'committing',
        },
      });

      const dataRequest = objectPaths.
      map(p => ({ [p]: writeObjectContents[p].encoding as 'utf-8' })).
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
        repositoryStatus[workDir]?.next({
          status: 'ready',
        });
      }
      let conflicts: Record<string, true>;
      if (!firstCommit) {
        try {
          const oldData = await _lockFree_getObjectContents(workDir, dataRequest);
          conflicts = _canBeApplied(writeObjectContents, oldData, !_dangerouslySkipValidation);
        } catch (e) {
          throw e;
        } finally {
          repositoryStatus[workDir]?.next({
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
      try {
        await Promise.all(objectPaths.map(async (objectPath) => {
          const absolutePath = path.join(workDir, objectPath);
          const { newValue, encoding } = writeObjectContents[objectPath];
          await fs.ensureFile(absolutePath);

          if (newValue === null) {
            fs.removeSync(absolutePath);
          } else {
            if (encoding !== undefined) {
              await fs.writeFile(absolutePath, newValue, { encoding });
            } else {
              await fs.writeFile(absolutePath, Buffer.from(newValue));
            }
          }
        }));

        // TODO: Make sure checkout in catch() block resets staged files as well!
        for (const [path, contents] of Object.entries(writeObjectContents)) {
          const { newValue } = contents;
          if (newValue !== null) {
            await git.add({
              fs,
              dir: workDir,
              filepath: path,
            });
          } else {
            await git.remove({
              fs,
              dir: workDir,
              filepath: path,
            });
          }
        }

        // Check if we can do this
        await git.commit({
          dryRun: true,
          fs,
          dir: workDir,
          message: commitMessage,
          author,
        });

      } catch (e) {
        // Undo changes by resetting to HEAD
        await git.checkout({
          fs,
          dir: workDir,
          force: true,
          filepaths: objectPaths,
        });
        repositoryStatus[workDir]?.next({
          status: 'ready',
        });
        throw e;
      }

      // Make a commit and pray it doesn’t fail
      let newCommitHash: string;
      try {
        newCommitHash = await git.commit({
          fs,
          dir: workDir,
          message: commitMessage,
          author,
        });
      } finally {
        repositoryStatus[workDir]?.next({
          status: 'ready',
        });
      }
      return { newCommitHash, conflicts };
    });

    return result;
  },

}

expose(methods);



async function _lockFree_getObjectContents(workDir: string, readObjectContents: ObjectDataRequest): Promise<ObjectDataset> {
  const currentCommit = await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });

  async function readContentsAtPath
  (path: string, textEncoding?: string): Promise<
      null
      | { value: string, encoding: string }
      | { value: Uint8Array, encoding: undefined }> {
    let blob: Uint8Array;
    try {
      blob = (await git.readBlob({
        fs,
        dir: workDir,
        oid: currentCommit,
        filepath: path,
      })).blob;
    } catch (e) {
      if (e.code === 'NotFoundError') {
        return null;
      } else {
        throw e;
      }
    }
    if (textEncoding === undefined) {
      return { value: blob, encoding: undefined };
    } else {
      return { value: new TextDecoder(textEncoding).decode(blob), encoding: textEncoding };
    }
  }

  return (await Promise.all(Object.entries(readObjectContents).map(async ([path, textEncoding]) => {
    return {
      [path]: await readContentsAtPath(path, textEncoding),
    };
  }))).reduce((prev, curr) => ({ ...prev, ...curr }), {});

}


/* Returns an object where keys are object paths that have conflicts and values are “true”. */
function _canBeApplied(changeset: ObjectChangeset, dataset: ObjectDataset, strict = true): Record<string, true> {
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
          (referenceData.encoding !== undefined || !arrayBuffersAreEqual(existingData.value, referenceData.value))) {
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

function arrayBuffersAreEqual(a: ArrayBuffer, b: ArrayBuffer) {
  return dataViewsAreEqual(new DataView(a), new DataView(b));
}


function dataViewsAreEqual(a: DataView, b: DataView) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i=0; i < a.byteLength; i++) {
    if (a.getUint8(i) !== b.getUint8(i)) return false;
  }
  return true;
}


/* Given two commits, returns a big flat object of paths and their change status.
   Unelss opts.returnUnchanged is true, returned change status cannot be "unchnaged". */
async function getObjectPathsChangedBetweenCommits
(oid1: string, oid2: string, workDir: string, opts?: { returnUnchanged?: boolean }):
Promise<Record<string, FileChangeType>> {
  return git.walk({
    fs,
    dir: workDir,
    trees: [git.TREE({ ref: oid1 }), git.TREE({ ref: oid2 })],
    reduce: async function (parent, children) {
      const reduced = {
        ...(parent || {}),
        ...((children || []).reduce((p, c) => ({ ...p, ...c }), {})),
      };
      return reduced;
    },
    map: async function (filepath, walkerEntry) {
      if (walkerEntry === null) {
        return;
      }
      if (filepath === '.') {
        return;
      }

      const [A, B] = walkerEntry;

      if ((await A.type()) === 'tree' || (await B.type()) === 'tree') {
        return;
      }

      const Aoid = await A.oid();
      const Boid = await B.oid();

      let type: FileChangeType;
      if (Aoid === Boid) {
        if (Aoid === undefined && Boid === undefined) {
          // Well this would be super unexpected!
        }
        // Object at this path did not change.
        if (opts?.returnUnchanged) {
          type = 'unchanged';
        } else {
          return;
        }
      } else if (Aoid === undefined) {
        type = 'added';
      } else if (Boid === undefined) {
        type = 'removed';
      } else {
        type = 'modified';
      }

      return { [`/${filepath}`]: type };
    },
  });
}
