import path from 'path';
import yaml from 'js-yaml';
import log from 'electron-log';
import {
  deleteDataset,
  getDatasetInfo,
  initializeDataset,
  loadDataset,
  makeChangesetRepoRelative,
  proposeDatasetPath,
  listObjectPaths,
  readObjects,
} from 'datasets';
import { readPaneronRepoMeta, readRepoConfig } from 'main/repositories';
import repoWorker from 'main/repositories/workerInterface';
import { worker as pluginWorker } from 'main/plugins';
import cache from 'main/repositories/cache';
import { requireMainPlugin } from 'main/plugins';
import { checkPathIsOccupied, forceSlug } from 'utils';
import {
  PANERON_REPOSITORY_META_FILENAME,

  // TODO: Define a more specific datasets changed event
  repositoriesChanged,
  repositoryContentsChanged,
} from 'repositories';

import { DATASET_FILENAME, readDatasetMeta } from './util';

import './migrations';


getDatasetInfo.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  try {
    return { info: await readDatasetMeta(workingCopyPath, datasetPath) };
  } catch (e) {
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


initializeDataset.main!.handle(async ({ workingCopyPath, meta, datasetPath }) => {
  if (!datasetPath) {
    throw new Error("Single-dataset repositories are not currently supported");
  }

  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Repository configuration is missing author information");
  }

  const plugin = await requireMainPlugin(meta.type.id, meta.type.version);
  const initialMigration = await plugin.getInitialMigration();
  const initialMigrationResult = await initialMigration.default({
    datasetRootPath: path.join(workingCopyPath, datasetPath),
    onProgress: (msg) => log.debug("Migration progress:", msg),
  });

  const repoMeta = await readPaneronRepoMeta(workingCopyPath);

  const datasetMetaPath = path.join(datasetPath, DATASET_FILENAME);

  const repos = await repoWorker;

  const { newCommitHash } = await repos.changeObjects({
    workDir: workingCopyPath,
    commitMessage: `Initialize dataset at ${datasetPath}`,
    author,
    writeObjectContents: {
      [datasetMetaPath]: {
        oldValue: null,
        newValue: yaml.dump(meta, { noRefs: true }),
        encoding: 'utf-8',
      },
      [PANERON_REPOSITORY_META_FILENAME]: {
        oldValue: yaml.dump(repoMeta, { noRefs: true }),
        newValue: yaml.dump({
          ...repoMeta,
          datasets: {
            ...(repoMeta.datasets || {}),
            [datasetPath]: true,
          },
        }, { noRefs: true }),
        encoding: 'utf-8',
      },
      ...makeChangesetRepoRelative(initialMigrationResult.changeset, datasetPath),
    },
  });

  if (newCommitHash) {
    await cache.invalidatePaths({
      workingCopyPath,
    });
    await repositoriesChanged.main!.trigger({
      changedWorkingPaths: [workingCopyPath],
    });
    await repositoryContentsChanged.main!.trigger({
      workingCopyPath,
      objects: {
        [datasetMetaPath]: true,
        [PANERON_REPOSITORY_META_FILENAME]: true,
      },
    });
    return { info: meta };
  } else {
    throw new Error("Dataset initialization failed to return a commit hash");
  }
});


loadDataset.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  const dataset = await readDatasetMeta(workingCopyPath, datasetPath);

  const plugin = await requireMainPlugin(dataset.type.id);

  const migration = plugin.getMigration(dataset.type.version);
  if (migration) {
    // Having encountered an error while loading the dataset,
    // GUI is expected to query the outstanding migration
    // using another IPC endpoint, and prompt the user to apply it (yet another IPC endpoint).
    throw new Error("Dataset migration is required");
  }

  const objectSpecs = plugin.getObjectSpecs();

  log.debug("Datasets: Load: Registering object specs…", objectSpecs);

  (await repoWorker).registerObjectSpecs({
    workDir: workingCopyPath,
    datasetDir: datasetPath,
    specs: objectSpecs,
  });

  log.debug("Datasets: Load: Registering object specs… Done");

  // TODO: Build custom indexes, if any, here
  // const dbDirName = crypto.createHash('sha1').
  //   update(`${path.join(workingCopyPath, datasetPath)}\n${yaml.dump(dataset, { noRefs: true })}`).
  //   digest('hex');
  // const dbPath = path.join(app.getPath('userData'), dbDirName);
  // await plugin.buildIndexes(workingCopyPath, datasetPath, dbDirName);

  return { success: true };
});


listObjectPaths.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  const datasetID = path.join(workingCopyPath, datasetPath);
  const { objectPaths } = await (await pluginWorker).listObjectPaths({ datasetID });
  return { objectPaths };
});


readObjects.main!.handle(async ({ workingCopyPath, datasetPath, objectPaths }) => {
  const datasetID = path.join(workingCopyPath, datasetPath);
  const { data } = await (await pluginWorker).readObjects({ datasetID, objectPaths });
  return { data };
});


deleteDataset.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  const w = await repoWorker;

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

  const deletionResult = await w.deleteTree({
    workDir: workingCopyPath,
    commitMessage: `Delete dataset at ${datasetPath}`,
    author,
    treeRoot: datasetPath,
  });

  if (!deletionResult.newCommitHash) {
    throw new Error("Failed while deleting dataset object tree");
  }

  const snapshot = yaml.dump(repoMeta, { noRefs: true });
  delete repoMeta.datasets[datasetPath];

  const repoMetaUpdateResult = await w.changeObjects({
    workDir: workingCopyPath,
    commitMessage: "Record dataset deletion",
    author,
    writeObjectContents: {
      [PANERON_REPOSITORY_META_FILENAME]: {
        oldValue: snapshot,
        newValue: yaml.dump(repoMeta, { noRefs: true }),
        encoding: 'utf-8',
      }
    },
  });

  if (repoMetaUpdateResult.newCommitHash) {
    await repositoriesChanged.main!.trigger({
      changedWorkingPaths: [workingCopyPath],
    });
    return { success: true };
  } else {
    throw new Error("Recording dataset deletion failed to return a commit hash");
  }

});
