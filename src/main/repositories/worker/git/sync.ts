// NOTE: Functions for use by worker only.

import fs from 'fs/promises';
import { removeSync, ensureDir } from 'fs-extra';

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

import { PathChanges } from '@riboseinc/paneron-extension-kit/types/changes';

import {
  CloneRequestMessage,
  PullRequestMessage,
  PushRequestMessage,
  RepoStatusUpdater,
} from 'repositories/types';

import { normalizeURL } from '../../util';
import { listBufferStatuses } from '../buffers/list';
import { checkPathIsOccupied } from 'utils';


//import getDecoder from './decoders';
//const UTF_DECODER = getDecoder('utf-8');


async function clone(opts: CloneRequestMessage, updateStatus: RepoStatusUpdater) {
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
      ref: 'master',
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
    if (e.code !== 'UserCanceledError') {
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

  } catch (e) {
    //log.error(`C/db/isogit/worker: Error pushing to repository`, e);
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

}


async function pull(opts: PullRequestMessage, updateStatus: RepoStatusUpdater) {
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
      (e.code === 'UserCanceledError' && opts._presumeCanceledErrorMeansAwaitingAuth === true);
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

  if (oidAfterPull !== oidBeforePull) {
    try {
      const changeStatus = await listBufferStatuses(
        oidBeforePull,
        oidAfterPull,
        opts.workDir, {
          onlyChanged: true,
        });
      return changeStatus as PathChanges;
    } catch (e) {
      return null;
    }
  } else {
    return {};
  }
}


export default {
  clone,
  pull,
  push,
};
