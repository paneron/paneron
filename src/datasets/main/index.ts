import fs from 'fs';
import { ensureDir } from 'fs-extra';
import path from 'path';
import { app } from 'electron';
import log from 'electron-log';
import { BufferChange } from '@riboseinc/paneron-extension-kit/types/buffers';
import { INITIAL_INDEX_STATUS } from '@riboseinc/paneron-extension-kit/types/indexes';

import { forceSlug } from 'utils';
import { checkPathIsOccupied } from 'main/checkPathIsOccupied';
import { serializeMeta } from 'main/meta-serdes';
import { requireMainPlugin } from 'plugins/main';

import {
  PaneronRepository,
  PANERON_REPOSITORY_META_FILENAME,

  // TODO: Define a more specific datasets changed event
  repositoriesChanged,
  repositoryBuffersChanged,
} from 'repositories/ipc';
import { readPaneronRepoMeta, readRepoConfig, DATASET_FILENAME, readDatasetMeta } from 'repositories/main/readRepoConfig';
import { getLoadedRepository } from 'repositories/main/loadedRepositories';

import loadedDatasets from './loadedDatasets';
import { getObjectDataset as getDataset } from './objects/read';
import { updateObjects as updateObj } from './objects/update';

import {
  deleteDataset,
  getDatasetInfo,
  initializeDataset,
  loadDataset,
  proposeDatasetPath,
  getObjectDataset,
  getOrCreateFilteredIndex,
  describeIndex,
  unloadDataset,
  getFilteredObject,
  locateFilteredIndexPosition,
  updateObjects,
  listRecentlyOpenedDatasets,
} from '../ipc';

import {
  list as _listRecentlyOpenedDatasets,
  record as _recordRecentlyOpenedDataset,
} from './recent';

import './migrations';


getDatasetInfo.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  log.debug("Reading dataset info", workingCopyPath, datasetPath);
  if (!datasetPath) {
    return { info: null }
  }
  try {
    return { info: await readDatasetMeta(workingCopyPath, datasetPath) };
  } catch (e) {
    log.error("Error reading dataset meta", e);
    return { info: null };
  }
});


proposeDatasetPath.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  if (!datasetPath) {
    throw new Error("Single-dataset repositories are not currently supported.");
  }

  const dir = forceSlug(datasetPath);
  const fullPath = path.join(workingCopyPath, dir);

  // For check to succeed, the path must not exist at all.
  // TODO: We could accept empty directory, but would vave to validate it’s absolutely empty.
  const isOccupied = await checkPathIsOccupied(fullPath);

  if (isOccupied) {
    return { path: undefined };
  } else {
    return { path: dir };
  }
});


initializeDataset.main!.handle(async ({ workingCopyPath, meta: datasetMeta, datasetPath }) => {
  if (!datasetPath) {
    throw new Error("Single-dataset repositories are not currently supported");
  }

  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Repository configuration is missing author information");
  }

  const plugin = await requireMainPlugin(
    datasetMeta.type.id,
    datasetMeta.type.version);

  const initialMigration = plugin.initialMigration;
  const initialMigrationResult = await initialMigration({
    datasetRootPath: path.join(workingCopyPath, datasetPath),
    onProgress: (msg) => log.debug("Migration progress:", msg),
  });

  // Prepare repo meta update
  const oldRepoMeta = await readPaneronRepoMeta(workingCopyPath);
  const newRepoMeta: PaneronRepository = {
    ...oldRepoMeta,
    dataset: undefined,
    datasets: {
      ...(oldRepoMeta.datasets || {}),
      [datasetPath]: true,
    },
  };
  const repoMetaChange: BufferChange = {
    oldValue: serializeMeta(oldRepoMeta),
    newValue: serializeMeta(newRepoMeta),
  };

  // Prepare dataset meta addition
  const datasetMetaAddition: BufferChange = {
    oldValue: null,
    newValue: serializeMeta(datasetMeta),
  };

  const repos = getLoadedRepository(workingCopyPath).workers.sync;

  const datasetMetaPath = path.join(datasetPath, DATASET_FILENAME);
  const migrationChangeset = initialMigrationResult.bufferChangeset;

  const { newCommitHash } = await repos.repo_updateBuffers({
    workDir: workingCopyPath,
    commitMessage: `Initialize dataset at ${datasetPath}`,
    author,
    bufferChangeset: {
      [datasetMetaPath]: datasetMetaAddition,
      [PANERON_REPOSITORY_META_FILENAME]: repoMetaChange,
      ...migrationChangeset,
    },
  });

  if (newCommitHash) {
    await repositoriesChanged.main!.trigger({
      changedWorkingPaths: [workingCopyPath],
    });
    await repositoryBuffersChanged.main!.trigger({
      workingCopyPath,
      changedPaths: {
        [datasetMetaPath]: true,
        [PANERON_REPOSITORY_META_FILENAME]: true,
      },
    });
    return { info: datasetMeta };
  } else {
    throw new Error("Dataset initialization failed to return a commit hash");
  }
});


