import { DiffStatus } from '@riboseinc/paneron-extension-kit/types/changes';
import { Object } from '@riboseinc/paneron-extension-kit/types/objects';
import { diffDatasets } from 'main/repositories/util';


/* Yields paths to buffers that differ between dataset1 and dataset2,
   and ChangeStatus for each path.

   Behavior mimics `listDescendantPathsAtVersion()`
   with `diffOpts.onlyChanged` set to true,
   i.e. unchanged paths will not be returned.
   
   Intended to check for conflicts before committing changes.
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
  return diffDatasets<Object>(objectPaths, readObjects, objectsAreSame);
}


function objectsAreSame(obj1: Object, obj2: Object): boolean {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}
