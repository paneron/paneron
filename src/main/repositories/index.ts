import path from 'path';
import fs from 'fs-extra';

import AsyncLock from 'async-lock';
import yaml from 'js-yaml';
import { spawn, Worker, Thread } from 'threads';
import keytar from 'keytar';

import { app, dialog } from 'electron';
import log from 'electron-log';

import { Subscription } from 'observable-fns';

import {
  addRepository, createRepository, deleteRepository,
  getRepositoryStatus, getStructuredRepositoryInfo,
  listRepositories,
  repositoriesChanged, repositoryStatusChanged,
  getDefaultWorkingDirectoryContainer,
  selectWorkingDirectoryContainer, validateNewWorkingDirectoryPath,
  getNewRepoDefaults, listAvailableTypes, getRepositoryInfo, savePassword
} from '../../repositories';
import { Repository, GitAuthor, NewRepositoryDefaults, StructuredRepoInfo, RepoStatus } from '../../repositories/types';
import { Methods as WorkerMethods, WorkerSpec } from './worker';


getDefaultWorkingDirectoryContainer.main!.handle(async () => {
  const _path = path.join(app.getPath('userData'), 'working_copies');
  await fs.ensureDir(_path);
  return { path: _path };
});


getNewRepoDefaults.main!.handle(async () => {
  return (await readRepoConfig()).defaults || {};
});


listAvailableTypes.main!.handle(async () => {
  return {
    types: [
      { title: "Geodetic Registry", pluginID: 'geodetic-registry' },
    ],
  };
});


validateNewWorkingDirectoryPath.main!.handle(async ({ _path }) => {
  // Container is a directory?
  log.debug("Checking path", _path)
  let containerAvailable: boolean;
  try {
    containerAvailable = (await fs.stat(path.dirname(_path))).isDirectory();
  } catch (e) {
    containerAvailable = false;
  }
  if (!containerAvailable) {
    return { available: false };
  }

  // Path does not exist?
  try {
    await fs.stat(_path);
  } catch (e) {
    return { available: true };
  }

  return { available: false };
});


selectWorkingDirectoryContainer.main!.handle(async ({ _default }) => {
  let directory: string;
  let result: Electron.OpenDialogReturnValue;

  try {
    result = await dialog.showOpenDialog({
      title: "Choose where to store your new register",
      buttonLabel: "Select directory",
      message: "Choose where to store your new register",
      defaultPath: _default,
      properties: [ 'openDirectory', 'createDirectory' ],
    })
  } catch (e) {
    log.error("Repositories: Dialog to obtain working copy container directory from user errored");
    return { path: _default };
  }

  if ((result.filePaths || []).length > 0) {
    directory = result.filePaths[0];
    // TODO: Check that selected new repo working path is available
  } else {
    directory = _default;
  }

  return { path: directory };
});


let repositoryStatuses: {
  [workingCopyPath: string]: {
    stream: Subscription<RepoStatus>
    updateTimeout?: ReturnType<typeof setTimeout>
    latestStatus?: RepoStatus
    latestSync?: Date
  }
} = {};


function removeRepoStatus(workingCopyPath: string) {
  repositoryStatuses[workingCopyPath]?.stream?.unsubscribe();
  const timeout = repositoryStatuses[workingCopyPath]?.updateTimeout;
  timeout ? clearTimeout(timeout) : void 0;
  delete repositoryStatuses[workingCopyPath];
}


