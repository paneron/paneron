import { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { readBuffers } from '../buffers/read';
import { Datasets } from '../types';
import { getIndex, normalizeDatasetDir } from '../datasets';
import { findSerDesRuleForExt } from '@riboseinc/paneron-extension-kit/object-specs/ser-des';


/* Do not read too many objects at once. May be slow. */
export const getObjectDataset: Datasets.Data.GetObjectDataset = async function ({
  workDir,
  datasetDir,
  objectPaths,
}) {
  const datasetDirNormalized = normalizeDatasetDir(datasetDir);

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

  const idx: Datasets.Util.DefaultIndex = getIndex(
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
export async function* readObjectsCold(
  objectPaths: AsyncGenerator<string>,
  makeObject: (fromBuffers: Record<string, Uint8Array>) => Record<string, any>,
): AsyncGenerator<Record<string, any>> {
  for await (const objectPath of objectPaths) {
    const buffers = await readBuffers(objectPath);
    yield makeObject(buffers);
  }
}


/* Given a root path to an object, reads data from filesystem
   and deserializes it into memory structure
   according to the rule corresponding to given extension. */
export async function readObjectCold(
  rootPath: string,
): Promise<Record<string, any> | null> {
  const bufferDataset = await readBuffers(rootPath);
  const rule = findSerDesRuleForExt(rootPath);
  const obj: Record<string, any> = rule.deserialize(bufferDataset, {});
  return obj;
}
