import fsExtra from 'fs-extra';
import fs from 'fs/promises';
import path from 'path';
import git from 'isomorphic-git';
import { BufferChangeset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { AuthoringGitOperationParams, RepoStatusUpdater } from 'repositories/types';


/* Applies given BufferChangeset and commits changes. Does not check for conflicts. */
export async function makeChanges(
  opts: AuthoringGitOperationParams & { bufferChangeset: BufferChangeset, commitMessage: string },
  updateStatus: RepoStatusUpdater,
): Promise<string> {
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
      await fsExtra.ensureFile(absolutePath);

      if (newValue === null) {
        fsExtra.removeSync(absolutePath);
      } else {
        await fs.writeFile(absolutePath, Buffer.from(newValue));
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

  return newCommitHash;
}
