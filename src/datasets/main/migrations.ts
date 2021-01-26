import path from 'path';
import log from 'electron-log';

import { throttle } from 'throttle-debounce';
import { BufferChange } from '@riboseinc/paneron-extension-kit/types/buffers';
import { requireMainPlugin } from 'main/plugins';
import { readRepoConfig } from 'main/repositories';
import repoWorker from 'main/repositories/workerInterface';

import { applyOutstandingMigrations, getOutstandingMigration, reportMigrationStatus } from '..';
import { MigrationSequenceOutcome } from '../types';
import { DATASET_FILENAME, readDatasetMeta, serializeMeta } from './util';
import { GitAuthor } from 'repositories/types';


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
      const datasetMetaChange: BufferChange = {
        oldValue: serializeMeta(oldDatasetMeta),
        newValue: serializeMeta(newDatasetMeta),
      };

      reportMigrationStatus.main!.trigger({
        operation: "Committing gathered changes and updated dataset metadata",
        datasetVersion,
        currentMigrationVersionSpec,
      });

      const { newCommitHash, conflicts } = await repos.repo_updateBuffers({
        workDir: workingCopyPath,
        commitMessage: `Migrate from ${datasetVersion} (matched ${currentMigrationVersionSpec})`,
        author,
        bufferChangeset: {
          ...migrationSpec.bufferChangeset,
          [datasetMetaPath]: datasetMetaChange,
        },
      });

      if (newCommitHash) {
        changesApplied.push({
          bufferChangeset: migrationSpec.bufferChangeset,
          commitHash: newCommitHash,
        });
        reportMigrationStatus.main!.trigger({
          operation: "Checking for further outstanding migrations",
          datasetVersion: migrationSpec.versionAfter,
        });
        return await applyMigrationsRecursively(
          migrationSpec.versionAfter,
          author);

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
