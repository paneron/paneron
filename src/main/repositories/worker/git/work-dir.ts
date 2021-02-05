import git from 'isomorphic-git';
import fs from 'fs';
import { remove, ensureDir } from 'fs-extra';

import { checkPathIsOccupied } from 'checkPathIsOccupied';
import { Git } from '../types';


const validate: Git.WorkDir.Validate = async function ({ workDir }) {
  try {
    await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' });
  } catch (e) {
    return false;
  }
  return true;
}


const init: Git.WorkDir.Init = async function ({ workDir }) {
  if (checkPathIsOccupied(workDir)) {
    throw new Error("Cannot clone into an already existing directory");
  }

  await ensureDir(workDir);

  try {
    await git.init({
      fs,
      dir: workDir,
      defaultBranch: 'master',
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
