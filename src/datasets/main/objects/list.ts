import path from 'path';


// TODO: Define composite object extension & ser/des logic via ser/des rules in extension kit.
const COMPOSITE_OBJECT_DIRNAME_EXTENSION = '.pan';


/**
 * Composite objects are directories with a special extension.
 * Given a buffer path that is possibly *within* a composite object,
 * returns a path to the containing composite object.
 * Returns slash-prepended POSIX-style path.
 * Note: this is to support a provisional feature.
 */
function getCompositeObjectPathForBufferPath(bufferPath: string): string | null {
  const parts = bufferPath.split(path.posix.sep);
  const firstCompositePartIndex =
    parts.findIndex(part => path.extname(part.toLowerCase()) === COMPOSITE_OBJECT_DIRNAME_EXTENSION);
  if (firstCompositePartIndex >= 0) {
    const objectPathParts = parts.slice(0, firstCompositePartIndex + 1);
    return `/${objectPathParts.join(path.posix.sep)}`;
  } else {
    return null;
  }
}


/**
 * Given a generator of buffer paths, yields strings representing object paths.
 *
 * NOTE: May return the same object path more than once, since multiple buffers
 * can be part of a single object (although that feature isn’t implemented yet).
 */
export async function* listObjectPaths(
  bufferPaths: AsyncGenerator<string>,
): AsyncGenerator<string> {
  for await (const bufferPath of bufferPaths) {
    if (bufferPath.startsWith('..')) {
      throw new Error(`Bad buffer path ${bufferPath}`)
    }
    const objectPath = getCompositeObjectPathForBufferPath(bufferPath);
    if (objectPath !== null) {
      yield objectPath;
    } else {
      yield bufferPath;
    }
  }
}
