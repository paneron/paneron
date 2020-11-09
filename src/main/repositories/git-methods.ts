// NOTE: Functions for use by worker only.

import * as path from 'path';
import * as fs from 'fs-extra';

import git, { WalkerEntry } from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

import { FileChangeType } from '@riboseinc/paneron-extension-kit/types';

import {
  CloneRequestMessage,
  CommitRequestMessage,
  ObjectDataRequest,
  ObjectDataset,
  PullRequestMessage,
  PushRequestMessage,
  RepoStatus,
} from 'repositories/types';


type StatusUpdater = (newStatus: RepoStatus) => void;


export async function clone(opts: CloneRequestMessage, updateStatus: StatusUpdater) {
  try {
    await git.clone({
      url: `${opts.repoURL}.git`,
      // ^^ .git suffix is required here:
      // https://github.com/isomorphic-git/isomorphic-git/issues/1145#issuecomment-653819147
      // TODO: Support non-GitHub repositories by removing force-adding this suffix here,
      // and provide migration instructions for Coulomb-based apps that work with GitHub.
      http,
      fs,
      dir: opts.workDir,
      ref: 'master',
      singleBranch: true,
      depth: 5,
      onAuth: () => opts.auth,
      onAuthFailure: () => {
        updateStatus({
          busy: {
            operation: 'cloning',
            awaitingPassword: true,
          },
        });
        return { cancel: true };
      },
      onProgress: (progress) => {
        updateStatus({
          busy: {
            operation: 'cloning',
            progress,
          },
        });
      },
    });
    updateStatus({
      status: 'ready',
    });
  } catch (e) {
    //log.error(`C/db/isogit/worker: Error cloning repository`, e);
    if (e.code !== 'UserCanceledError') {
      updateStatus({
        busy: {
          operation: 'cloning',
          networkError: true,
        },
      });
    }
    // Clean up failed clone
    fs.removeSync(opts.workDir);
    throw e;
  }
}


