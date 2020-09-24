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
  OriginURLRequestMessage,
  StatusRequestMessage,
  InitRequestMessage,
  CommitRequestMessage,
  ObjectDataRequestMessage,
  ObjectData,
} from '../../repositories/types';


const gitLock = new AsyncLock({ timeout: 20000, maxPending: 4 });


// TODO: Split methods into sub-modules?

// TODO: Validate that `msg.workDir` is a descendant of a safe directory
// under user’s home?

export interface Methods {
  destroyWorker: () => Promise<void>

  streamStatus: (msg: StatusRequestMessage) => Observable<RepoStatus>
  getOriginURL: (msg: OriginURLRequestMessage) => Promise<string | null>

  init: (msg: InitRequestMessage) => Promise<{ success: true }>
  clone: (msg: CloneRequestMessage) => Promise<{ success: true }>
  pull: (msg: PullRequestMessage) => Promise<{ success: true }>
  push: (msg: PushRequestMessage) => Promise<{ success: true }>
  delete: (msg: DeleteRequestMessage) => Promise<{ success: true }>

  changeObjects: (msg: CommitRequestMessage) => Promise<{ newCommitHash: string }>
  getObjectContents: (msg: ObjectDataRequestMessage) => Promise<ObjectData>
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

  async getOriginURL(msg) {
    const origin = (await git.listRemotes({
      fs,
      dir: msg.workDir,
    })).find(r => r.remote === 'origin')?.url;

    return origin || null;
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
    await gitLock.acquire(workDir, async () => {
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
    });
    return { success: true };
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

  async getObjectContents({ workDir, readObjectContents }) {
    const result: ObjectData = await gitLock.acquire(workDir, async () => {
      const currentCommit = await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });

      async function readContentsAtPath(path: string): Promise<string | null> {
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
        return new TextDecoder('utf-8').decode(blob);
      }

      return (await Promise.all(Object.keys(readObjectContents).map(async (path) => {
        return {
          [path]: await readContentsAtPath(path),
        };
      }))).reduce((prev, curr) => ({ ...prev, ...curr }));
    });
    return result;
  },

  async changeObjects({ workDir, writeObjectContents, author, commitMessage }) {
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

    const newCommitHash: string = await gitLock.acquire(workDir, async () => {
      repositoryStatus[workDir]?.next({
        busy: {
          operation: 'committing',
        },
      });

      // Write files
      try {
        await Promise.all(objectPaths.map(async (objectPath) => {
          const absolutePath = path.join(workDir, objectPath);
          const contentsToWrite: string | null = writeObjectContents[objectPath];
          await fs.ensureFile(absolutePath);

          if (contentsToWrite === null) {
            fs.removeSync(absolutePath);
          } else {
            await fs.writeFile(
              absolutePath,
              contentsToWrite,
              { encoding: 'utf-8' });
          }
        }));

        // TODO: Make sure checkout in catch() block resets staged files as well!
        for (const [path, contents] of Object.entries(writeObjectContents)) {
          if (contents !== null) {
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
      let commitHash: string;
      try {
        commitHash = await git.commit({
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
      return commitHash;
    });

    return { newCommitHash };
  },

}

expose(methods);
