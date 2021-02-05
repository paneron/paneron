import { ensureFile, removeSync, remove } from 'fs-extra';
import fs from 'fs';
import path from 'path';
import git from 'isomorphic-git';
//import { BufferChangeset } from '@riboseinc/paneron-extension-kit/types/buffers';
//import { AuthoringGitOperationParams, RepoStatusUpdater } from 'repositories/types';
import { Repositories } from '../types';


/* Applies given BufferChangeset and commits changes.
   Does not check for conflicts.

   TODO: Check for conflicts.
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
      filepaths: bufferPaths,
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


export const deleteTree: Repositories.Data.DeleteTree = async function ({
  workDir,
  treeRoot,
  commitMessage,
  author,
}) {
  // This will throw in case something is off
  // and workDir is not a Git repository.
  await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });

  try {
    const fullPath = path.join(workDir, treeRoot);

    await remove(fullPath);

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
}