export async function makeChanges(opts: CommitRequestMessage, updateStatus: StatusUpdater): Promise<string> {
  const objectPaths = Object.keys(opts.writeObjectContents);
  const changeset = opts.writeObjectContents;

  updateStatus({
    busy: {
      operation: 'committing',
    },
  });

  try {
    await Promise.all(objectPaths.map(async (objectPath) => {
      const absolutePath = path.join(opts.workDir, objectPath);
      const { newValue, encoding } = changeset[objectPath];
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
    for (const [path, contents] of Object.entries(changeset)) {
      const { newValue } = contents;
      if (newValue !== null) {
        await git.add({
          fs,
          dir: opts.workDir,
          filepath: path,
        });
      } else {
        await git.remove({
          fs,
          dir: opts.workDir,
          filepath: path,
        });
      }
    }

    // Check if we can do this
    await git.commit({
      dryRun: true,
      fs,
      dir: opts.workDir,
      message: opts.commitMessage,
      author: opts.author,
    });

  } catch (e) {
    // Undo changes by resetting to HEAD
    // TODO: We could do this at the very end for reliability,
    // if we take note of previous commit and force reset to it (?)
    await git.checkout({
      fs,
      dir: opts.workDir,
      force: true,
      filepaths: objectPaths,
    });
    updateStatus({
      status: 'ready',
    });
    throw e;
  }

  // Make a commit and pray it doesn’t fail
  let newCommitHash: string;
  try {
    newCommitHash = await git.commit({
      fs,
      dir: opts.workDir,
      message: opts.commitMessage,
      author: opts.author,
    });
  } finally {
    updateStatus({
      status: 'ready',
    });
  }

  return newCommitHash;
}


export async function push(opts: PushRequestMessage, updateStatus: StatusUpdater) {
  const {
    repoURL,
    workDir,
    auth,
    _presumeCanceledErrorMeansAwaitingAuth,
    _presumeRejectedPushMeansNothingToPush,
} = opts;

  try {
    await git.push({
      http,
      fs,
      dir: workDir,
      url: `${repoURL}.git`,
      onAuth: () => auth,
      onAuthFailure: () => {
        updateStatus({
          busy: {
            operation: 'pushing',
            awaitingPassword: true,
          },
        });
        return { cancel: true };
      },
      onProgress: (progress) => {
        updateStatus({
          busy: {
            operation: 'pushing',
            progress,
          },
        });
      },
    });
    updateStatus({
      status: 'ready',
    });

  } catch (e) {
    //log.error(`C/db/isogit/worker: Error pushing to repository`, e);
    const suppress: boolean =
      (e.code === 'UserCanceledError' && _presumeCanceledErrorMeansAwaitingAuth === true) ||
      (e.code === 'PushRejectedError' && _presumeRejectedPushMeansNothingToPush === true);
    if (!suppress) {
      updateStatus({
        busy: {
          operation: 'pushing',
          networkError: true,
        },
      });
    } else {
      if (e.code !== 'PushRejectedError') {
        throw e;
      } else {
        updateStatus({
          status: 'ready',
        });
      }
    }
  }

}


export async function pull(opts: PullRequestMessage, updateStatus: StatusUpdater) {
  const oidBeforePull = await git.resolveRef({ fs, dir: opts.workDir, ref: 'HEAD' });

  try {
    await git.pull({
      http,
      fs,
      dir: opts.workDir,
      url: `${opts.repoURL}.git`,
      singleBranch: true,
      fastForwardOnly: true,
      author: opts.author,
      onAuth: () => opts.auth,
      onAuthFailure: () => {
        updateStatus({
          busy: {
            operation: 'pulling',
            awaitingPassword: true,
          },
        });
        return { cancel: true };
      },
      onProgress: (progress) => {
        updateStatus({
          busy: {
            operation: 'pulling',
            progress,
          },
        });
      },
    });
    updateStatus({
      status: 'ready',
    });
  } catch (e) {
    //log.error(`C/db/isogit/worker: Error pulling from repository`, e);
    const suppress: boolean =
      (e.code === 'UserCanceledError' && opts._presumeCanceledErrorMeansAwaitingAuth === true);
    if (!suppress) {
      updateStatus({
        busy: {
          operation: 'pulling',
          networkError: true,
        },
      });
    }
    throw e;
  }

  const oidAfterPull = await git.resolveRef({ fs, dir: opts.workDir, ref: 'HEAD' });

  if (oidAfterPull !== oidBeforePull) {
    try {
      const changeStatus = await getObjectPathsChangedBetweenCommits(
        oidBeforePull,
        oidAfterPull,
        opts.workDir);
      return changeStatus as Record<string, Exclude<FileChangeType, "unchanged">>;
    } catch (e) {
      return null;
    }
  } else {
    return {};
  }
}


/* Reads object data, optionally at specified Git commit hash. */
export async function lockFree_getObjectContents(workDir: string, readObjectContents: ObjectDataRequest, atCommitHash?: string):
Promise<ObjectDataset> {
  const request = Object.entries(readObjectContents).
  map(([path, enc]) => ({ [stripLeadingSlash(path)]: enc })).
  reduce((p, c) => ({ ...p, ...c }), {});

  async function readObject(path: string, textEncoding: 'utf-8' | 'binary'):
  Promise<
    null
    | { value: string, encoding: string }
    | { value: Uint8Array, encoding: undefined }> {

    let blob: Uint8Array | null;
    if (atCommitHash) {
      blob = await __readGitBlobAt(path, atCommitHash, workDir);
    } else {
      blob = await __readFileAt(path, workDir);
    }

    if (blob === null) {
      return blob;
    } else if (textEncoding === 'binary') {
      return { value: blob, encoding: undefined };
    } else {
      return { value: new TextDecoder(textEncoding).decode(blob), encoding: textEncoding };
    }
  }

  return (await Promise.all(Object.entries(request).map(async ([path, textEncoding]) => {
    return {
      [path]: await readObject(path, textEncoding),
    };
  }))).reduce((prev, curr) => ({ ...prev, ...curr }), {});
}


async function __readGitBlobAt(path: string, commitHash: string, workDir: string): Promise<Uint8Array | null> {
  let blob: Uint8Array;
  try {
    blob = (await git.readBlob({
      fs,
      dir: workDir,
      oid: commitHash,
      filepath: path,
    })).blob;
  } catch (e) {
    if (e.code === 'NotFoundError') {
      return null;
    } else {
      throw e;
    }
  }
  return blob;
}

async function __readFileAt
(p: string, workDir: string): Promise<Uint8Array | null> {
  // TODO: Return null if file does not exist
  const fullPath = path.join(workDir, p);
  try {
    return await fs.readFile(fullPath);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null;
    } else {
      throw e;
    }
  }
}


/* Given two commits, returns a big flat object of paths and their change status.
   Unelss opts.returnUnchanged is true, returned change status cannot be "unchnaged". */
export async function getObjectPathsChangedBetweenCommits
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

      const [A, B] = walkerEntry as (WalkerEntry | null)[];

      if ((await A?.type()) === 'tree' || (await B?.type()) === 'tree') {
        return;
      }

      const Aoid = await A?.oid();
      const Boid = await B?.oid();

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



export function stripLeadingSlash(fp: string): string {
  return fp.replace(/^\//, '');
}
