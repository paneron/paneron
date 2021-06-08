import path from 'path';
import log from 'electron-log';
import type { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { findSerDesRuleForPath } from '@riboseinc/paneron-extension-kit/object-specs/ser-des';
import { getLoadedRepository } from 'repositories/main/loadedRepositories';
import { API as Datasets } from '../../types';
import { getDefaultIndex, normalizeDatasetDir } from '../loadedDatasets';


/* Do not read too many objects at once. May be slow. */
export const getObjectDataset: Datasets.Data.GetObjectDataset = async function ({
  workDir,
  datasetDir,
  objectPaths,
}) {
  const datasetDirNormalized = normalizeDatasetDir(datasetDir);

  //console.debug("Worker: Repositories: getObjectDataset: Reading…", objectPaths)

  const objectDataset: ObjectDataset = (await Promise.all(
    objectPaths?.map(async (objectPath) => {
      return {
        [objectPath]: await readObject(
          objectPath,
          workDir,
          datasetDirNormalized),
      };
    }) ?? []
  )).reduce((prev, curr) => ({ ...prev, ...curr }), {});

  //console.debug("Worker: Repositories: getObjectDataset: Got data", objectDataset);

  return objectDataset;
}


/* Reads structured object data.
   Object must be loaded into default dataset index first.
*/
export async function readObject(
  objectPath: string,
  workDir: string,
  datasetDir: string,
): Promise<Record<string, any> | null> {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);

  const idx: Datasets.Util.DefaultIndex = await getDefaultIndex(
    workDir,
    normalizedDatasetDir);

  let result: Record<string, any> | false;
  try {
    result = await idx.dbHandle.get(objectPath);
  } catch (e) {
    if (e.type === 'NotFoundError') {
      return null;
    } else {
      throw e;
    }
  }

  if (result === false) {
    console.warn("Object had not yet been indexed", datasetDir, objectPath);
    throw new Error("Object had not yet been indexed");
  }

  return result;
}


/* Given a generator of object paths, yields objects.
   Each object is created using the provided makeObject. */
// export async function* readObjectsCold(
//   objectPaths: AsyncGenerator<string>,
//   makeObject: (fromBuffers: Record<string, Uint8Array>) => Record<string, any>,
// ): AsyncGenerator<Record<string, any>> {
//   for await (const objectPath of objectPaths) {
//     const buffers = await readBuffers(objectPath);
//     yield makeObject(buffers);
//   }
// }


/* Given a root path to an object, reads data from filesystem
   and deserializes it into memory structure
   according to the rule corresponding to given extension. */
export async function readObjectCold(
  workDir: string,
  rootPath: string,
): Promise<Record<string, any> | null> {
  const { workers: { reader } } = getLoadedRepository(workDir)
  const bufferDataset = await reader.repo_readBuffers({ workDir, rootPath });

  if (Object.keys(bufferDataset).length < 1) {
    // Well, seems there’s no buffer or tree at given path.
    return null;
  }

  const rule = findSerDesRuleForPath(rootPath);
  try {
    return rule.deserialize(bufferDataset, {});
  } catch (e) {
    log.error("Datasets: readObjectCold(): Error deserializing buffer dataset", workDir, rootPath, e);
    // Pretend the object does not exist.
    throw e;
  }
}


/* Reads any number of versions of the same object.
   Optimizes by only requesting worker & ser/des rule once for the whole procedure,
   since it applies to the same object (just different versions of it).

   The last argument is an array of commit hashes, and return value is an array of the same length.
   Any element of the array can be either deserialized data of the object at that commit hash,
   or null; however, if *all* values in the array are null, the error is raised.
*/
export async function readObjectVersions
<L extends number, C extends string[] & { length: L }>
(workDir: string, datasetDir: string, objectPath: string, commitHashes: C):
Promise<(Record<string, any> | null)[] & { length: L }> {
  const { workers: { sync } } = getLoadedRepository(workDir)
  const rule = findSerDesRuleForPath(objectPath);

  const bufferDatasets = await Promise.all(commitHashes.map(oid =>
    sync.repo_readBuffersAtVersion({ workDir, rootPath: path.join(datasetDir, objectPath), commitHash: oid })
  )) as Record<string, Uint8Array>[] & { length: L };
  //const bufDs1 = await sync.repo_readBuffersAtVersion({ workDir, rootPath: path.join(datasetDir, objectPath), commitHash: oidIndex! });
  //const bufDs2 = await sync.repo_readBuffersAtVersion({ workDir, rootPath: path.join(datasetDir, objectPath), commitHash: oidCurrent });

  const objectDatasets = bufferDatasets.map(bufDs => {
    if (Object.keys(bufDs).length > 0) {
      try {
        return rule.deserialize(bufDs, {});
      } catch (e) {
        log.error("Datasets: readObjectVersions(): Error deserializing version for object", workDir, datasetDir, objectPath, e);
        throw e;
      }
    } else {
      return null;
    }
  }) as (Record<string, any> | null)[] & { length: L };
  //const objDs1: Record<string, any> | null = Object.keys(bufDs1).length > 0 ? rule.deserialize(bufDs1, {}) : null;
  //const objDs2: Record<string, any> | null = Object.keys(bufDs2).length > 0 ? rule.deserialize(bufDs2, {}) : null;

  if (objectDatasets.filter(ds => ds !== null).length < 1) {
    log.error("Datasets: updateIndexesIfNeeded: Unable to read any object version", path.join(datasetDir, objectPath), commitHashes);
    throw new Error("Unable to read any object version");
  }

  return objectDatasets;
}
