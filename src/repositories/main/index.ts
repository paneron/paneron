import path from 'path';
import fs from 'fs-extra';

import { app } from 'electron';
import log from 'electron-log';

import { serializeMeta } from 'main/meta-serdes';
import { loadState } from 'state/manage';

import {
  addRepository, createRepository, deleteRepository,
  loadRepository,
  listRepositories,
  repositoriesChanged,
  getDefaultWorkingDirectoryContainer,
  getNewRepoDefaults, setNewRepoDefaults,
  describeRepository, savePassword, setRemote,
  PANERON_REPOSITORY_META_FILENAME,
  queryGitRemote,
  unsetRemote,
  setAuthorInfo,
  updatePaneronRepository,
  unsetWriteAccess,
  getBufferDataset,
  updateBuffers,
  describeGitRepository,
  addDisconnected,
} from '../ipc';

import { makeUUIDv4 } from 'utils';

import loadedDatasets, { changesetToPathChanges } from '../../datasets/main/loadedDatasets';
import { PaneronRepository, GitRemote, Repository } from '../types';

import { getRepoWorkers, oneOffWorkerTask } from './workerManager';

import {
  getLoadedRepository,
  loadRepository as loadRepo,
  reportBufferChanges,
  unloadRepository,
} from './loadedRepositories';

import {
  updateRepositories,
  readRepositories,
  readPaneronRepoMeta,
  readRepoConfig,
  getNewRepoDefaults as getDefaults,
  setNewRepoDefaults as setDefaults,
} from './readRepoConfig';

import { saveAuth, getAuth } from './remoteAuth';


const DEFAULT_WORKING_DIRECTORY_CONTAINER = path.join(app.getPath('userData'), 'working_copies');
fs.ensureDirSync(DEFAULT_WORKING_DIRECTORY_CONTAINER);


getNewRepoDefaults.main!.handle(async () => {
  try {
    return { defaults: await getDefaults() };
  } catch (e) {
    return { defaults: null };
  }
});


setNewRepoDefaults.main!.handle(async (defaults) => {
  await setDefaults(defaults);
  return { success: true };
});


getDefaultWorkingDirectoryContainer.main!.handle(async () => {
  return { path: DEFAULT_WORKING_DIRECTORY_CONTAINER };
});


//selectWorkingDirectoryContainer.main!.handle(async ({ _default }) => {
//  let directory: string;
//  let result: Electron.OpenDialogReturnValue;
//
//  try {
//    result = await dialog.showOpenDialog({
//      title: "Choose where to store your new register",
//      buttonLabel: "Select directory",
//      message: "Choose where to store your new register",
//      defaultPath: _default,
//      properties: [ 'openDirectory', 'createDirectory' ],
//    })
//  } catch (e) {
//    log.error("Repositories: Dialog to obtain working copy container directory from user errored");
//    return { path: _default };
//  }
//
//  if ((result.filePaths || []).length > 0) {
//    directory = result.filePaths[0];
//  } else {
//    directory = _default;
//  }
//
//  return { path: directory };
//});


loadRepository.main!.handle(async ({ workingCopyPath }) => {
  if (workingCopyPath) {
    const status = await loadRepo(workingCopyPath);
    return status;
  } else {
    throw new Error("Missing repo working directory path");
  }
});


