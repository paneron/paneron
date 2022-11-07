import fs from 'fs';
import path from 'path';
import { ensureFile, removeSync, remove, move } from 'fs-extra';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

import { BufferChangeset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { formatPointerInfo } from '@riboseinc/isogit-lfs/pointers';
import uploadBlob from '@riboseinc/isogit-lfs/upload';

import { stripLeadingSlash } from 'utils';
import { normalizeURL } from '../../util';
//import { BufferChangeset } from '@riboseinc/paneron-extension-kit/types/buffers';
//import { AuthoringGitOperationParams, RepoStatusUpdater } from 'repositories/types';
import { Repositories } from '../types';


/**
 * Applies given BufferChangeset and commits changes.
 * Does not check for conflicts.
 *
 * NOTE: Does not check for conflicts at this point
 * (`oldValue`s in the changeset are ignored).
 *
 * TODO: Verify preexisting values at physical buffer level as well,
 * or do something about BufferChangeset being passed
 * here with unnecessary `oldValue`s.
 */
export const updateBuffers: Repositories.Data.UpdateBuffersWithStatusReporter = async function (
  opts,
  updateStatus,
) {
  const bufferPaths = Object.keys(opts.bufferChangeset);
  const changeset = opts.bufferChangeset;

  updateStatus({
    busy: {
      operation: 'committing',
    },
  });

  try {
    await Promise.all(bufferPaths.map(async (bufferPath) => {
      const absolutePath = path.join(opts.workDir, bufferPath);
      const { newValue } = changeset[bufferPath];
      await ensureFile(absolutePath);

      if (newValue === null) {
        removeSync(absolutePath);
      } else {
        await fs.promises.writeFile(absolutePath, Buffer.from(newValue));
      }
    }));

    // TODO: Make sure checkout in catch() block resets staged files as well!
    for (const [path, contents] of Object.entries(changeset)) {
      const normalizedPath = stripLeadingSlash(path);
      const { newValue } = contents;
      if (newValue !== null) {
        await git.add({
          fs,
          dir: opts.workDir,
          filepath: normalizedPath,
        });
      } else {
        await git.remove({
          fs,
          dir: opts.workDir,
          filepath: normalizedPath,
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
      filepaths: bufferPaths.map(stripLeadingSlash),
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

  return { newCommitHash };
}


export const addExternalBuffers: Repositories.Data.AddExternalBuffersWithStatusReporter = async function ({
  workDir,
  paths,
  commitMessage,
  author,
  offloadToLFS,
}, updateStatus) {
  const totalPaths = Object.keys(paths).length;

  if (totalPaths < 1) {
    throw new Error("No paths to add were given");
  }

  const bufferChangeset: BufferChangeset = {};


  for (const [idx, [fp, bufferPath]] of Object.entries(paths).entries()) {
    const bufferData = await fs.promises.readFile(fp);

    if (offloadToLFS) {
      updateStatus({
        busy: {
          operation: 'uploading to LFS',
          progress: {
            phase: bufferPath,
            total: totalPaths,
            loaded: idx,
          },
        },
      });
      const pointerInfo = await uploadBlob({
        url: normalizeURL(offloadToLFS.url),
        auth: offloadToLFS.auth,
        http,
      }, bufferData);
      const pointerBuffer = formatPointerInfo(pointerInfo);
      bufferChangeset[bufferPath] = {
        newValue: pointerBuffer,
      };
    } else {
      bufferChangeset[bufferPath] = {
        newValue: bufferData,
      };
    }
  }

  return await updateBuffers({
    workDir,
    author,
    bufferChangeset,
    commitMessage,
  }, updateStatus);
}


export const moveTree: Repositories.Data.MoveTree = async function ({
  workDir,
  oldTreeRoot,
  newTreeRoot,
  commitMessage,
  author,
}) {
  // This will throw in case something is off
  // and workDir is not a Git repository.
  await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });

  const oldTreeRootNormalized = stripLeadingSlash(oldTreeRoot);
  const newTreeRootNormalized = stripLeadingSlash(newTreeRoot);

  try {
    const oldFullPath = path.join(workDir, oldTreeRootNormalized);
    const newFullPath = path.join(workDir, newTreeRootNormalized);

    await move(oldFullPath, newFullPath, { overwrite: false });

    const WORKDIR = 2, FILE = 0;

    const deletedPaths = (await git.statusMatrix({ fs, dir: workDir })).
      filter(row => row[WORKDIR] === 0).
      map(row => stripLeadingSlash(row[FILE])).
      filter(fp => fp.startsWith(`${oldTreeRootNormalized}/`));

    for (const dp of deletedPaths) {
      await git.remove({ fs, dir: workDir, filepath: dp });
    }

    const addedPaths = (await git.statusMatrix({ fs, dir: workDir })).
      filter(row => row[WORKDIR] === 2).
      map(row => stripLeadingSlash(row[FILE])).
      filter(fp => fp.startsWith(`${newTreeRootNormalized}/`));

    for (const ap of addedPaths) {
      await git.add({ fs, dir: workDir, filepath: ap });
    }

  } catch (e) {
    await git.checkout({
      fs,
      dir: workDir,
      force: true,
      filepaths: [oldTreeRootNormalized, newTreeRootNormalized],
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
}


export const deleteTree: Repositories.Data.DeleteTree = async function ({
  workDir,
  treeRoot,
  commitMessage,
  author,
}) {
  // This will throw in case something is off
  // and workDir is not a Git repository.
  await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });

  const treeRootNormalized = stripLeadingSlash(treeRoot);

  try {
    const fullPath = path.join(workDir, treeRootNormalized);

    await remove(fullPath);

    const WORKDIR = 2, FILE = 0;
    const deletedPaths = (await git.statusMatrix({ fs, dir: workDir })).
      filter(row => row[WORKDIR] === 0).
      map(row => stripLeadingSlash(row[FILE])).
      filter(fp => fp.startsWith(`${treeRootNormalized}/`));

    for (const dp of deletedPaths) {
      await git.remove({ fs, dir: workDir, filepath: dp });
    }
  } catch (e) {
    await git.checkout({
      fs,
      dir: workDir,
      force: true,
      filepaths: [treeRootNormalized],
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
}
