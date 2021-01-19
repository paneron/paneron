import { readBuffers } from '../buffers/read';


/* Given a generator of buffer paths, yields strings representing object paths.
   It may return the same object path more than once, since multiple buffers
   can represent a single object. */
export async function* listObjectPaths(
  bufferPaths: AsyncGenerator<string>,
  belongsToObject: (bufferPath: string) => string | null,
): AsyncGenerator<string> {
  for await (const bufferPath of bufferPaths) {
    const objectPath = belongsToObject(bufferPath);
    if (objectPath !== null) {
      yield objectPath;
    }
  }
}


/* Given a generator of object paths, yields objects.
   Each object is created using the provided makeObject. */
export async function* readObjects(
  objectPaths: AsyncGenerator<string>,
  makeObject: (fromBuffers: Record<string, Uint8Array>) => Record<string, any>,
): AsyncGenerator<Record<string, any>> {
  for await (const objectPath of objectPaths) {
    const buffers = await readBuffers(objectPath);
    yield makeObject(buffers);
  }
}
