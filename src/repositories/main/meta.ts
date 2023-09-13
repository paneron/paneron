/**
 * Reading & updating Paneron metadata from within repositories.
 */

import path from 'path';
import log from 'electron-log';
import { readBuffer } from 'main/fs-utils';
import { deserializeMeta } from 'main/meta-serdes';
import { DatasetInfo } from 'datasets/types';
import { PaneronRepository, SOLE_DATASET_ID } from '../types';


export const PANERON_REPOSITORY_META_FILENAME = 'paneron.yaml';
export const DATASET_FILENAME = 'panerondataset.yaml';


/**
 * Returns deserialized Paneron repository metadata,
 * read from `PANERON_REPOSITORY_META_FILENAME` directly under `workingCopyPath`.
 */
export async function readPaneronRepoMeta(workingCopyPath: string): Promise<PaneronRepository> {
  const meta = readBuffer(path.join(workingCopyPath, PANERON_REPOSITORY_META_FILENAME));

  if (meta === null) {
    throw new Error("Paneron repository metadata file is not found");
  } else {
    return deserializeMeta(meta) as PaneronRepository;
  }
}


/**
 * Given working directory path & dataset ID,
 * returns absolute path to dataset directory on user’s machine at runtime.
 */
export function getDatasetRootAbsolute(absoluteWorkDirPath: string, datasetID: string) {
  if (datasetID !== SOLE_DATASET_ID) {
    return path.join(absoluteWorkDirPath, datasetID);
  } else {
    return absoluteWorkDirPath;
  }
}


/**
 * Resolves a dataset alias to POSIX-style dataset path
 * relative to its repository root.
 * Mostly exists after migration away from single-dataset repos,
 * for compatibility.
 *
 * @example
 * ```
 * getDatasetRoot('') => error
 * getDatasetRoot('@') => '/'
 * getDatasetRoot('dataset') => '/dataset'
 * getDatasetRoot('complex/dataset/id') => '/complex/dataset/id'
 * ```
 */
export function resolveDatasetAlias(datasetID: string): string {
  const _id = datasetID.trim();

  if (!_id) {
    throw new Error("Invalid dataset ID: looks like an empty string");
  }
  if (_id.startsWith('/') || _id.indexOf('\\') >= 0) {
    throw new Error("Invalid dataset ID: can’t start with a slash or have backslashes");
  }

  const datasetDir = _id !== SOLE_DATASET_ID ? datasetID : '';

  return `/${datasetDir}`;
}


/**
 * Returns deserialized dataset metadata, read from `DATASET_FILENAME`
 * relative to `datasetDir` within `workDir`
 * (or directly under `workDir`, if `datasetDir` is not given).
 */
export async function readDatasetMeta(workDir: string, datasetID: string):
Promise<DatasetInfo> {
  const datasetMetaPath = path.join(datasetRoot, DATASET_FILENAME);
  const datasetRoot = resolveDatasetAlias(datasetID);

  const meta = readBuffer(path.join(workDir, datasetMetaPath));

  if (meta === null) {
    log.error("Cannot read dataset metadata", workDir, datasetID, datasetMetaPath);
    throw new Error("Missing dataset metadata file");
  } else {
    return deserializeMeta(meta) as DatasetInfo;
  }
}
