import path from 'path';
import { throttle } from 'throttle-debounce';
import yaml from 'js-yaml';
import { app } from 'electron';
import log from 'electron-log';
import {
  applyOutstandingMigrations, DATASET_FILENAME,
  deleteDataset,
  getDatasetInfo,
  getOutstandingMigration,
  initializeDataset,
  loadDataset,
  makeChangesetRepoRelative,
  proposeDatasetPath,
  reportMigrationStatus,
} from 'datasets';
import { readPaneronRepoMeta, readRepoConfig } from 'main/repositories';
import repoWorker from 'main/repositories/workerInterface';
//import cache from 'main/repositories/cache';
import { requireMainPlugin } from 'main/plugins';
import { checkPathIsOccupied, forceSlug } from 'utils';
import {
  GitAuthor,
  PANERON_REPOSITORY_META_FILENAME,

  // TODO: Define a more specific datasets changed event
  repositoriesChanged,
  repositoryContentsChanged,
} from 'repositories';
import { DatasetInfo, MigrationSequenceOutcome } from './types';


async function readDatasetMeta(workingCopyPath: string, datasetPath?: string):
Promise<DatasetInfo> {
  const meta = (await (await repoWorker).getObjectContents({
    workDir: path.join(workingCopyPath, datasetPath || ''),
    readObjectContents: { [DATASET_FILENAME]: 'utf-8' },
  }))[DATASET_FILENAME];

  if (meta === null) {
    throw new Error("Missing dataset metadata file");
  } else if (meta?.encoding !== 'utf-8') {
    throw new Error("Invalid dataset metadata file format");
  } else {
    return yaml.load(meta.value);
  }
}


getDatasetInfo.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  try {
    return { info: await readDatasetMeta(workingCopyPath, datasetPath) };
  } catch (e) {
    return { info: null };
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
    //await cache.invalidatePaths({
    //  workingCopyPath,
    //});
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

  if (!plugin.isCompatible(app.getVersion())) {
    throw new Error("Extension is not compatible with this version of Paneron");
  }

  const migration = plugin.getMigration(dataset.type.version);
  if (migration) {
    // Return an error here. Error GUI is expected to query the outstanding migration
    // using another IPC endpoint, and prompt the user to apply it (yet another IPC endpoint).
    throw new Error("Dataset migration is required");
  }


  // TODO: Build custom indexes, if any, here
  // const dbDirName = crypto.createHash('sha1').
  //   update(`${path.join(workingCopyPath, datasetPath)}\n${yaml.dump(dataset, { noRefs: true })}`).
  //   digest('hex');
  // const dbPath = path.join(app.getPath('userData'), dbDirName);
  // await plugin.buildIndexes(workingCopyPath, datasetPath, dbDirName);

  return { success: true };
});


getOutstandingMigration.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  const dataset = await readDatasetMeta(workingCopyPath, datasetPath);
  const plugin = await requireMainPlugin(dataset.type.id);
  const migration = plugin.getMigration(dataset.type.version);

  if (migration) {
    return { migration: { versionSpec: migration.versionSpec } };
  }

  return {};
});


