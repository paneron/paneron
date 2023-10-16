import fs from 'fs';
import git, { type ReadCommitResult } from 'isomorphic-git';
//import http from 'isomorphic-git/http/node';
import type { CommitMeta } from '../../types';
import type { Repositories } from '../types';
import remotes from './remotes';
import workDirUtils, { getUncommittedObjectPaths } from './work-dir';


const getCurrentCommit: Repositories.Data.GetCurrentCommit = async function ({ workDir, branch }) {
  return {
    commitHash: await git.resolveRef({
      fs,
      dir: workDir,
      ref: branch ?? 'HEAD',
    }),
    // Alternative:
    // fs.readFileSync(
    //   path.join(workDir, '.git', 'refs', 'heads', branch),
    //   { encoding: 'utf-8' },
    // ).trim()
  };
}


const listCommits: Repositories.Data.ListCommits = async function ({ workDir }) {
  const commits = await git.log({ fs, dir: workDir, depth: 50 });
  return { commitHashes: commits.map(c => c.oid) };
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


const undoLatest: Repositories.Data.UndoCommit = async function ({ workDir, commitHash, remoteURL, auth }) {
  const { oid, commit } = await git.readCommit({ fs, dir: workDir, oid: commitHash });
  if (oid !== commitHash) {
    throw new Error("Mismatching object type (should be final commit hash, got possibly symref)");
  }

  if (commit.parent.length !== 1) {
    throw new Error("Specified commit has unexpected number of parents");
  }
  const parent = commit.parent[0];
  if (!parent.trim()) {
    throw new Error("Malformed parent commit");
  }

  const { commitHash: latestCommit } = await getCurrentCommit({ workDir });

  if (oid !== latestCommit) {
    throw new Error("Specified commit is not the latest local commit");
  }

  if (remoteURL) {
    // If remote is configured, check that commits were not pushed yet.
    //
    // TODO: If there is no connection during this operation, this undo/reset will fail
    // because we can’t check that commits were not pushed.
    // This is not good in case the user is working offline, and doesn’t have to worry
    // about pushed commits. Detect that scenario?
    const { currentCommit: latestRemoteCommit } = await remotes.describe({ url: remoteURL, auth });
    if (latestRemoteCommit) {
      if (latestCommit === latestRemoteCommit) {
        throw new Error("Latest local commit already exists in remote");
      } else if (!(await git.isDescendent({ fs, dir: workDir, oid: latestCommit, ancestor: latestRemoteCommit }))) {
        throw new Error("Latest local commit is not a descendant of the latest remote commit");
      } else {
        await resetToCommit(parent, workDir);
      }
    } else {
      throw new Error("Couldn’t check latest commit in remote’s HEAD");
    }
  } else {
    // If there’s no remote configured, just do the reset without safety check for unpushed commits
    await resetToCommit(parent, workDir);
  }

  return { newCommitHash: parent };
}


export const resetTo: Repositories.Data.ResetToCommit = async function ({ workDir, commitHash }) {
  await resetToCommit(commitHash, workDir);
  return { newCommitHash: commitHash };
}


async function resetToCommit(commitHash: string, workDir: string) {
  if ((await getUncommittedObjectPaths(workDir)).length > 0) {
    throw new Error("Uncommitted changes detected, won’t reset");
  }

  const branchName = await git.currentBranch({ fs, dir: workDir });
  if (!branchName) {
    throw new Error("Not on a branch, won’t reset");
  }

  // Write specified commit hash as current branch HEAD
  const refPath = nodePath.join(workDir, '.git', 'refs', 'heads', branchName);
  await fs.promises.writeFile(refPath, commitHash);

  // Clear index (though there shouldn’t be anything because we checked for uncommitted files)
  const indexPath = nodePath.join(workDir, '.git', 'index');
  await fs.promises.unlink(indexPath);

  // Check out current branch
  await git.checkout({ fs, dir: workDir, ref: branchName, force: true });

  // Leftovers
  await workDirUtils.discardUncommitted({ workDir });
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
  resetTo,
  chooseMostRecentCommit,
  listCommits,
  describeCommit,
  undoLatest,
};
