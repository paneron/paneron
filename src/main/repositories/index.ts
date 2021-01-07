import path from 'path';
import fs from 'fs-extra';

import AsyncLock from 'async-lock';
import yaml from 'js-yaml';
import keytar from 'keytar';

import { app, dialog } from 'electron';
import log from 'electron-log';

import { Subscription } from 'observable-fns';

import {
  addRepository, createRepository, deleteRepository,
  getRepositoryStatus,
  listRepositories,
  repositoriesChanged, repositoryStatusChanged,
  getDefaultWorkingDirectoryContainer,
  selectWorkingDirectoryContainer, validateNewWorkingDirectoryPath,
  getNewRepoDefaults,
  getRepositoryInfo, savePassword, setRemote,
  listObjectPaths, readContents, commitChanges,
  repositoryContentsChanged,
  listAllObjectPathsWithSyncStatus,
  getPaneronRepositoryInfo,
  PANERON_REPOSITORY_META_FILENAME,
  queryGitRemote,
  unsetRemote,
  setAuthorInfo,
  listPaneronRepositories,
  setPaneronRepositoryInfo,
  migrateRepositoryFormat,
  unsetWriteAccess,
} from '../../repositories';
import { Repository, NewRepositoryDefaults, RepoStatus, CommitOutcome, PaneronRepository, GitRemote } from '../../repositories/types';
import { forceSlug } from 'utils';
import { DatasetInfo } from 'datasets/types';
import { fetchExtensions } from 'main/plugins';
import { stripLeadingSlash } from './git-methods';
import cache from './cache';
import worker from './workerInterface';
import { FileChangeType, ObjectDataRequest, ObjectDataset } from '@riboseinc/paneron-extension-kit/types';
import { DATASET_FILENAME } from 'datasets/main/util';


const REPOSITORY_SYNC_INTERVAL_MS = 5000;
const REPOSITORY_SYNC_INTERVAL_AFTER_ERROR_MS = 15000;


getDefaultWorkingDirectoryContainer.main!.handle(async () => {
  const _path = path.join(app.getPath('userData'), 'working_copies');
  await fs.ensureDir(_path);
  return { path: _path };
});


validateNewWorkingDirectoryPath.main!.handle(async ({ _path }) => {
  log.debug("Repositories: Validating working directory path", _path);

  // Container is a directory?
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
  } else {
    directory = _default;
  }

  return { path: directory };
});


getRepositoryStatus.main!.handle(async ({ workingCopyPath }) => {
  if (repositoryStatuses[workingCopyPath]) {
    return repositoryStatuses[workingCopyPath]?.latestStatus || { status: 'ready' };
  }

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

  if (!copyIsInvalid && !copyIsMissing && !(await w.workingCopyIsValid({ workDir: workingCopyPath }))) {
    log.warn("Repositories: Working copy in filesystem is invalid (not a Git repo?)", workingCopyPath);
    return { busy: { operation: 'initializing' } };
  } else {
    return { status: 'ready' };
  }

});


