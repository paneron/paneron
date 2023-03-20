import git from 'isomorphic-git';
import fs from 'fs';
import { remove, ensureDir } from 'fs-extra';

import { checkPathIsOccupied } from '../../../main/fs-utils';
import { Git } from '../types';
import { stripLeadingSlash } from '../../../utils';


const validate: Git.WorkDir.Validate = async function ({ workDir }) {
  try {
    await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });
  } catch (e) {
    return false;
  }
  return true;
}


const init: Git.WorkDir.Init = async function ({ workDir, defaultBranch }) {
  if (checkPathIsOccupied(workDir)) {
    throw new Error("Cannot clone into an already existing directory");
  }

  await ensureDir(workDir);

  try {
    await git.init({
      fs,
      dir: workDir,
      defaultBranch,
    });
  } catch (e) {
    await remove(workDir);
    throw e;
  }

  return { success: true };
}


const _delete: Git.WorkDir.Delete = async function ({ workDir }) {
  await remove(workDir);
  return { success: true };
}


const discardUncommitted: Git.WorkDir.DiscardUncommittedChanges = async function ({ workDir, pathSpec }) {
  await git.checkout({
    fs,
    dir: workDir,
    force: true,
    filepaths: pathSpec ? [pathSpec] : undefined,
  });
  return { success: true };
}


export async function getUncommittedObjectPaths(workDir: string): Promise<string[]> {
  // Status natrix row indexes
  const FILEPATH = 0;
  const WORKDIR = 2;
  const STAGE = 3;

  // Status matrix state
  const UNCHANGED = 1;

  const allFiles = await git.statusMatrix({ fs, dir: workDir });

  return allFiles.
    // get changed records relative to HEAD
    filter((row) => row[WORKDIR] > UNCHANGED && row[STAGE] > UNCHANGED).
    // get file paths from records
    map((row) => row[FILEPATH]).
    // normalize leading slash
    map(filepath => `/${stripLeadingSlash(filepath)}`);
}


// WARNING: Stages everything inside given working directory, then commits.
// async function _commitAnyOutstandingChanges({ workDir, commitMessage, author }) {
//   const repo = { fs, dir: workDir };
// 
//   // Add any modified or unstaged files (git add --no-all)
//   const modifiedOrUntrackedPaths: string[] =
//   await globby(['./**', './**/.*'], {
//     gitignore: true,
//     cwd: workDir,
//   });
//   for (const filepath of modifiedOrUntrackedPaths) {
//     await git.add({ ...repo, filepath });
//   }
// 
//   // Delete deleted files (git add -A)
//   const removedPaths: string[] =
//   await git.statusMatrix(repo).then((status) =>
//     status.
//       filter(([_1, _2, worktreeStatus]) => worktreeStatus < 1).
//       map(([filepath, _1, _2]) => filepath)
//   );
//   for (const filepath of removedPaths) {
//     await git.remove({ ...repo, filepath });
//   }
// 
//   // Commit staged
//   const newCommitHash = await git.commit({
//     fs,
//     dir: workDir,
//     message: commitMessage,
//     author,
//   });
// 
//   return { newCommitHash };
// },


export default {
  validate,
  init,
  delete: _delete,
  discardUncommitted,
};
