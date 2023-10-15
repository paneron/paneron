import fs from 'fs';
import git, { type ServerRef } from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { normalizeURL } from '../../util';
import type { Git } from '../types';


const ORIGIN_REMOTE_NAME = 'origin';

const HEAD_REF_PREFIX = 'refs/heads/';


const describe: Git.Remotes.Describe = async function ({ url, auth, branchName }) {
  const normalizedURL = normalizeURL(url);

  // TODO(perf): can use getRemoteInfo() to speed up probably.

  // Check if we can push
  let canPush: boolean;
  try {
    await git.listServerRefs({
      http,
      url: normalizedURL,
      forPush: true,
      onAuth: () => auth,
      onAuthFailure: () => { canPush = false; return },
    });
    canPush = true;
  } catch (e) {
    canPush = false;
  }

  // Get basic info
  const branchRefs = await git.listServerRefs({
    http,
    url: normalizedURL,
    forPush: false,
    symrefs: true,
    protocolVersion: 1,
    onAuth: () => auth,
  });

  const isBlank = branchRefs.length === 0;
  const mainBranchRef = getMainBranchRef(branchRefs);
  const mainBranchName = mainBranchRef?.ref.replace(HEAD_REF_PREFIX, '');

  const branchNameRef = branchName
    ? `refs/heads/${branchName.toLowerCase()}`
    : undefined;
  const currentCommit: string | undefined = branchNameRef
    ? branchRefs.find(item => item.ref.toLowerCase() === branchNameRef)?.oid
    : mainBranchRef?.oid;

  return {
    isBlank,
    canPush,
    mainBranchName,
    currentCommit,
    availableBranches: branchRefs.map(r => r.ref.replace(HEAD_REF_PREFIX, '')),
  };
};


const compare: Git.Remotes.Compare = async function ({ url, auth, workDir }) {
  const branchName = await git.currentBranch({ fs, dir: workDir });
  if (!branchName) {
    throw new Error("Local repository is not on a branch");
  }

  const { currentCommit: remoteHead } = await describe({ url, auth, branchName });
  if (!remoteHead) {
    throw new Error("Unable to determine remote’s current commit");
  }

  const localHead = await git.resolveRef({
    fs,
    dir: workDir,
    ref: branchName,
  });
  if (!localHead) {
    throw new Error("Unable to determine current local commit");
  }

  if (localHead !== remoteHead) {
    const mergeBase = await git.findMergeBase({ fs, dir: workDir, oids: [localHead, remoteHead] });
    return { remoteHead, commonAncestor: mergeBase[0] };
  } else {
    throw new Error("Comparing remote: is at same commit, nothing to compare");
  }
}


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
  compare,
  addOrigin,
  deleteOrigin,
};



/**
 * Returns the ref corresponding to the default branch on the remote,
 * which is taken to be whatever HEAD ref points to.
 */
function getMainBranchRef(refs: ServerRef[]): ServerRef | undefined {
  if (refs.length > 0) {
    // Find the commit pointed to by HEAD
    const headRefOid = refs.find(r => r.ref.toLowerCase() === 'head')?.oid;
    if (headRefOid) {
      // Find ref that points to the same commit
      const mainBranchRef = refs.find(r => r.ref.startsWith(HEAD_REF_PREFIX) && r.oid === headRefOid);
      if (mainBranchRef) {
        // Return the ref
        return mainBranchRef;
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
