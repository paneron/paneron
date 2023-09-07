import type { DiffStatus } from '@riboseinc/paneron-extension-kit/types/changes';
import { diffDatasets } from '../repositories/util';
import { normalizeObject } from '../utils';


/**
 * Yields paths to buffers that differ between dataset1 and dataset2,
 * and ChangeStatus for each path.
 *
 * Behavior mimics `listDescendantPathsAtVersion()`
 * with `diffOpts.onlyChanged` set to true,
 * i.e. unchanged paths will not be returned.
 *
 * Intended to check for conflicts before committing changes.
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


/**
 * Returns `true` if both given objects have identical shape,
 * disregarding key ordering.
 */
export function objectsAreSame(
  obj1: Record<string, any>,
  obj2: Record<string, any>,
): boolean {
  return JSON.stringify(normalizeObject(obj1)) === JSON.stringify(normalizeObject(obj2));
}