getRepositoryStatus.main!.handle(async ({ workingCopyPath }) => {
  const w = await worker;

  let repoCfg: Repository;
  try {
    repoCfg = await readConfigForWorkingCopy(workingCopyPath);
  } catch (e) {
    log.warn("Repositories: Configuration for working copy is invalid.");
    return { status: 'invalid-working-copy' };
  }

  let copyIsInvalid: boolean;
  let copyIsMissing: boolean;
  try {
    copyIsInvalid = (await fs.stat(workingCopyPath)).isDirectory() !== true;
    copyIsMissing = false;
  } catch (e) {
    if (!repoCfg.remote?.url) {
      log.error("Repositories: Configuration for working copy exists, but working copy directory is missing and no remote is specified.");
      return { status: 'invalid-working-copy' };
    } else {
      log.warn("Repositories: Configuration for working copy exists, but working copy directory is missing. Will attempt to clone again.");
      copyIsMissing = true;
      copyIsInvalid = false;
    }
  }

  if (copyIsInvalid) {
    log.error("Repositories: Working copy in filesystem is invalid (not a directory?)");
    return { status: 'invalid-working-copy' };
  } else if (!copyIsMissing && !(await w.workingCopyIsValid({ workDir: workingCopyPath }))) {
    log.warn("Repositories: Working copy in filesystem is invalid (not a Git repo?)");
  }

  if (repositoryStatuses[workingCopyPath]) {
    return repositoryStatuses[workingCopyPath]?.latestStatus || { status: 'ready' };
  }

  async function reportStatus(status: RepoStatus) {
    if (repositoryStatuses[workingCopyPath]) {
      if (JSON.stringify(repositoryStatuses[workingCopyPath].latestStatus) !== JSON.stringify(status)) {
        await repositoryStatusChanged.main!.trigger({
          workingCopyPath,
          status,
        });
      }
      repositoryStatuses[workingCopyPath].latestStatus = status;
    } else {
      streamSubscription.unsubscribe();
    }
  }

  const streamSubscription = w.streamStatus({ workDir: workingCopyPath }).subscribe(reportStatus);

  repositoryStatuses[workingCopyPath] = {
    stream: streamSubscription,
  };

  syncRepoRepeatedly(workingCopyPath);

  app.on('quit', () => { removeRepoStatus(workingCopyPath); });

  return { status: 'ready', };
});


getRepositoryInfo.main!.handle(async ({ workingCopyPath }) => {
  return { info: await readConfigForWorkingCopy(workingCopyPath) };
});


getStructuredRepositoryInfo.main!.handle(async ({ workingCopyPath }) => {
  const data = await (await worker).getObjectContents({
    workDir: workingCopyPath,
    readObjectContents: { 'meta.yaml': true },
  });

  const rawMeta = data['meta.yaml'];
  const registerMeta = rawMeta ? yaml.load(rawMeta) : null;

  return {
    info: registerMeta,
  };
});


listRepositories.main!.handle(async () => {
  return {
    objects: await readRepositories((await readRepoConfig()).workingCopies),
  };
});


addRepository.main!.handle(async ({ gitRemoteURL, workingCopyPath, username, author }) => {
  await updateRepoConfig((data) => {
    if (data.workingCopies[workingCopyPath] !== undefined) {
      throw new Error("Repository already exists");
    }
    const newData = { ...data };
    newData.workingCopies[workingCopyPath] = {
      author,
      remote: {
        url: gitRemoteURL,
        username,
      },
    };
    return newData;
  });

  await _updateNewRepoDefaults({
    workingDirectoryContainer: path.dirname(workingCopyPath),
    author,
    remote: {
      username,
    },
  });

  repositoriesChanged.main!.trigger({
    changedWorkingPaths: [],
    deletedWorkingPaths: [],
    createdWorkingPaths: [workingCopyPath],
  });

  await (await worker).clone({
    workDir: workingCopyPath,
    repoURL: gitRemoteURL,
    auth: await getAuth(gitRemoteURL, username),
  });

  return { success: true };
});


createRepository.main!.handle(async ({ workingCopyPath, author, pluginID }) => {
  await updateRepoConfig((data) => {
    if (data.workingCopies?.[workingCopyPath] !== undefined) {
      throw new Error("Repository already exists");
    }
    const newData = { ...data };
    newData.workingCopies[workingCopyPath] = {
      author,
    };
    return newData;
  });

  await _updateNewRepoDefaults({
    workingDirectoryContainer: path.dirname(workingCopyPath),
    author,
  });

  const w = await worker;

  await w.init({
    workDir: workingCopyPath,
  });

  const meta: StructuredRepoInfo = {
    title: path.basename(workingCopyPath),
    pluginID,
  };

  await w.changeObjects({
    workDir: workingCopyPath,
    commitMessage: "Initial commit",
    author: await getAuthorInfo(workingCopyPath),
    writeObjectContents: {
      'meta.yaml': yaml.dump(meta),
    },
  });

  repositoriesChanged.main!.trigger({
    changedWorkingPaths: [],
    deletedWorkingPaths: [],
    createdWorkingPaths: [workingCopyPath],
  });

  return { success: true };
});


