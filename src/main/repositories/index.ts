import path from 'path';
import fs from 'fs-extra';

import axios from 'axios';
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
  getNewRepoDefaults, listAvailableTypes,
  getRepositoryInfo, savePassword, setRemote,
  listObjectPaths, readContents, commitChanges,
  repositoryContentsChanged,
  listAllObjectPathsWithSyncStatus
} from '../../repositories';
import { Repository, NewRepositoryDefaults, StructuredRepoInfo, RepoStatus, CommitOutcome } from '../../repositories/types';
import { Methods as WorkerMethods, WorkerSpec } from './worker';
import { NPM_EXTENSION_PREFIX } from 'plugins';


const REPOSITORY_SYNC_INTERVAL_MS = 5000;
const REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS = 15000;

const devPlugin = app.isPackaged === false ? process.env.PANERON_DEV_PLUGIN : undefined;


getDefaultWorkingDirectoryContainer.main!.handle(async () => {
  const _path = path.join(app.getPath('userData'), 'working_copies');
  await fs.ensureDir(_path);
  return { path: _path };
});


getNewRepoDefaults.main!.handle(async () => {
  return (await readRepositories()).defaults || {};
});


interface NPMEntry {
  package: { name: string, version: string, description: string } 
}


listAvailableTypes.main!.handle(async () => {
  const packages = (await axios.get(`https://registry.npmjs.com/-/v1/search?text=${NPM_EXTENSION_PREFIX}`)).data.objects;
  const availableTypes = packages.
  filter((entry: NPMEntry) => !entry.package.name.endsWith('extension-kit')).
  filter((entry: NPMEntry) => entry.package.name.startsWith(NPM_EXTENSION_PREFIX)).
  map((entry: NPMEntry) => {
    const name = entry.package.name.replace(NPM_EXTENSION_PREFIX, '');
    return {
      title: `${name} (${entry.package.version})`,
      pluginID: name,
    }
  });
  const _devPlugin = devPlugin
    ? [{ title: devPlugin, pluginID: devPlugin }]
    : [];
  return {
    types: [ ...availableTypes, ..._devPlugin],
  };
});


listObjectPaths.main!.handle(async ({ workingCopyPath, query }) => {
  const w = await worker;
  return await w.listObjectPaths({ workDir: workingCopyPath, query });
});


listAllObjectPathsWithSyncStatus.main!.handle(async ({ workingCopyPath }) => {
  const w = await worker;
  const result = await w.listAllObjectPathsWithSyncStatus({ workDir: workingCopyPath });
  //log.info("Got sync status", JSON.stringify(result));
  return result;
});


commitChanges.main!.handle(async ({ workingCopyPath, commitMessage, changeset, ignoreConflicts }) => {
  const w = await worker;
  const repoCfg = await readRepoConfig(workingCopyPath);

  if (!repoCfg.author) {
    throw new Error("Author information is missing in repository config");
  }

  let outcome: CommitOutcome;
  try {
    outcome = await w.changeObjects({
      workDir: workingCopyPath,
      commitMessage,
      writeObjectContents: changeset,
      author: repoCfg.author,
      _dangerouslySkipValidation: ignoreConflicts,
    });
  } catch (e) {
    log.error("Repositories: Failed to change objects", workingCopyPath, Object.keys(changeset), commitMessage, e);
    throw e;
  }

  if (outcome.newCommitHash) {
    await repositoryContentsChanged.main!.trigger({
      workingCopyPath,
      objects: Object.keys(changeset).
        map(path => ({ [path]: true as const })).
        reduce((p, c) => ({ ...p, ...c }), {}),
    });
  }

  if (Object.keys(outcome.conflicts || {}).length > 0) {
    log.error("Repositories: Conflicts while changing objects!", outcome.conflicts);
    throw new Error("Conflicts while changing objects");
  }

  return outcome;
});


