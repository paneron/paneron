import fs from 'fs';
import git, { ServerRef } from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { normalizeURL } from '../../../repositories/main/util';
import { Git } from '../types';


const ORIGIN_REMOTE_NAME = 'origin';

const HEAD_REF_PREFIX = 'refs/heads/';


const describe: Git.Remotes.Describe = async function ({ url, auth }) {
  const normalizedURL = normalizeURL(url);

  let canPush: boolean;
  try {
    await git.listServerRefs({
      http,
      url: normalizedURL,
      forPush: true,
      onAuth: () => auth,
      onAuthFailure: () => ({ cancel: true }),
    });
    canPush = true;
  } catch (e) {
    canPush = false;
  }

  const branchRefs = await git.listServerRefs({
    http,
    url: normalizedURL,
    forPush: false,
    symrefs: true,
    protocolVersion: 1,
    onAuth: () => auth,
    onAuthFailure: () => ({ cancel: true }),
  });

  const isBlank = branchRefs.length === 0;
  const mainBranchName = getMainBranchName(branchRefs);

  return {
    isBlank,
    canPush,
    mainBranchName,
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



function getMainBranchName(refs: ServerRef[]): string | undefined {
  console.debug("Locaing HEAD among refs", refs);
  if (refs.length > 0) {
    const headRefOid = refs.find(r => r.ref.toLowerCase() === 'head')?.oid;
    if (headRefOid) {
      const mainBranchRef = refs.find(r => r.ref.startsWith(HEAD_REF_PREFIX) && r.oid === headRefOid);
      if (mainBranchRef) {
        return mainBranchRef.ref.replace(HEAD_REF_PREFIX, '');
      } else {
        throw new Error("Unable to locate a ref pointing to current HEAD under refs/heads/");
      }
    } else {
      throw new Error("Unable to locate HEAD ref");
    }
  } else {
    return undefined;
  }
}
