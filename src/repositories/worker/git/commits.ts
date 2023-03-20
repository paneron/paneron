import fs from 'fs';
import git, { type ReadCommitResult } from 'isomorphic-git';
import type { CommitMeta } from '../../types';
import type { Repositories } from '../types';


const getCurrentCommit: Repositories.Data.GetCurrentCommit = async function ({ workDir }) {
  return {
    commitHash: await git.resolveRef({
      fs,
      dir: workDir,
      ref: 'HEAD',
    }),
  };
}


const describeCommit: Repositories.Data.DescribeCommit = async function ({ workDir, commitHash }) {
  const { oid, commit } = await git.readCommit({ fs, dir: workDir, oid: commitHash });
  const commitMeta: CommitMeta = {
    hash: oid,
    message: commit.message,
    parents: commit.parent,
  }
  if (commit.committer) {
    commitMeta.committer = {
      name: commit.committer.name,
      email: commit.committer.email,
    }
    commitMeta.committedAt = commit.committer.timestamp;
  }
  if (commit.author) {
    commitMeta.author = {
      name: commit.author.name,
      email: commit.author.email,
    }
    commitMeta.committedAt = commit.author.timestamp;
  }
  return {
    commit: commitMeta,
  };
}
const chooseMostRecentCommit: Repositories.Data.ChooseMostRecentCommit = async function ({ workDir, candidates }) {
  const commits: ReadCommitResult[] = [];

  for (const oid of candidates) {
    const commit = await git.readCommit({ fs, dir: workDir, oid });
    if (commit.commit?.author?.timestamp) {
      commits.push(commit);
    } else {
      console.error("chooseMostRecentCommit: read commit object does not contain a timestamp", oid);
    }
  }

  if (commits.length < 1) {
    throw new Error("Cannot choose most recent commit: no well-formed commits were read from candidates");
  }

  commits.sort((c1, c2) => c2.commit.author.timestamp - c1.commit.author.timestamp);

  return { commitHash: commits[0].oid };
}


export default {
  getCurrentCommit,
  chooseMostRecentCommit,
  describeCommit,
};
