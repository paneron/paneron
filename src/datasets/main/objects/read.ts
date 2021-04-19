import { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { API as Datasets } from '../../types';
import { getDefaultIndex, normalizeDatasetDir } from '../loadedDatasets';
import { findSerDesRuleForPath } from '@riboseinc/paneron-extension-kit/object-specs/ser-des';
import { getLoadedRepository } from 'repositories/main/loadedRepositories';


/* Do not read too many objects at once. May be slow. */
export const getObjectDataset: Datasets.Data.GetObjectDataset = async function ({
  workDir,
  datasetDir,
  objectPaths,
}) {
  const datasetDirNormalized = normalizeDatasetDir(datasetDir);

  console.debug("Worker: Repositories: getObjectDataset: Reading…", objectPaths)

  const objectDataset: ObjectDataset = (await Promise.all(
    objectPaths.map(async (objectPath) => {
      return {
        [objectPath]: await readObject(
          objectPath,
          workDir,
          datasetDirNormalized),
      };
    })
  )).reduce((prev, curr) => ({ ...prev, ...curr }), {});

  console.debug("Worker: Repositories: getObjectDataset: Got data", objectDataset);

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
  const rule = findSerDesRuleForPath(rootPath);
  const obj: Record<string, any> = rule.deserialize(bufferDataset, {});
  return obj;
}
