import { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';


/* Returns paths to buffers that change between dataset1 and dataset2. */
export function diffBufferDatasets(dataset1: BufferDataset, dataset2: BufferDataset) {
  const paths1 = new Set(Object.keys(dataset1));
  const paths2 = new Set(Object.keys(dataset2));

  const samePaths: boolean = (
    paths1.size === paths2.size &&
    JSON.stringify([...paths1].sort()) === JSON.stringify([...paths2].sort())
  );

  if (!samePaths) {
    throw new Error("Unable to check for conflicts: Changeset and dataset contain different buffer paths");
  }
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