deleteRepository.main!.handle(async ({ workingCopyPath }) => {
  removeRepoStatus(workingCopyPath);

  await (await worker).delete({
    workDir: workingCopyPath,

    // TODO: Make it so that this flag has to be passed all the way from calling code?
    yesReallyDestroyLocalWorkingCopy: true,
  });

  await updateRepoConfig((data) => {
    if (data.workingCopies?.[workingCopyPath]) {
      const newData = { ...data };
      delete newData.workingCopies[workingCopyPath];
      return newData;
    }
    return data;
  });

  repositoriesChanged.main!.trigger({
    changedWorkingPaths: [],
    deletedWorkingPaths: [workingCopyPath],
    createdWorkingPaths: [],
  });

  return { deleted: true };
});


savePassword.main!.handle(async ({ workingCopyPath, remoteURL, username, password }) => {
  await _savePassword(remoteURL, username, password);
  delete repositoryStatuses[workingCopyPath].latestStatus;
  syncRepoRepeatedly(workingCopyPath);
  return { success: true };
});


async function readRepositories(workingCopies: RepoListSpec["workingCopies"]):
Promise<Repository[]> {
  return await Promise.all(Object.keys(workingCopies).map(async (path: string) => {
    return {
      workingCopyPath: path,
      ...workingCopies[path],
    };
  }));
}


/* Sync sequence */
function syncRepoRepeatedly(workingCopyPath: string): void {
  async function _sync(): Promise<void> {
    const timeout = repositoryStatuses[workingCopyPath]?.updateTimeout;
    timeout ? clearTimeout(timeout) : void 0;

    const w = await worker;

    let repoCfg: Repository | null;
    if (!repositoryStatuses[workingCopyPath]) {
      return removeRepoStatus(workingCopyPath);
    } else {
      try {
        repoCfg = await readConfigForWorkingCopy(workingCopyPath);
        if (!repoCfg.author) {
          log.error("Repositories: Configuration for working copy is missing author info.");
          return removeRepoStatus(workingCopyPath);
        }
      } catch (e) {
        log.error("Repositories: Configuration for working copy cannot be read.");
        return removeRepoStatus(workingCopyPath);
      }
      const isBusy = repositoryStatuses[workingCopyPath].latestStatus?.busy;
      switch (isBusy?.operation) {
        case 'pulling':
        case 'pushing':
        case 'cloning':
          if (isBusy.awaitingPassword) {
            return;
          }
      }
    }

    try {
      await fs.stat(workingCopyPath);
    } catch (e) {
      if (repoCfg.remote) {
        const auth = await getAuth(repoCfg.remote.url, repoCfg.remote.username);
        try {
          await w.clone({
            workDir: workingCopyPath,
            repoURL: repoCfg.remote.url,
            auth,
          });
        } catch (e) {
          log.error("Repositories: Error re-cloning repository", workingCopyPath, e);
        }
      }
      repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(_sync, 15000);
      return;
    }

    try {
      if (repoCfg.remote) {
        const auth = await getAuth(repoCfg.remote.url, repoCfg.remote.username);

        await w.pull({
          workDir: workingCopyPath,
          repoURL: repoCfg.remote.url,
          auth,
          author: repoCfg.author,
          _presumeCanceledErrorMeansAwaitingAuth: true,
        });

        await w.push({
          workDir: workingCopyPath,
          repoURL: repoCfg.remote.url,
          auth,
          _presumeRejectedPushMeansNothingToPush: true,
          _presumeCanceledErrorMeansAwaitingAuth: true,
        });
        repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(_sync, 5000);

      } else {
        repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(_sync, 15000);
      }

    } catch (e) {
      log.error("Repositories: Error syncing repository", workingCopyPath, e);
      repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(_sync, 15000);
    }
  }
  repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(_sync, 100);
}



// Auth helpers

/* Fetches password associated with the hostname of given remote URL
   (or, if that fails, with full remote URL)
   and with given username.

   Returns { username, password }; password can be undefined. */
