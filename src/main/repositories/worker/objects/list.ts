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
