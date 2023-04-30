// NOTE: Functions for use by worker only.

import fs from 'fs';
import { removeSync, ensureDir } from 'fs-extra';

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

import type {
  CloneRequestMessage,
  PullRequestMessage,
  PushRequestMessage,
  RepoStatusUpdater,
} from 'repositories/types';
import { checkPathIsOccupied } from '../../../main/fs-utils';
import { normalizeURL } from '../../util';
import type { Git, WithStatusUpdater } from '../types';


//import getDecoder from './decoders';
//const UTF_DECODER = getDecoder('utf-8');


const clone: WithStatusUpdater<Git.Sync.Clone> = async function (
  opts: CloneRequestMessage,
  updateStatus: RepoStatusUpdater,
) {
  if (checkPathIsOccupied(opts.workDir)) {
    throw new Error("Cannot clone into an already existing directory");
  }

  await ensureDir(opts.workDir);
  try {
    await git.clone({
      url: normalizeURL(opts.repoURL),
      // ^^ .git suffix is required here:
      // https://github.com/isomorphic-git/isomorphic-git/issues/1145#issuecomment-653819147
      // TODO: Support non-GitHub repositories by removing force-adding this suffix in normalizeURL?
      http,
      fs,
      dir: opts.workDir,
      ref: opts.branch,
      singleBranch: true,
      depth: 1,
      onAuth: () => opts.auth,
      onAuthFailure: () => {
        updateStatus({
          busy: {
            operation: 'cloning',
            awaitingPassword: true,
          },
        });
        return { cancel: true };
      },
      onProgress: (progress) => {
        updateStatus({
          busy: {
            operation: 'cloning',
            progress,
          },
        });
      },
    });
    updateStatus({
      status: 'ready',
    });
  } catch (e) {
    //log.error(`C/db/isogit/worker: Error cloning repository`, e);
    if ((e as any).code !== 'UserCanceledError') {
      updateStatus({
        busy: {
          operation: 'cloning',
          networkError: true,
        },
      });
    }
    // Clean up failed clone
    removeSync(opts.workDir);
    throw e;
  }

  return { success: true };
}


async function push(opts: PushRequestMessage, updateStatus: RepoStatusUpdater) {
  const {
    workDir,
    auth,
    _presumeCanceledErrorMeansAwaitingAuth,
    _presumeRejectedPushMeansNothingToPush,
} = opts;

  try {
    await git.push({
      http,
      fs,
      dir: workDir,
      url: normalizeURL(opts.repoURL),
      onAuth: () => auth,
      onAuthFailure: () => {
        updateStatus({
          busy: {
            operation: 'pushing',
            awaitingPassword: true,
          },
        });
        return { cancel: true };
      },
      onProgress: (progress) => {
        updateStatus({
          busy: {
            operation: 'pushing',
            progress,
          },
        });
      },
    });
    updateStatus({
      status: 'ready',
    });

  } catch (_e) {
    //console.error(`C/db/isogit/worker: Error pushing to repository`, e);
    const e = _e as any;
    const suppress: boolean =
      (e.code === 'UserCanceledError' && _presumeCanceledErrorMeansAwaitingAuth === true) ||
      (e.code === 'PushRejectedError' && _presumeRejectedPushMeansNothingToPush === true);
    if (!suppress) {
      updateStatus({
        busy: {
          operation: 'pushing',
          networkError: true,
        },
      });
    } else {
      if (e.code !== 'PushRejectedError') {
        throw e;
      } else {
        updateStatus({
          status: 'ready',
        });
      }
    }
  }

  return { success: true as const };
}


const pull: WithStatusUpdater<Git.Sync.Pull> = async function (
  opts: PullRequestMessage,
  updateStatus: RepoStatusUpdater,
) {
  const oidBeforePull = await git.resolveRef({ fs, dir: opts.workDir, ref: 'HEAD' });

  try {
    await git.pull({
      http,
      fs,
      dir: opts.workDir,
      url: normalizeURL(opts.repoURL),
      singleBranch: true,
      fastForwardOnly: true,
      author: opts.author,
      onAuth: () => opts.auth,
      onAuthFailure: () => {
        updateStatus({
          busy: {
            operation: 'pulling',
            awaitingPassword: true,
          },
        });
        return { cancel: true };
      },
      onProgress: (progress) => {
        updateStatus({
          busy: {
            operation: 'pulling',
            progress,
          },
        });
      },
    });
    updateStatus({
      status: 'ready',
    });
  } catch (e) {
    //log.error(`C/db/isogit/worker: Error pulling from repository`, e);
    const suppress: boolean =
      ((e as any).code === 'UserCanceledError' && opts._presumeCanceledErrorMeansAwaitingAuth === true);
    if (!suppress) {
      updateStatus({
        busy: {
          operation: 'pulling',
          networkError: true,
        },
      });
    }
    throw e;
  }

  const oidAfterPull = await git.resolveRef({ fs, dir: opts.workDir, ref: 'HEAD' });

  return { oidBeforePull, oidAfterPull };
}


export default {
  clone,
  pull,
  push,
};
