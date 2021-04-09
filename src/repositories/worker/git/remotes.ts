import fs from 'fs';
import git, { ServerRef } from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { normalizeURL } from '../../../repositories/main/util';
import { Git } from '../types';


const ORIGIN_REMOTE_NAME = 'origin';


const describe: Git.Remotes.Describe = async function ({ url, auth }) {
  const normalizedURL = normalizeURL(url);

  let canPush: boolean;
  let refs: ServerRef[];

  try {
    refs = await git.listServerRefs({
      http,
      url: normalizedURL,
      forPush: true,
      onAuth: () => auth,
      onAuthFailure: () => ({ cancel: true }),
    });
    canPush = true;

  } catch (e) {
    refs = await git.listServerRefs({
      http,
      url: normalizedURL,
      forPush: false,
      onAuth: () => auth,
      onAuthFailure: () => ({ cancel: true }),
    });
    canPush = false;
  }

  const isBlank = refs.length === 0;

  return {
    isBlank,
    canPush,
  };
};


const addOrigin: Git.Remotes.AddOrigin = async function ({ workDir, url }) {
  await git.addRemote({
    fs,
    dir: workDir,
    remote: ORIGIN_REMOTE_NAME,
    url: normalizeURL(url),
  });
  return { success: true };
}


const deleteOrigin: Git.Remotes.DeleteOrigin = async function ({ workDir }) {
  await git.deleteRemote({
    fs,
    dir: workDir,
    remote: ORIGIN_REMOTE_NAME,
  });
  return { success: true };
}


export default {
  describe,
  addOrigin,
  deleteOrigin,
};