applyOutstandingMigrations.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  const dataset = await readDatasetMeta(workingCopyPath, datasetPath);
  const plugin = await requireMainPlugin(dataset.type.id);

  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Repository configuration is missing author information");
  }

  const repos = await repoWorker;

  const datasetRootPath = path.join(workingCopyPath, datasetPath);

  const datasetMetaPath = path.join(datasetPath, DATASET_FILENAME);

  const reportStatusDebounced = throttle(200, reportMigrationStatus.main!.trigger);

  const changesApplied: MigrationSequenceOutcome["changesApplied"] = [];

  async function applyMigrationsRecursively(
    datasetVersion: string,
    author: GitAuthor): Promise<{ outcome: MigrationSequenceOutcome }> {

    const nextMigration = plugin.getMigration(datasetVersion);
    if (nextMigration) {
      const currentMigrationVersionSpec = nextMigration.versionSpec;

      reportMigrationStatus.main!.trigger({
        operation: "Loading migration",
        datasetVersion,
        currentMigrationVersionSpec,
      });

      const migrationFunc = (await nextMigration.migration()).default;

      reportMigrationStatus.main!.trigger({
        operation: "Gathering changes",
        datasetVersion,
        currentMigrationVersionSpec,
      });

      const migrationSpec = await migrationFunc({
        datasetRootPath,
        versionBefore: dataset.type.version,
        onProgress: (msg) => reportStatusDebounced({
          operation: `Gathering changes: ${msg}`,
          datasetVersion,
          currentMigrationVersionSpec,
        }),
      });

      reportMigrationStatus.main!.trigger({
        operation: "Reading existing dataset metadata",
        datasetVersion,
        currentMigrationVersionSpec,
      });

      const oldDatasetMeta = await readDatasetMeta(workingCopyPath, datasetPath);
      const newDatasetMeta = {
        ...oldDatasetMeta,
        type: {
          ...oldDatasetMeta.type,
          version: migrationSpec.versionAfter,
        },
      };

      reportMigrationStatus.main!.trigger({
        operation: "Committing gathered changes and updated dataset metadata",
        datasetVersion,
        currentMigrationVersionSpec,
      });

      const { newCommitHash, conflicts } = await repos.changeObjects({
        workDir: workingCopyPath,
        commitMessage: `Migrate from ${datasetVersion} (matched ${currentMigrationVersionSpec})`,
        author,
        writeObjectContents: {
          ...migrationSpec.changeset,
          [datasetMetaPath]: {
            oldValue: yaml.dump(oldDatasetMeta, { noRefs: true }),
            newValue: yaml.dump(newDatasetMeta, { noRefs: true }),
            encoding: 'utf-8',
          },
        },
      });

      if (newCommitHash) {
        changesApplied.push({ changeset: migrationSpec.changeset, commitHash: newCommitHash });
        reportMigrationStatus.main!.trigger({
          operation: "Checking for further outstanding migrations",
          datasetVersion: migrationSpec.versionAfter,
        });
        return await applyMigrationsRecursively(migrationSpec.versionAfter, author);
      } else {
        if (conflicts) {
          return {
            outcome: {
              success: false,
              changesApplied,
              error: {
                currentMigrationVersionSpec,
                message: "Changes gathered by this migration were not applied due to conflicting changes from another source",
                conflicts,
              },
            },
          };
        } else {
          return {
            outcome: {
              success: false,
              changesApplied,
              error: {
                currentMigrationVersionSpec,
                message: "Unable to apply changes gathered by this migration: commit was not created for unknown reason",
              },
            },
          };
        }
      }
    } else {
      // Sequence is finished
      return {
        outcome: {
          success: true,
          changesApplied,
        },
      };
    }
  }

  reportMigrationStatus.main!.trigger({
    operation: "Checking for outstanding migrations",
    datasetVersion: dataset.type.version,
  });

  try {
    return await applyMigrationsRecursively(dataset.type.version, author);
  } catch (e) {
    log.error("Error applying migration for dataset", dataset.type.id, dataset.type.version, e);
    return {
      outcome: {
        success: false,
        error: {
          message: `Migration reported an error (though some changes may have been applied): ${e.message}`,
        },
        changesApplied,
      },
    };
  }
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


getDatasetInfo.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  const meta = (await (await repoWorker).getObjectContents({
    workDir: path.join(workingCopyPath, datasetPath || ''),
    readObjectContents: { [DATASET_FILENAME]: 'utf-8' },
  }))[DATASET_FILENAME];

  if (meta === null) {
    return { info: null };
  } else if (meta?.encoding !== 'utf-8') {
    throw new Error("Invalid structured repository metadata file format");
  } else {
    return { info: yaml.load(meta.value) };
  }
});