async function getAuth(remote: string, username: string):
Promise<{ password: string | undefined, username: string }> {
  let url: URL | null;
  try {
    url = new URL(remote);
  } catch (e) {
    log.warn("Repositories: getAuth: Likely malformed Git remote URL", remote);
    url = null;
  }

  let password: string | undefined;
  try {
    password =
      (url?.hostname ? await keytar.getPassword(url.hostname, username) : undefined) ||
      await keytar.getPassword(remote, username) ||
      undefined;
  } catch (e) {
    log.error("Repositories: Error retrieving password using keytar", remote, username, e);
    password = undefined;
  }

  return { password, username };
}

async function _savePassword(remote: string, username: string, password: string) {
  let url: URL | null;
  try {
    url = new URL(remote);
  } catch (e) {
    log.warn("Repositories: savePassword: Likely malformed Git remote URL", remote);
    url = null;
  }

  const service = url?.hostname ? url.hostname : remote;
  try {
    await keytar.setPassword(service, username, password);
  } catch (e) {
    log.error("Repositories: Error saving password using keytar", remote, username, e);
    throw e;
  }
}



// Reading repo config

const REPO_LIST_FILENAME = 'repositories.yaml';
const REPO_LIST_PATH = path.join(app.getPath('userData'), REPO_LIST_FILENAME);

interface RepoListSpec {
  defaults?: NewRepositoryDefaults
  workingCopies: {
    [path: string]: Omit<Repository, 'workingCopyPath'>
  }
}

const FileAccessLock = new AsyncLock();

async function _updateNewRepoDefaults(defaults: NewRepositoryDefaults) {
  return await updateRepoConfig((data) => ({ ...data, defaults }));
}

async function getAuthorInfo(workingCopyPath: string): Promise<GitAuthor> {
  const cfg = await readConfigForWorkingCopy(workingCopyPath);
  if (cfg.author) {
    return cfg.author;
  } else {
    log.error("Author info for repository is incomplete or missing", workingCopyPath, cfg);
    throw new Error("Author info is incomplete or missing");
  }
}

async function readConfigForWorkingCopy(workingCopyPath: string): Promise<Repository> {
  const cfg: Repository | undefined = {
    workingCopyPath,
    ...(await readRepoConfig()).workingCopies[workingCopyPath]
  };
  if (cfg !== undefined) {
    return cfg;
  } else {
    log.error("Repositories: Cannot find configuration for working copy", workingCopyPath);
    throw new Error("Working copy config not found");
  }
}

async function readRepoConfig(): Promise<RepoListSpec> {
  const rawData = await FileAccessLock.acquire('1', async () => {
    await fs.ensureFile(REPO_LIST_PATH);
    return await fs.readFile(REPO_LIST_PATH, { encoding: 'utf-8' });
  });

  const data = yaml.load(rawData);

  if (data.workingCopies) {
    return (data as RepoListSpec);
  } else {
    return { workingCopies: {} };
  }
}

async function updateRepoConfig(updater: (data: RepoListSpec) => RepoListSpec) {
  await FileAccessLock.acquire('1', async () => {
    let data: RepoListSpec;
    try {
      const rawData: any = await fs.readFile(REPO_LIST_PATH, { encoding: 'utf-8' });
      data = yaml.load(rawData) || { workingCopies: {} };
    } catch (e) {
      data = { workingCopies: {} };
    }

    const newData = updater(data);
    const newRawData = yaml.dump(newData);

    await fs.writeFile(REPO_LIST_PATH, newRawData, { encoding: 'utf-8' });
  });
}



// Worker

var worker: Promise<Thread & WorkerMethods> = new Promise((resolve, reject) => {
  log.debug("Repositories: Spawning worker");

  spawn<WorkerSpec>(new Worker('./worker')).
  then((worker) => {
    log.debug("Repositories: Spawning worker: Done");

    async function terminateWorker() {
      try {
        await worker.destroyWorker();
      } finally {
        await Thread.terminate(worker);
      }
    }

    app.on('quit', terminateWorker);

    Thread.events(worker).subscribe(evt => {
      // log.debug("Repositories: Worker event:", evt);
      // TODO: Respawn on worker exit?
    });

    resolve(worker);
  }).
  catch(reject);
});
