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
    updateTimeout: ReturnType<typeof setTimeout>
    latestStatus?: RepoStatus
    latestSync?: Date
  }
} = {};


function removeRepoStatus(workingCopyPath: string) {
  repositoryStatuses[workingCopyPath]?.stream?.unsubscribe();
  const timeout = repositoryStatuses[workingCopyPath]?.updateTimeout;
  clearTimeout(timeout ? (timeout as unknown as number) : undefined);
}


getRepositoryStatus.main!.handle(async ({ workingCopyPath }) => {
  const existingStatus = repositoryStatuses[workingCopyPath];

  if (existingStatus) {
    return existingStatus.latestStatus || { status: 'ready' };
  }

  const w = await worker;

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

  async function syncRepoRepeatedly() {
    if (!repositoryStatuses[workingCopyPath]) { return; }

    try {
      const author = await getAuthorInfo(workingCopyPath);
      const repoCfg = await readConfigForWorkingCopy(workingCopyPath);

      if (repoCfg.remote) {
        const auth = await getAuth(repoCfg.remote.url, repoCfg.remote.username);

        await w.pull({
          workDir: workingCopyPath,
          repoURL: repoCfg.remote.url,
          auth,
          author,
          _presumeCanceledErrorMeansAwaitingAuth: true,
        });

        await w.push({
          workDir: workingCopyPath,
          repoURL: repoCfg.remote.url,
          auth,
          _presumeRejectedPushMeansNothingToPush: true,
          _presumeCanceledErrorMeansAwaitingAuth: true,
        });
        repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(syncRepoRepeatedly, 5000);

      } else {
        repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(syncRepoRepeatedly, 15000);
      }

    } catch (e) {
      log.error("Repositories: Error syncing repository", workingCopyPath, e);
      repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(syncRepoRepeatedly, 15000);
    }
  }

  const streamSubscription = w.streamStatus({ workDir: workingCopyPath }).subscribe(reportStatus);
  let updateTimeout = setTimeout(syncRepoRepeatedly, 230);

  repositoryStatuses[workingCopyPath] = {
    updateTimeout,
    stream: streamSubscription,
  };

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
  })

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


savePassword.main!.handle(async ({ remoteURL, username, password }) => {
  await _savePassword(remoteURL, username, password);
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
