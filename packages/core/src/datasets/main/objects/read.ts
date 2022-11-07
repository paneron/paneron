import path from 'path';
import log from 'electron-log';

import type { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { findSerDesRuleForBuffers } from '@riboseinc/paneron-extension-kit/object-specs/ser-des';

import { getLoadedRepository } from 'repositories/main/loadedRepositories';
import { getDatasetRoot } from 'repositories/main/meta';

import { readLFSParams } from 'repositories/main/readRepoConfig';

import type { API as Datasets } from '../../types';
import { getDefaultIndex } from '../loadedDatasets';
import { LFSParams } from 'repositories/types';


/**
 * Reads multiple objects from filesystem (not from default index, i.e. cold).
 *
 * Uses object specs to build objects from buffers.
 * Returns structured data of objects matching given paths.
 * 
 * Do not read too many objects at once. May be slow, especially with `resolveLFS`.
 */
export const getObjectDataset: Datasets.Data.GetObjectDataset = async function ({
  workDir,
  datasetID,
  objectPaths,
  resolveLFS,
}) {
  const datasetRoot = getDatasetRoot('', datasetID);

  //console.debug("Worker: Repositories: getObjectDataset: Reading…", objectPaths)

  const objectDataset: ObjectDataset = (await Promise.all(
    objectPaths?.map(async (objectPath) => {
      return {
        [objectPath]: await readObjectCold(
          workDir,
          path.join(datasetRoot, objectPath),
          resolveLFS),
      };
    }) ?? []
  )).reduce((prev, curr) => ({ ...prev, ...curr }), {});

  //console.debug("Worker: Repositories: getObjectDataset: Got data", objectDataset);

  return objectDataset;
}


/**
 * Reads structured object data from default index.
 * Object must be loaded into default dataset index first.
 */
export async function readObject(
  objectPath: string,
  workDir: string,
  datasetID: string,
): Promise<Record<string, any> | null> {
  const idx: Datasets.Util.DefaultIndex = await getDefaultIndex(
    workDir,
    datasetID);

  let result: Record<string, any> | false;
  try {
    result = await idx.dbHandle.get(objectPath);
  } catch (e) {
    if ((e as any).type === 'NotFoundError') {
      return null;
    } else {
      throw e;
    }
  }

  if (result === false) {
    console.warn("Object had not yet been indexed", datasetID, objectPath);
    throw new Error("Object had not yet been indexed");
  }

  return result;
}


/**
 * Given a root path to an object, reads raw buffer data from filesystem
 * (and optionally LFS).
 *
 * Deserializes it into JS structure
 * according to ser/des rule provided by Paneron core.
 *
 * @param workDir repository working directory
 * @param rootPath object path, relative to working directory root
 * @returns Record<string, any> | null
 */
export async function readObjectCold(
  workDir: string,
  rootPath: string,

  /** Whether or not to try to download blobs corresponding to LFS pointers. */
  resolveLFS?: true,
): Promise<Record<string, any> | null> {
  const { workers: { reader } } = getLoadedRepository(workDir);

  let lfsResolutionOptions: LFSParams | undefined = undefined;
  if (resolveLFS) {
    lfsResolutionOptions = await readLFSParams(workDir);
  }

  let bufferDataset: Record<string, Uint8Array>;
  try {
    bufferDataset = await reader.repo_readBuffers({
      rootPath,
      resolveLFS: lfsResolutionOptions,
    });
  } catch (e) {
    // Check if it’s actually a nonexistent file error
    const repr = (e as any)?.toString?.() ?? '';
    if (repr.indexOf('ENOENT') >= 0) {
      return null;
    } else {
      console.error("readObjectCold: can’t read buffers", repr);
      throw e;
    }
  }

  if (Object.keys(bufferDataset).length < 1) {
    // Well, seems there’s no buffer or tree at given path.
    return null;
  }

  const rule = findSerDesRuleForBuffers(rootPath, bufferDataset);
  try {
    return rule.deserialize(bufferDataset, {});
  } catch (e) {
    log.error("Datasets: readObjectCold(): Error deserializing buffer dataset", workDir, rootPath, e);
    // Pretend the object does not exist?
    throw e;
  }
}


/**
 * Reads any number of versions of the same object.
 * Optimizes by only requesting worker & ser/des rule once for the whole procedure,
 * since it applies to the same object (just different versions of it).
 * 
 * The last argument is an array of commit hashes, and return value is an array of the same length.
 * Any element of the array can be either deserialized data of the object at that commit hash,
 * or null; however, if *all* values in the array are null, the error is raised.
 * 
 * NOTE: Does not resolve LFS yet.
 */ 
export async function readObjectVersions
<L extends number, C extends string[] & { length: L }>
(workDir: string, datasetID: string, objectPath: string, commitHashes: C):
Promise<(Record<string, any> | null)[] & { length: L }> {
  // TODO: Support resolving LFS in `readObjectVersions()`.

  const { workers: { sync } } = getLoadedRepository(workDir);

  const datasetRoot = getDatasetRoot('', datasetID);

  const bufferDatasets = await Promise.all(commitHashes.map(oid =>
    sync.repo_readBuffersAtVersion({ rootPath: path.join(datasetRoot, objectPath), commitHash: oid })
  )) as Record<string, Uint8Array>[] & { length: L };

  //const bufDs1 = await sync.repo_readBuffersAtVersion({ workDir, rootPath: path.join(datasetRoot, objectPath), commitHash: oidIndex! });
  //const bufDs2 = await sync.repo_readBuffersAtVersion({ workDir, rootPath: path.join(datasetRoot, objectPath), commitHash: oidCurrent });

  const objectDatasets = bufferDatasets.map(buffers => {
    if (Object.keys(buffers).length > 0) {
      const rule = findSerDesRuleForBuffers(objectPath, buffers);
      try {
        return rule.deserialize(buffers, {});
      } catch (e) {
        log.error("Datasets: readObjectVersions(): Error deserializing version for object", workDir, datasetRoot, objectPath, e);
        throw e;
      }
    } else {
      return null;
    }
  }) as (Record<string, any> | null)[] & { length: L };
  //const objDs1: Record<string, any> | null = Object.keys(bufDs1).length > 0 ? rule.deserialize(bufDs1, {}) : null;
  //const objDs2: Record<string, any> | null = Object.keys(bufDs2).length > 0 ? rule.deserialize(bufDs2, {}) : null;

  if (objectDatasets.filter(ds => ds !== null).length < 1) {
    log.error("Datasets: updateIndexesIfNeeded: Unable to read any object version", path.join(datasetRoot, objectPath), commitHashes);
    throw new Error("Unable to read any object version");
  }

  return objectDatasets;
}