const INDEX_DB_ROOT = path.join(app.getPath('userData'), 'index-dbs');


export async function clearIndexes() {
  fs.rmdirSync(INDEX_DB_ROOT, { recursive: true });
}


listRecentlyOpenedDatasets.main!.handle(async () => {
  return {
    datasets: await _listRecentlyOpenedDatasets(),
  };
});


loadDataset.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  //const dataset = await readDatasetMeta(workingCopyPath, datasetPath);
  //const plugin = await requireMainPlugin(dataset.type.id);

  //const migration = plugin.getMigration(dataset.type.version);
  //if (migration) {
  //  // Having encountered an error while loading the dataset,
  //  // GUI is expected to query the outstanding migration
  //  // using another IPC endpoint, and prompt the user to apply it (yet another IPC endpoint).
  //  throw new Error("Dataset migration is required");
  //}

  await _recordRecentlyOpenedDataset(workingCopyPath, datasetPath);

  log.debug("Datasets: Load: Ensuring cache root dir…", INDEX_DB_ROOT);

  await ensureDir(INDEX_DB_ROOT);

  //log.debug("Datasets: Load: Getting loaded repository worker");
  //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;

  log.debug("Datasets: Load: Loading dataset…");

  await loadedDatasets.load({ workDir: workingCopyPath, datasetDir: datasetPath, cacheRoot: INDEX_DB_ROOT });

  log.debug("Datasets: Load: Done");

  // TODO: Build custom indexes, if any, here
  // const dbDirName = crypto.createHash('sha1').
  //   update(`${path.join(workingCopyPath, datasetPath)}\n${yaml.dump(dataset, { noRefs: true })}`).
  //   digest('hex');
  // const dbPath = path.join(app.getPath('userData'), dbDirName);
  // await plugin.buildIndexes(workingCopyPath, datasetPath, dbDirName);

  return { success: true };
});


unloadDataset.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;
  log.debug("Unloading dataset", workingCopyPath, datasetPath);
  await loadedDatasets.unload({ workDir: workingCopyPath, datasetDir: datasetPath });
  return { success: true };
});


getOrCreateFilteredIndex.main!.handle(async ({ workingCopyPath, datasetPath, queryExpression, keyExpression }) => {
  //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;

  const { indexID } = await loadedDatasets.getOrCreateFilteredIndex({
    workDir: workingCopyPath,
    datasetDir: datasetPath,
    queryExpression,
    keyExpression,
  });

  //repoWorker.ds_index_streamStatus({
  //  workDir: workingCopyPath,
  //  datasetDir: datasetPath,
  //  indexID,
  //}).subscribe(status => {
  //  indexStatusChanged.main!.trigger({ workingCopyPath, datasetPath, status, indexID });
  //});

  return { indexID };
});


