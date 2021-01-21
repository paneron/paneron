import git from 'isomorphic-git';
import fs from 'fs/promises';
import { remove, ensureDir } from 'fs-extra';

import { checkPathIsOccupied } from 'utils';
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


export default {
  validate,
  init,
  delete: _delete,
};