setRemote.main!.handle(async ({ workingCopyPath, url, username, password }) => {
  const w = await worker;

  const auth = { username, password };
  const { isBlank, canPush } = await w.queryRemote({ url, auth });

  if (isBlank && canPush) {
    await updateRepositories((data) => {
      const existingConfig = data.workingCopies?.[workingCopyPath];
      if (existingConfig) {
        return {
          ...data,
          workingCopies: {
            ...data.workingCopies,
            [workingCopyPath]: {
              ...existingConfig,
              remote: { url, username, writeAccess: true },
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


unsetWriteAccess.main!.handle(async ({ workingCopyPath }) => {
  await updateRepositories((data) => {
    const existingConfig = data.workingCopies?.[workingCopyPath];
    if (existingConfig?.remote?.writeAccess === true) {
      delete existingConfig.remote.writeAccess;
      return {
        ...data,
        workingCopies: {
          ...data.workingCopies,
          [workingCopyPath]: existingConfig,
        }
      };
    } else {
      throw new Error("Cannot unset remote URL: corresponding repository not found or has no write access");
    }
  });

  setImmediate(async () => {
    await repositoriesChanged.main!.trigger({
      changedWorkingPaths: [workingCopyPath],
      deletedWorkingPaths: [],
      createdWorkingPaths: [],
    });
  });

  return { success: true };
});


unsetRemote.main!.handle(async ({ workingCopyPath }) => {
  const w = await worker;

  await updateRepositories((data) => {
    const existingConfig = data.workingCopies?.[workingCopyPath];
    if (existingConfig) {
      delete existingConfig.remote;
      return {
        ...data,
        workingCopies: {
          ...data.workingCopies,
          [workingCopyPath]: existingConfig,
        }
      };
    } else {
      throw new Error("Cannot unset remote URL for nonexistent working copy configuration");
    }
  });

  await w.deleteOrigin({
    workDir: workingCopyPath,
  });

  setImmediate(async () => {
    await repositoriesChanged.main!.trigger({
      changedWorkingPaths: [workingCopyPath],
      deletedWorkingPaths: [],
      createdWorkingPaths: [],
    });
  });

  return { success: true };
});


setAuthorInfo.main!.handle(async ({ workingCopyPath, author }) => {
  await updateRepositories((data) => {
    const existingConfig = data.workingCopies?.[workingCopyPath];
    if (existingConfig) {
      return {
        ...data,
        workingCopies: {
          ...data.workingCopies,
          [workingCopyPath]: {
            author,
          },
        }
      };
    } else {
      throw new Error("Cannot edit author info for nonexistent working copy configuration");
    }
  });

  return { success: true };
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


listPaneronRepositories.main!.handle(async ({ workingCopyPaths }) => {
  const maybeRepoMetaList:
  [ workingCopyPath: string, meta: PaneronRepository | null ][] =
  await Promise.all(workingCopyPaths.map(async (workDir) => {
    try {
      const meta = await readPaneronRepoMeta(workDir);
      return [ workDir, meta ] as [ string, PaneronRepository ];
    } catch (e) {
      return [ workDir, null ] as [ string, null ];
    }
  }));

  return {
    objects: maybeRepoMetaList.
      filter(([_, meta]) => meta !== null).
      reduce((prev, [ workDir, meta ]) => ({
        ...prev,
        [workDir]: meta!,
      }), {}),
  };
});


getRepositoryInfo.main!.handle(async ({ workingCopyPath }) => {
  return { info: await readRepoConfig(workingCopyPath) };
});


getPaneronRepositoryInfo.main!.handle(async ({ workingCopyPath }) => {
  let meta: PaneronRepository;
  try {
    meta = await readPaneronRepoMeta(workingCopyPath);
  } catch (e) {
    log.error("Unable to get Paneron repository information");
    return { info: null }
  }
  return { info: meta };
});


setPaneronRepositoryInfo.main!.handle(async ({ workingCopyPath, info }) => {
  if (!info.title) {
    throw new Error("Proposed Paneron repository meta is missing title");
  }
  const existingMeta = await readPaneronRepoMeta(workingCopyPath);
  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Repository configuration is missing author information");
  }
  const w = await worker;
  const { newCommitHash } = await w.changeObjects({
    workDir: workingCopyPath,
    commitMessage: "Change repository title",
    author,
    writeObjectContents: {
      [PANERON_REPOSITORY_META_FILENAME]: {
        oldValue: yaml.dump(existingMeta, { noRefs: true }),
        newValue: yaml.dump({
          ...existingMeta,
          title: info.title,
        }, { noRefs: true }),
        encoding: 'utf-8',
      }
    },
  });
  if (!newCommitHash) {
    throw new Error("Updating Paneron repository meta failed to return commit hash");
  }
  await repositoriesChanged.main!.trigger({
    changedWorkingPaths: [workingCopyPath],
  });
  return { success: true };
});


getNewRepoDefaults.main!.handle(async () => {
  return (await readRepositories()).defaults || {};
});


queryGitRemote.main!.handle(async ({ url, username, password }) => {
  const auth = { username, password };
  if (!auth.password) {
    auth.password = (await getAuth(url, username)).password;
  }
  return await (await worker).queryRemote({ url, auth });
});


addRepository.main!.handle(async ({ gitRemoteURL, workingCopyPath, username, password, author }) => {
  const auth = { username, password };
  if (!auth.password) {
    auth.password = (await getAuth(gitRemoteURL, username)).password;
  }
  const { canPush } = await (await worker).queryRemote({ url: gitRemoteURL, auth });

  await updateRepositories((data) => {
    if (data.workingCopies[workingCopyPath] !== undefined) {
      throw new Error("Working copy already exists");
    }
    const newData = { ...data };
    const remote: GitRemote = {
      url: gitRemoteURL,
      username,
    };
    if (canPush) {
      remote.writeAccess = true;
    }
    newData.workingCopies[workingCopyPath] = { remote, author };
    return newData;
  });

  repositoriesChanged.main!.trigger({
    changedWorkingPaths: [],
    deletedWorkingPaths: [],
    createdWorkingPaths: [workingCopyPath],
  });

  await (await worker).clone({
    workDir: workingCopyPath,
    repoURL: gitRemoteURL,
    auth,
  });

  await cache.invalidatePaths({
    workingCopyPath,
  });

  repositoriesChanged.main!.trigger({
    changedWorkingPaths: [workingCopyPath],
    deletedWorkingPaths: [],
    createdWorkingPaths: [],
  });

  await _updateNewRepoDefaults({
    workingDirectoryContainer: path.dirname(workingCopyPath),
    author,
    remote: { username },
  });

  return { success: true };
});


createRepository.main!.handle(async ({ workingCopyPath, author, title }) => {
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

  const paneronMeta: PaneronRepository = {
    title,
    datasets: {},
  };

  const { newCommitHash, conflicts } = await w.changeObjects({
    workDir: workingCopyPath,
    commitMessage: "Initial commit",
    author,
    // _dangerouslySkipValidation: true, // Have to, since we cannot validate data
    writeObjectContents: {
      [PANERON_REPOSITORY_META_FILENAME]: {
        oldValue: null,
        newValue: yaml.dump(paneronMeta, { noRefs: true }),
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

  await cache.destroy({
    workingCopyPath,
  });

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



// Manipulating data


listObjectPaths.main!.handle(async ({ workingCopyPath, query }) => {
  return await cache.listPaths({ workingCopyPath, query });
});


listAllObjectPathsWithSyncStatus.main!.handle(async ({ workingCopyPath }) => {
  // TODO: Rename to just list all paths; implement proper sync status checker for subsets of files.

  const paths = await cache.listPaths({ workingCopyPath });

  const result: Record<string, FileChangeType> =
    paths.map(p => ({ [`/${p}`]: 'unchanged' as const })).reduce((p, c) => ({ ...p, ...c }), {});

  //const result = await w.listAllObjectPathsWithSyncStatus({ workDir: workingCopyPath });
  log.info("Got sync status", JSON.stringify(result));

  return result;
});


readContents.main!.handle(async ({ workingCopyPath, objects }) => {
  if (Object.keys(objects).length < 1) {
    return {};
  }

  // Try cache
  let data: ObjectDataset = await cache.getObjectContents({ workingCopyPath, objects });

  // Below can be avoided if we ensure repo cache is populated before dataset is open.
  // If any data is null (cache key was not found), request from filesystem.
  // TODO: This is suboptimal in case object is known to not exist.
  // We could extend the type and e.g. cache “null” for known-nonexistent objects
  // and “undefined” if LevelDB returned NotFoundError.
  if (Object.values(data).indexOf(null) >= 0) {
    const fsRequest: ObjectDataRequest = Object.entries(data).
      filter(([key, data]) => data === null && objects[key] !== undefined).
      map(([key, _]) => ({ [key]: objects[key] })).
      reduce((prev, curr) => ({ ...prev, ...curr }));

    log.silly("Repositories: requesting data: cache miss", Object.keys(fsRequest));

    try {
      const w = await worker;
      data = {
        ...data,
        ...(await w.getObjectContents({
          workDir: workingCopyPath,
          readObjectContents: fsRequest,
        })),
      };
    } catch (e) {
      log.error("Repositories: Failed to read object contents from Git repository", e);
      throw e;
    }
  }

  return data;
});


commitChanges.main!.handle(async ({ workingCopyPath, commitMessage, changeset, ignoreConflicts }) => {
  const w = await worker;
  const repoCfg = await readRepoConfig(workingCopyPath);

  if (!repoCfg.author) {
    throw new Error("Author information is missing in repository config");
  }

  // Update Git repository
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

  // Check outcome for conflicts
  if (Object.keys(outcome.conflicts || {}).length > 0) {
    if (!ignoreConflicts) {
      log.error("Repositories: Conflicts while changing objects", outcome.conflicts);
      throw new Error("Conflicts while changing objects");
    } else {
      log.warn("Repositories: Ignoring conflicts while changing objects", outcome.conflicts);
    }
  }

  // Update cache
  await cache.applyChangeset({ workingCopyPath, changeset });

  // Send signals
  if (outcome.newCommitHash) {
    await repositoryContentsChanged.main!.trigger({
      workingCopyPath,
      objects: Object.keys(changeset).
        map(path => ({ [path]: true as const })).
        reduce((p, c) => ({ ...p, ...c }), {}),
    });
  } else {
    log.warn("Repositories: Commit did not return commit hash");
  }

  return outcome;
});


migrateRepositoryFormat.main!.handle(async ({ workingCopyPath }) => {
  // TODO: Move dataset-specific stuff into datasets
  const w = await worker;

  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Author information is missing");
  }

  const legacyMetaResp = (await w.getObjectContents({
    workDir: workingCopyPath,
    readObjectContents: {
      'meta.yaml': 'utf-8',
    },
  }))['meta.yaml'];

  const legacyMeta = legacyMetaResp?.encoding === 'utf-8'
    ? yaml.load(legacyMetaResp.value)
    : null;

  const pluginID = legacyMeta?.pluginID;
  const title = legacyMeta?.title;

  if (!pluginID || !title) {
    throw new Error("Legacy metadata was not found or is incomplete");
  }

  const datasetDir = forceSlug(title);
  const datasetPath = path.join(workingCopyPath, datasetDir);

  const paneronMeta: PaneronRepository = {
    title,
    datasets: {
      [datasetDir]: true,
    },
  };

  const extension = (await fetchExtensions())[`@riboseinc/paneron-extension-${pluginID}`];

  if (!extension) {
    throw new Error("Unable to find extension corresponding to legacy metadata");
  }

  const datasetMeta: DatasetInfo = {
    title,
    type: {
      id: extension.npm.name,
      version: extension.npm.version,
    },
  };

  if (fs.existsSync(datasetPath)) {
    throw new Error("Auto-generated dataset path already exists");
  }

  const LEAVE_AT_ROOT: { [key: string]: boolean } = {
    'meta.yaml': true,
    '.git': true,
    '.gitignore': true,
  };

  log.info("Upgrading repository: listing objects to move");
  const moveIntoDatasetDir = (await w.listObjectPaths({
    workDir: workingCopyPath,
    query: { pathPrefix: '' },
  })).filter(fn => (LEAVE_AT_ROOT[stripLeadingSlash(fn)]) !== true);

  log.info(`Upgrading repository: about to move ${moveIntoDatasetDir.length} objects…`);
  try {
    await w._resetUncommittedChanges({ workDir: workingCopyPath });

    fs.mkdirSync(datasetPath);
    fs.removeSync(path.join(workingCopyPath, 'meta.yaml'));
    fs.writeFileSync(
      path.join(datasetPath, DATASET_FILENAME),
      yaml.dump(datasetMeta, { noRefs: true }));
    fs.writeFileSync(
      path.join(workingCopyPath, PANERON_REPOSITORY_META_FILENAME),
      yaml.dump(paneronMeta, { noRefs: true }));

    for (const fp of moveIntoDatasetDir) {
      const fpSrc = path.join(workingCopyPath, fp);
      const fpTrg = path.join(datasetPath, fp);
      log.info("Upgrading repository: moving", fpSrc, fpTrg);
      await fs.move(fpSrc, fpTrg);
    }
  } catch (e) {
    log.error("Upgrading repository: error", e);
    log.debug("Undoing migration…");
    await w._resetUncommittedChanges({ workDir: workingCopyPath });
    fs.removeSync(datasetPath);
    fs.removeSync(path.join(workingCopyPath, PANERON_REPOSITORY_META_FILENAME));
    log.debug("Undoing migration… Done");
    throw e;
  }

  log.info("Committing migration changeset…");
  const { newCommitHash } = await w._commitAnyOutstandingChanges({
    workDir: workingCopyPath,
    commitMessage: "Migrate repository format",
    author,
  });
  log.info("Committing migration changeset… Done, commit hash:", newCommitHash);

  await repositoriesChanged.main!.trigger({
    changedWorkingPaths: [workingCopyPath],
    deletedWorkingPaths: [],
    createdWorkingPaths: [],
  });

  return { newCommitHash };

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


app.on('quit', () => {
  for (const workingCopyPath of Object.keys(repositoryStatuses)) {
    removeRepoStatus(workingCopyPath);
  }
});


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
          await cache.invalidatePaths({
            workingCopyPath,
          });
          await repositoryContentsChanged.main!.trigger({
            workingCopyPath,
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

        await cache.invalidatePaths({
          workingCopyPath,
          paths: changedObjects ? Object.keys(changedObjects) : undefined,
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

        if (repoCfg.remote.writeAccess) {
          await w.push({
            workDir: workingCopyPath,
            repoURL: repoCfg.remote.url,
            auth,
            _presumeRejectedPushMeansNothingToPush: true,
            _presumeCanceledErrorMeansAwaitingAuth: true,
          });
        }

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

export async function readPaneronRepoMeta(workingCopyPath: string): Promise<PaneronRepository> {
  const meta = (await (await worker).getObjectContents({
    workDir: workingCopyPath,
    readObjectContents: { [PANERON_REPOSITORY_META_FILENAME]: 'utf-8' },
  }))[PANERON_REPOSITORY_META_FILENAME];

  if (meta === null) {
    throw new Error("Paneron repository metadata file is not found");
  } else if (meta?.encoding !== 'utf-8') {
    throw new Error("Invalid paneron repository metadata file format");
  } else {
    return yaml.load(meta.value);
  }
}

export async function readRepoConfig(workingCopyPath: string): Promise<Repository> {
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