describeIndex.main!.handle(async ({ workingCopyPath, datasetPath, indexID }) => {
  if (indexID !== '') {
    //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;
    return await loadedDatasets.describeIndex({
      workDir: workingCopyPath,
      datasetDir: datasetPath,
      indexID,
    });
  } else {
    return { status: INITIAL_INDEX_STATUS };
  }
});


getObjectDataset.main!.handle(async ({ workingCopyPath, datasetPath, objectPaths }) => {
  //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;
  const data = await getDataset({
    workDir: workingCopyPath,
    datasetDir: datasetPath,
    objectPaths,
  });
  return { data };
});


getFilteredObject.main!.handle(async ({ workingCopyPath, datasetPath, indexID, position }) => {
  if (!indexID) {
    return { objectPath: '' };
  } else {
    //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;
    const { objectPath } = await loadedDatasets.getFilteredObject({
      workDir: workingCopyPath,
      datasetDir: datasetPath,
      indexID,
      position,
    });
    return { objectPath };
  }
});


locateFilteredIndexPosition.main!.handle(async ({ workingCopyPath, datasetPath, indexID, objectPath }) => {
  if (!indexID || !objectPath) {
    return { position: null };
  } else {
    try {
      return await loadedDatasets.locatePositionInFilteredIndex({
        workDir: workingCopyPath,
        datasetDir: datasetPath,
        indexID,
        objectPath,
      });
    } catch (e) {
      log.error("Failed to retrieve index position for object path", objectPath, indexID, e);
      return { position: null };
    }
  }
});


updateObjects.main!.handle(async ({ workingCopyPath, datasetPath, objectChangeset, commitMessage, _dangerouslySkipValidation }) => {
  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Repository configuration is missing author information");
  }
  // TODO: Save a version
  return await updateObj({
    workDir: workingCopyPath,
    datasetDir: datasetPath,
    objectChangeset,
    commitMessage,
    _dangerouslySkipValidation,
    author,
  });
});


deleteDataset.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  const w = getLoadedRepository(workingCopyPath).workers.sync;

  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Missing author information in repository config");
  }

  const repoMeta = await readPaneronRepoMeta(workingCopyPath);
  if (!repoMeta.datasets?.[datasetPath]) {
    throw new Error("Dataset is not found in Paneron repository meta");
  }

  // To ensure we are deleting a Paneron dataset
  await readDatasetMeta(workingCopyPath, datasetPath);

  // Delete dataset tree
  const deletionResult = await w.repo_deleteTree({
    workDir: workingCopyPath,
    commitMessage: `Delete dataset at ${datasetPath}`,
    author,
    treeRoot: datasetPath,
  });

  if (!deletionResult.newCommitHash) {
    throw new Error("Failed while deleting dataset object tree");
  }

  // Update repo meta
  const oldMetaBuffer = serializeMeta(repoMeta);
  delete repoMeta.datasets[datasetPath];
  const newMetaBuffer = serializeMeta(repoMeta);

  const datasetMetaPath = path.join(datasetPath, DATASET_FILENAME);

  const repoMetaUpdateResult = await w.repo_updateBuffers({
    workDir: workingCopyPath,
    commitMessage: "Record dataset deletion",
    author,
    bufferChangeset: {
      [PANERON_REPOSITORY_META_FILENAME]: {
        oldValue: oldMetaBuffer,
        newValue: newMetaBuffer,
      }
    },
  });

  if (repoMetaUpdateResult.newCommitHash) {
    await repositoriesChanged.main!.trigger({
      changedWorkingPaths: [workingCopyPath],
    });
    await repositoryBuffersChanged.main!.trigger({
      workingCopyPath,
      changedPaths: {
        [datasetMetaPath]: true,
        [PANERON_REPOSITORY_META_FILENAME]: true,
      },
    });
    return { success: true };
  } else {
    throw new Error("Recording dataset deletion failed to return a commit hash");
  }

});