setRemote.main!.handle(async ({ workingCopyPath, url, username, password }) => {
  const w = getLoadedRepository(workingCopyPath).workers.sync;

  const auth = { username, password };
  const { isBlank, canPush } = await w.git_describeRemote({ url, auth });

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

    await w.git_addOrigin({
      url,
    });

    setImmediate(async () => {
      await repositoriesChanged.main!.trigger({
        changedWorkingPaths: [workingCopyPath],
        deletedWorkingPaths: [],
        createdWorkingPaths: [],
      });
      await w.git_push({
        repoURL: url,
        auth,
      });
    });

    if (password) {
      try {
        await saveAuth(url, username, password);
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
  const w = getLoadedRepository(workingCopyPath).workers.sync;

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

  await w.git_deleteOrigin({
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
            ...data.workingCopies[workingCopyPath],
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


interface RepositoryLoadTimes {
  [workDir: string]: Date
}


listRepositories.main!.handle(async ({ query: { matchesText, sortBy } }) => {
  const workingCopies = (await readRepositories()).workingCopies;

  const repositories: Repository[] =
    await Promise.all(Object.keys(workingCopies).map(async (workDir) => {
      let paneronMeta: PaneronRepository | undefined;
      try {
        paneronMeta = await readPaneronRepoMeta(workDir);
      } catch (e) {
        paneronMeta = undefined;
      }
      const gitMeta = {
        workingCopyPath: workDir,
        ...workingCopies[workDir],
      };
      return {
        gitMeta,
        paneronMeta,
      };
    }));

  const repositoryLoadTimes =
    (await loadState<RepositoryLoadTimes>('repositoryLoadTimes'));

  const filteredRepositories: Repository[] = repositories.filter(repo => {
    if (matchesText) {
      const normalizedSubstring = matchesText.toLowerCase();

      const workDirMatches = repo.gitMeta.workingCopyPath.indexOf(normalizedSubstring) >= 0;

      const normalizedTitle = repo.paneronMeta?.title?.toLowerCase();
      const titleMatches = normalizedTitle !== undefined && normalizedTitle.indexOf(normalizedSubstring) >= 0;

      const datasetIDs = (Object.keys(repo.paneronMeta?.datasets ?? {})).join('');
      const datasetIDsMatch = datasetIDs.indexOf(normalizedSubstring) >= 0;

      const matches: boolean = workDirMatches || titleMatches || datasetIDsMatch;
      return matches;
    } else {
      return true;
    }
  }).sort((repo1, repo2) => {
    const [title1, title2] = [repo1.paneronMeta?.title?.toLowerCase(), repo2.paneronMeta?.title?.toLowerCase()];
    if (title1 && title2) {
      return title1.localeCompare(title2);
    } else {
      return 0;
    }
  });

  let sortedRepositories: Repository[];
  if (sortBy === 'recentlyLoaded' && repositoryLoadTimes !== undefined) {
    sortedRepositories = repositories.sort((repo1, repo2) => {
      const loadTime1: Date | undefined = repositoryLoadTimes[repo1.gitMeta.workingCopyPath];
      const loadTime2: Date | undefined = repositoryLoadTimes[repo2.gitMeta.workingCopyPath];
      if (loadTime1 && loadTime2) {
        if (loadTime1 > loadTime2) {
          return -1;
        } else {
          return 1;
        }
      } else {
        return 0;
      }
    });
  } else {
    sortedRepositories = filteredRepositories;
  }

  return { objects: sortedRepositories };
});


describeGitRepository.main!.handle(async ({ workingCopyPath }) => {
  let isLoaded: boolean;
  try {
    getLoadedRepository(workingCopyPath);
    isLoaded = true;
  } catch (e) {
    isLoaded = false;
  }
  return {
    info: await readRepoConfig(workingCopyPath),
    isLoaded,
  };
});


describeRepository.main!.handle(async ({ workingCopyPath }) => {
  const gitRepo = await readRepoConfig(workingCopyPath);

  let paneronRepo: PaneronRepository | undefined;
  try {
    paneronRepo = await readPaneronRepoMeta(workingCopyPath);
  } catch (e) {
    log.error("Unable to get Paneron repository information for working directory", workingCopyPath);
    paneronRepo = undefined;
  }
  return {
    info: {
      gitMeta: gitRepo,
      paneronMeta: paneronRepo,
    },
  };
});


updatePaneronRepository.main!.handle(async ({ workingCopyPath, info }) => {
  if (!info.title) {
    throw new Error("Proposed Paneron repository meta is missing title");
  }
  const existingMeta = await readPaneronRepoMeta(workingCopyPath);
  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Repository configuration is missing author information");
  }
  const repo = getLoadedRepository(workingCopyPath);
  const w = repo.workers.sync;
  const { newCommitHash } = await w.repo_updateBuffers({
    workDir: workingCopyPath,
    commitMessage: "Change repository title",
    author,
    bufferChangeset: {
      [PANERON_REPOSITORY_META_FILENAME]: {
        oldValue: serializeMeta(existingMeta),
        newValue: serializeMeta({
          ...existingMeta,
          title: info.title,
        }),
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


queryGitRemote.main!.handle(async ({ url, username, password }) => {
  const auth = { username, password };
  if (!auth.password) {
    auth.password = (await getAuth(url, username)).password;
  }
  return await oneOffWorkerTask(w => w.git_describeRemote({ url, auth }));
});


addRepository.main!.handle(async ({ gitRemoteURL, branch, username, password, author }) => {
  const workDirPath = path.join(DEFAULT_WORKING_DIRECTORY_CONTAINER, makeUUIDv4());

  if (fs.existsSync(workDirPath) || ((await readRepositories())).workingCopies[workDirPath] !== undefined) {
    throw new Error("Could not generate a valid non-occupied repository path inside given container.");
  }

  if (branch === undefined || branch.trim() === '') {
    throw new Error("Main branch name is not specified.");
  }

  const auth = { username, password };
  if (!auth.password) {
    auth.password = (await getAuth(gitRemoteURL, username)).password;
  }
  const { canPush } = await oneOffWorkerTask(w => w.git_describeRemote({ url: gitRemoteURL, auth }));

  await updateRepositories((data) => {
    if (data.workingCopies[workDirPath] !== undefined) {
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
    newData.workingCopies[workDirPath] = { remote, author, mainBranch: branch };
    return newData;
  });

  await loadRepo(workDirPath);

  repositoriesChanged.main!.trigger({
    changedWorkingPaths: [],
    deletedWorkingPaths: [],
    createdWorkingPaths: [workDirPath],
  });

  //const workers = await getRepoWorkers(workDirPath);

  //await workers.sync.initialize({ workDirPath: workDirPath });

  //await workers.sync.git_elone({
  //  repoURL: gitRemoteURL,
  //  auth,
  //});

  //repositoriesChanged.main!.trigger({
  //  changedWorkingPaths: [workDirPath],
  //  deletedWorkingPaths: [],
  //  createdWorkingPaths: [],
  //});

  return { success: true, workDir: workDirPath };
});


addDisconnected.main!.handle(async ({ gitRemoteURL, branch, username, password }) => {
  const workDirPath = path.join(DEFAULT_WORKING_DIRECTORY_CONTAINER, makeUUIDv4());
  if (fs.existsSync(workDirPath) || ((await readRepositories())).workingCopies[workDirPath] !== undefined) {
    throw new Error("Could not generate a valid non-occupied repository path inside given container.");
  }
  if (branch === undefined || branch.trim() === '') {
    throw new Error("Main branch name is not specified.");
  }
  const auth = { username, password };
  if (!auth.password) {
    auth.password = (await getAuth(gitRemoteURL, username)).password;
  }

  const workers = await getRepoWorkers(workDirPath);

  try {
    await workers.sync.git_clone({
      repoURL: gitRemoteURL,
      auth,
      branch,
    });
    await workers.sync.git_deleteOrigin({
      workDir: workDirPath,
    });
    await updateRepositories((data) => {
      const newData = { ...data };
      newData.workingCopies[workDirPath] = { mainBranch: branch };
      return newData;
    });
    repositoriesChanged.main!.trigger({
      changedWorkingPaths: [],
      deletedWorkingPaths: [],
      createdWorkingPaths: [workDirPath],
    });
    return { workDir: workDirPath, success: true };

  } catch (e) {
    fs.removeSync(workDirPath);
    throw e;
  }
});


createRepository.main!.handle(async ({ title, author, mainBranchName: branch }) => {
  const workDirPath = path.join(DEFAULT_WORKING_DIRECTORY_CONTAINER, makeUUIDv4());

  if (fs.existsSync(workDirPath)) {
    throw new Error("A repository with this name already exists. Please choose another name!");
  }

  if (branch === undefined || branch.trim() === '') {
    throw new Error("Please specify default main branch name in settings.");
  }

  await updateRepositories((data) => {
    if (data.workingCopies?.[workDirPath] !== undefined) {
      throw new Error("Repository already exists");
    }
    const newData = { ...data };
    newData.workingCopies[workDirPath] = {
      author,
      mainBranch: branch,
    };
    return newData;
  });

  const w = (await getRepoWorkers(workDirPath)).sync;

  log.debug("Repositories: Initializing new working directory", workDirPath);

  await w.git_init({
    defaultBranch: branch,
  });

  const paneronMeta: PaneronRepository = {
    title: title ?? "Unnamed repository",
    datasets: {},
  };

  log.debug("Repositories: Writing Paneron meta", workDirPath);

  const { newCommitHash, conflicts } = await w.repo_updateBuffers({
    workDir: workDirPath,
    commitMessage: "Initial commit",
    author,
    // _dangerouslySkipValidation: true, // Have to, since we cannot validate data
    bufferChangeset: {
      [PANERON_REPOSITORY_META_FILENAME]: {
        oldValue: null,
        newValue: serializeMeta(paneronMeta),
      },
    },
  });

  if (!newCommitHash) {
    log.error("Failed to create a repository—conflicts when writing initial commit!", conflicts);
    throw new Error("Could not create a repository");
  }

  log.debug("Repositories: Notifying about newly created repository");

  await loadRepo(workDirPath);

  repositoriesChanged.main!.trigger({
    changedWorkingPaths: [],
    deletedWorkingPaths: [],
    createdWorkingPaths: [workDirPath],
  });

  log.debug("Repositories: Created repository");

  return { success: true };
});


deleteRepository.main!.handle(async ({ workingCopyPath }) => {
  try {
    await loadedDatasets.unloadAll({ workDir: workingCopyPath });
    await unloadRepository(workingCopyPath);

  } catch (e) {
    log.warn("Repositories: Delete: Not loaded", workingCopyPath);
  }

  await oneOffWorkerTask(w => w.git_delete({
    workDir: workingCopyPath,

    // TODO: Make it so that this flag has to be passed all the way from calling code?
    yesReallyDestroyLocalWorkingCopy: true,
  }));

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
  await unloadRepository(workingCopyPath);
  await saveAuth(remoteURL, username, password);
  await loadRepo(workingCopyPath);
  return { success: true };
});



// Manipulating data


// listObjectPaths.main!.handle(async ({ workingCopyPath, query }) => {
//   return await cache.listPaths({ workingCopyPath, query });
// });
// 
// 
// listAllObjectPathsWithSyncStatus.main!.handle(async ({ workingCopyPath }) => {
//   // TODO: Rename to just list all paths; implement proper sync status checker for subsets of files.
// 
//   const paths = await cache.listPaths({ workingCopyPath });
// 
//   const result: Record<string, FileChangeType> =
//     paths.map(p => ({ [`/${p}`]: 'unchanged' as const })).reduce((p, c) => ({ ...p, ...c }), {});
// 
//   //const result = await w.listAllObjectPathsWithSyncStatus({ workDir: workingCopyPath });
//   log.info("Got sync status", JSON.stringify(result));
// 
//   return result;
// });


getBufferDataset.main!.handle(async ({ workingCopyPath, paths }) => {
  if (paths.length < 1) {
    return {};
  }

  const repo = getLoadedRepository(workingCopyPath);

  const w = repo.workers.reader;

  return await w.repo_getBufferDataset({
    workDir: workingCopyPath,
    paths,
  });
});


updateBuffers.main!.handle(async ({
  workingCopyPath,
  commitMessage,
  bufferChangeset,
  ignoreConflicts,
}) => {
  const repoCfg = await readRepoConfig(workingCopyPath);

  if (!repoCfg.author) {
    throw new Error("Author information is missing in repository config");
  }

  const repo = getLoadedRepository(workingCopyPath);
  const w = repo.workers.sync;

  const pathChanges = changesetToPathChanges(bufferChangeset);

  await reportBufferChanges(workingCopyPath, pathChanges);

  return await w.repo_updateBuffers({
    workDir: workingCopyPath,
    author: repoCfg.author,
    commitMessage,
    bufferChangeset,
    _dangerouslySkipValidation: ignoreConflicts,
  });
});


// commitChanges.main!.handle(async ({ workingCopyPath, commitMessage, changeset, ignoreConflicts }) => {
//   const w = await worker;
//   const repoCfg = await readRepoConfig(workingCopyPath);
// 
//   if (!repoCfg.author) {
//     throw new Error("Author information is missing in repository config");
//   }
// 
//   // Update Git repository
//   let outcome: CommitOutcome;
//   try {
//     outcome = await w.repo_updateBuffers({
//       workDir: workingCopyPath,
//       commitMessage,
//       bufferChangeset: changeset,
//       author: repoCfg.author,
//       _dangerouslySkipValidation: ignoreConflicts,
//     });
//   } catch (e) {
//     log.error("Repositories: Failed to change objects", workingCopyPath, Object.keys(changeset), commitMessage, e);
//     throw e;
//   }
// 
//   // Check outcome for conflicts
//   if (Object.keys(outcome.conflicts || {}).length > 0) {
//     if (!ignoreConflicts) {
//       log.error("Repositories: Conflicts while changing objects", outcome.conflicts);
//       throw new Error("Conflicts while changing objects");
//     } else {
//       log.warn("Repositories: Ignoring conflicts while changing objects", outcome.conflicts);
//     }
//   }
// 
//   // Update cache
//   await cache.applyChangeset({ workingCopyPath, changeset });
// 
//   // Send signals
//   if (outcome.newCommitHash) {
//     await repositoryContentsChanged.main!.trigger({
//       workingCopyPath,
//       objects: Object.keys(changeset).
//         map(path => ({ [path]: true as const })).
//         reduce((p, c) => ({ ...p, ...c }), {}),
//     });
//   } else {
//     log.warn("Repositories: Commit did not return commit hash");
//   }
// 
//   return outcome;
// });
