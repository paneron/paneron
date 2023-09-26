import fs from 'fs';
import nodePath from 'path';
import { ensureFile, removeSync, remove, move } from 'fs-extra';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

import type { BufferChangeset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { formatPointerInfo } from '@riboseinc/isogit-lfs/pointers';
import uploadBlob from '@riboseinc/isogit-lfs/upload';

import { stripLeadingSlash } from 'utils';
import { deposixifyPath } from '../../../main/fs-utils';
import { normalizeURL } from '../../util';
//import { BufferChangeset } from '@riboseinc/paneron-extension-kit/types/buffers';
//import { AuthoringGitOperationParams, RepoStatusUpdater } from 'repositories/types';
import type { Repositories } from '../types';


/**
 * Applies given `BufferChangeset` and commits changes.
 * Does not check for conflicts.
 *
 * NOTE: Does not check for conflicts at this point
 * (`oldValue`s in the changeset are ignored).
 *
 * TODO: Verify preexisting values at physical buffer level as well,
 * or do something about BufferChangeset being passed
 * here with unnecessary `oldValue`s.
 */
export const updateBuffers: Repositories.Data.UpdateBuffersWithStatusReporter =
async function updateBuffers (
  opts,
  updateStatus,
) {
  const bufferPaths = Object.keys(opts.bufferChangeset);
  const changeset = opts.bufferChangeset;

  if (!opts.branch) {
    throw new Error("Cannot update buffers without branch specified");
  }

  let oldCommitHash: string | undefined;
  try {
    oldCommitHash = (await git.resolveRef({ fs, dir: opts.workDir, ref: opts.branch })) || undefined;
  } catch (e) {
    oldCommitHash = undefined;
  }

  if (opts.initial && oldCommitHash !== undefined) {
    throw new Error("updateBuffer: expecting initial commit, but preexisting commit hash was found");
  } else if (!opts.initial && !oldCommitHash) {
    throw new Error("updateBuffer: no preexisting commit hash was found (not expecting initial commit)");
  }

  updateStatus({
    busy: {
      operation: 'committing',
    },
  });

  try {
    await Promise.all(bufferPaths.map(async (bufferPath) => {
      const absolutePath = nodePath.join(opts.workDir, deposixifyPath(bufferPath));
      const { newValue } = changeset[bufferPath];

      if (newValue !== null) {
        await ensureFile(absolutePath);
        await fs.promises.writeFile(absolutePath, Buffer.from(newValue));
      } else if (!opts.initial) {
        removeSync(absolutePath);
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
      } else if (!opts.initial) {
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
    if (oldCommitHash) {
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
        localHead: oldCommitHash,
      });
    }
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
    updateStatus({
      status: 'ready',
      localHead: newCommitHash,
    });
  } catch (e) {
    if (oldCommitHash) {
      updateStatus({
        status: 'ready',
        localHead: oldCommitHash,
      });
    }
    throw e;
  }

  return { newCommitHash };
}


export const addExternalBuffers: Repositories.Data.AddExternalBuffersWithStatusReporter =
async function addExternalBuffers ({
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


export const moveTree: Repositories.Data.MoveTree =
async function moveTree ({
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
    const oldPathAbsolute = nodePath.join(workDir, deposixifyPath(oldTreeRootNormalized));
    const newPathAbsolute = nodePath.join(workDir, deposixifyPath(newTreeRootNormalized));

    await move(
      oldPathAbsolute,
      newPathAbsolute,
      { overwrite: false },
    );

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


export const deleteTree: Repositories.Data.DeleteTree =
async function deleteTree ({
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
    const absolutePath = nodePath.join(workDir, deposixifyPath(treeRootNormalized));

    await remove(absolutePath);

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