readContents.main!.handle(async ({ workingCopyPath, objects }) => {
  try {
    const w = await worker;
    const data = await w.getObjectContents({
      workDir: workingCopyPath,
      readObjectContents: objects,
    });
    return data;
  } catch (e) {
    log.error("Failed to read file contents", e);
    throw e;
  }
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


getRepositoryStatus.main!.handle(async ({ workingCopyPath }) => {
  const w = await worker;

  let repoCfg: Repository;
  try {
    repoCfg = await readRepoConfig(workingCopyPath);
  } catch (e) {
    log.warn("Repositories: Configuration for working copy cannot be read.", workingCopyPath);
    return { status: 'invalid-working-copy' };
  }

  let copyIsInvalid: boolean;
  let copyIsMissing: boolean;
  try {
    copyIsInvalid = (await fs.stat(workingCopyPath)).isDirectory() !== true;
    copyIsMissing = false;
  } catch (e) {
    if (!repoCfg.remote?.url) {
      log.error("Repositories: Configuration for working copy exists, but working copy directory is missing and no remote is specified.", workingCopyPath);
      return { status: 'invalid-working-copy' };
    } else {
      log.warn("Repositories: Configuration for working copy exists, but working copy directory is missing. Will attempt to clone again.", workingCopyPath);
      copyIsMissing = true;
      copyIsInvalid = false;
    }
  }

  if (copyIsInvalid) {
    log.error("Repositories: Working copy in filesystem is invalid (not a directory?)", workingCopyPath);
    return { status: 'invalid-working-copy' };
  } else if (!copyIsMissing && !(await w.workingCopyIsValid({ workDir: workingCopyPath }))) {
    log.warn("Repositories: Working copy in filesystem is invalid (not a Git repo?)", workingCopyPath);
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

  return { status: 'ready' };
});


setRemote.main!.handle(async ({ workingCopyPath, url, username, password }) => {
  const w = await worker;

  const auth = { username, password };
  const isValid = await w.remoteIsValid({ url, auth });

  if (isValid) {
    await updateRepositories((data) => {
      const existingConfig = data.workingCopies?.[workingCopyPath];
      if (existingConfig) {
        return {
          ...data,
          workingCopies: {
            ...data.workingCopies,
            [workingCopyPath]: {
              ...existingConfig,
              remote: { url, username },
            },
          }
        };
      } else {
        throw new Error("Cannot set remote URL for nonexistent working copy configuration");
      }
    });

    await w.addOrigin({
      workDir: workingCopyPath,
      url,
    });

    setImmediate(async () => {
      await repositoriesChanged.main!.trigger({
        changedWorkingPaths: [workingCopyPath],
        deletedWorkingPaths: [],
        createdWorkingPaths: [],
      });
      await w.push({
        workDir: workingCopyPath,
        repoURL: url,
        auth,
      });
    });

    await _updateNewRepoDefaults({
      remote: { username },
    });

    if (password) {
      try {
        await _savePassword(url, username, password);
      } catch (e) {
        log.error("Repositories: Unable to save password while initiating sharing", workingCopyPath, url, e);
      }
    }

    return { success: true };

  } else {
    log.warn("Repositories: Remote cannot be used to start sharing", workingCopyPath, url, username);
    throw new Error("Remote cannot be used to start sharing");
  }
});


getRepositoryInfo.main!.handle(async ({ workingCopyPath }) => {
  return { info: await readRepoConfig(workingCopyPath) };
});


getStructuredRepositoryInfo.main!.handle(async ({ workingCopyPath }) => {
  const meta = (await (await worker).getObjectContents({
    workDir: workingCopyPath,
    readObjectContents: { 'meta.yaml': 'utf-8' },
  }))['meta.yaml'];

  if (meta === null) {
    return { info: null };
  } else if (meta?.encoding !== 'utf-8') {
    throw new Error("Invalid structured repository metadata file format");
  } else {
    return { info: yaml.load(meta.value) };
  }
});


listRepositories.main!.handle(async () => {
  const workingCopies = (await readRepositories()).workingCopies;
  return {
    objects: await Promise.all(Object.keys(workingCopies).map(async (path: string) => {
      return {
        workingCopyPath: path,
        ...workingCopies[path],
      };
    })),
  };
});


addRepository.main!.handle(async ({ gitRemoteURL, workingCopyPath, username, author }) => {
  await updateRepositories((data) => {
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
    remote: { username },
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
  await updateRepositories((data) => {
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

  const { newCommitHash, conflicts } = await w.changeObjects({
    workDir: workingCopyPath,
    commitMessage: "Initial commit",
    author,
    // _dangerouslySkipValidation: true, // Have to, since we cannot validate data
    writeObjectContents: {
      'meta.yaml': {
        oldValue: null,
        newValue: yaml.dump(meta, { noRefs: true }),
        encoding: 'utf-8',
      },
    },
  });

  if (!newCommitHash) {
    log.error("Failed to create a repository—conflicts when writing initial commit!", conflicts);
    throw new Error("Could not create a repository");
  }

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

  await updateRepositories((data) => {
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



// Sync helpers
// TODO: Must move sync to worker

const repositoryStatuses: {
  [workingCopyPath: string]: {
    stream: Subscription<RepoStatus>
    updateTimeout?: ReturnType<typeof setTimeout>
    latestSync?: Date

    // This status is set by subscription to worker events and is not to be relied on.
    latestStatus?: RepoStatus
  }
} = {};


/* Cancels repo status subscription, clears update timeout, and removes status. */
function removeRepoStatus(workingCopyPath: string) {
  repositoryStatuses[workingCopyPath]?.stream?.unsubscribe();
  const timeout = repositoryStatuses[workingCopyPath]?.updateTimeout;
  timeout ? clearTimeout(timeout) : void 0;
  delete repositoryStatuses[workingCopyPath];
}


/* Sync sequence */
function syncRepoRepeatedly(workingCopyPath: string): void {
  async function _sync(): Promise<void> {
    const w = await worker;

    // Do our best to avoid multiple concurrent sync runs on one repo and clear sync timeout, if exists.
    const timeout = repositoryStatuses[workingCopyPath]?.updateTimeout;
    timeout ? clearTimeout(timeout) : void 0;

    // 1. Check that repository is OK.
    // If something is broken or operation in latest status snapshot
    // indicates that we are awaiting user input, clear status and cancel further sync.
    // If latest operation indicates we are awaiting user input, skip sync during this run.

    // 1.1. Check configuration
    let repoCfg: Repository | null;
    if (!repositoryStatuses[workingCopyPath]) {
      return removeRepoStatus(workingCopyPath);
    } else {
      try {
        repoCfg = await readRepoConfig(workingCopyPath);
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

    // 1.2. Check that working copy is OK.
    // If copy is missing, skip sync during this run and try to re-clone instead.
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
      if (repositoryStatuses[workingCopyPath]) {
        repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(_sync, REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS);
      }
      return;
    }


    // 2. Perform actual sync.
    try {
      if (repoCfg.remote) {
        const auth = await getAuth(repoCfg.remote.url, repoCfg.remote.username);

        const { changedObjects } = await w.pull({
          workDir: workingCopyPath,
          repoURL: repoCfg.remote.url,
          auth,
          author: repoCfg.author,
          _presumeCanceledErrorMeansAwaitingAuth: true,
        });

        if (changedObjects === null) {
          log.error("Repositories: Apparently unable to compare for changes after pull!");
          await repositoryContentsChanged.main!.trigger({
            workingCopyPath,
          });
        } else if (Object.keys(changedObjects).length > 0) {
          await repositoryContentsChanged.main!.trigger({
            workingCopyPath,
            objects: changedObjects,
          });
        }


        await w.push({
          workDir: workingCopyPath,
          repoURL: repoCfg.remote.url,
          auth,
          _presumeRejectedPushMeansNothingToPush: true,
          _presumeCanceledErrorMeansAwaitingAuth: true,
        });

        if (repositoryStatuses[workingCopyPath]) {
          repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(_sync, REPOSITORY_SYNC_INTERVAL_MS);
        }

      } else {
        if (repositoryStatuses[workingCopyPath]) {
          repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(_sync, REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS);
        }
      }

    } catch (e) {
      log.error("Repositories: Error syncing repository", workingCopyPath, e);
      if (repositoryStatuses[workingCopyPath]) {
        repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(_sync, REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS);
      }
    }
  }

  const timeout = repositoryStatuses[workingCopyPath]?.updateTimeout;
  timeout ? clearTimeout(timeout) : void 0;
  if (repositoryStatuses[workingCopyPath]) {
    repositoryStatuses[workingCopyPath].updateTimeout = setTimeout(_sync, 100);
  }
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

async function _updateNewRepoDefaults(defaults: Partial<NewRepositoryDefaults>) {
  return await updateRepositories((data) => ({
    ...data,
    defaults: {
      ...data.defaults,
      ...defaults,
    },
  }));
}

async function readRepoConfig(workingCopyPath: string): Promise<Repository> {
  const cfg: Repository | undefined = {
    workingCopyPath,
    ...(await readRepositories()).workingCopies[workingCopyPath]
  };
  if (cfg !== undefined) {
    return cfg;
  } else {
    log.error("Repositories: Cannot find configuration for working copy", workingCopyPath);
    throw new Error("Working copy config not found");
  }
}

async function readRepositories(): Promise<RepoListSpec> {
  await fs.ensureFile(REPO_LIST_PATH);
  const rawData = await fs.readFile(REPO_LIST_PATH, { encoding: 'utf-8' });

  const data = yaml.load(rawData);

  if (data.workingCopies) {
    return (data as RepoListSpec);
  } else {
    return { workingCopies: {} };
  }
}

async function updateRepositories(updater: (data: RepoListSpec) => RepoListSpec) {
  await FileAccessLock.acquire('1', async () => {
    let data: RepoListSpec;
    try {
      const rawData: any = await fs.readFile(REPO_LIST_PATH, { encoding: 'utf-8' });
      data = yaml.load(rawData) || { workingCopies: {} };
    } catch (e) {
      data = { workingCopies: {} };
    }

    const newData = updater(data);
    const newRawData = yaml.dump(newData, { noRefs: true });

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
      log.debug("Repositories: Terminating worker")
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
