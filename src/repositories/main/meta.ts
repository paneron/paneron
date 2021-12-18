/**
 * Reading & updating Paneron metadata from within repositories.
 */

import path from 'path';
import log from 'electron-log';
import { DatasetInfo } from '../../datasets/types';
import { deserializeMeta } from '../../main/meta-serdes';
import { PaneronRepository, SOLE_DATASET_ID } from '../types';
import { readBuffer } from 'main/fs-utils';


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
    return deserializeMeta(meta);
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
 * Given working directory path & dataset ID,
 * returns path to dataset root (with no leading/trailing slashes)
 * relative to given repository root.
 * 
 * Repository root can be empty string,
 * in which case the returned path will start with leading slash.
 * 
 * Examples:
 * 
 *     getDatasetRoot('', '') => error
 *     getDatasetRoot('', '@') => '/'
 *     getDatasetRoot('testrepo', '@') => 'testrepo/'
 *     getDatasetRoot('testrepo', 'dataset') => 'testrepo/dataset'
 *     getDatasetRoot('', 'complex/dataset/id') => '/complex/dataset/id'
 */
export function getDatasetRoot(workDirPath: string, datasetID: string) {
  if (!datasetID.trim()) {
    throw new Error("Invalid dataset ID");
  }

  const datasetDir = datasetID !== SOLE_DATASET_ID
    ? datasetID
    : '';

  const result = path.join(workDirPath, datasetDir);
  return (result !== '.' ? result : '/');
}


/**
 * Returns deserialized dataset metadata, read from `DATASET_FILENAME`
 * relative to `datasetDir` within `workDir`
 * (or directly under `workDir`, if `datasetDir` is not given).
 */
export async function readDatasetMeta(workDir: string, datasetID: string):
Promise<DatasetInfo> {
  const datasetRoot = getDatasetRoot('', datasetID);
  const datasetMetaPath = path.join(datasetRoot, DATASET_FILENAME);

  const meta = readBuffer(path.join(workDir, datasetMetaPath));

  if (meta === null) {
    log.error("Cannot read dataset metadata", workDir, datasetID, datasetMetaPath);
    throw new Error("Missing dataset metadata file");
  } else {
    return deserializeMeta(meta);
  }
}
