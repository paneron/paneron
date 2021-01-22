import { DiffStatus } from '@riboseinc/paneron-extension-kit/types/changes';
import { diffDatasets } from 'main/repositories/util';


/* Yields paths to buffers that differ between dataset1 and dataset2,
   and ChangeStatus for each path.

   Behavior mimics `listDescendantPathsAtVersion()`
   with `diffOpts.onlyChanged` set to true,
   i.e. unchanged paths will not be returned.
   
   Intended to check for conflicts before committing changes.
*/
export async function* diffBufferDatasets(
  bufferPaths: AsyncGenerator<string>,
  readBuffers:
    (bufferPath: string) =>
      Promise<[ buffer1: Uint8Array | null, buffer2: Uint8Array | null ]>,
): AsyncGenerator<[ path: string, changeStatus: DiffStatus ]> {
  return diffDatasets<Uint8Array>(bufferPaths, readBuffers, _arrayBuffersAreEqual);
}


function _arrayBuffersAreEqual(a: ArrayBuffer, b: ArrayBuffer) {
  return _dataViewsAreEqual(new DataView(a), new DataView(b));
}


function _dataViewsAreEqual(a: DataView, b: DataView) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i=0; i < a.byteLength; i++) {
    if (a.getUint8(i) !== b.getUint8(i)) return false;
  }
  return true;
}
