import type { DiffStatus } from '@riboseinc/paneron-extension-kit/types/changes';
import { diffDatasets } from '../repositories/util';


/**
 * Yields paths to buffers that differ between dataset1 and dataset2,
 * and ChangeStatus for each path.
 *
 * Behavior mimics `listDescendantPathsAtVersion()`
 * with `diffOpts.onlyChanged` set to true,
 * i.e. unchanged paths will not be returned.
 *
 * Intended to check for conflicts before committing changes.
 *
 * NOTE: Currently, objects are not considered the same only if their
 * JSON representations are identical (per `JSON.stringify()`);
 * meaning key order matters. This is a known problem.
 */
export async function* diffObjectDatasets(
  objectPaths: AsyncGenerator<string>,
  readObjects:
    (objectPath: string) =>
      Promise<[
        object1: Record<string, any> | null,
        object2: Record<string, any> | null,
      ]>,
): AsyncGenerator<[ path: string, changeStatus: DiffStatus ]> {
  return diffDatasets<Record<string, any>>(objectPaths, readObjects, objectsAreSame);
}


export function objectsAreSame(
  obj1: Record<string, any>,
  obj2: Record<string, any>,
): boolean {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}

