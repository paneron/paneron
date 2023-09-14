// TODO: Define composite object extension & ser/des logic via ser/des rules in extension kit.
const COMPOSITE_OBJECT_DIRNAME_EXTENSION = '.pan';


/**
 * Given a buffer path that is possibly *within* a composite object,
 * returns a path to the containing composite object.
 *
 * Returns slash-prepended POSIX-style path
 * (or null, if buffer path does not belong to a composite object).
 *
 * Composite objects are directories with a special extension,
 * each representing a single logical object comprised of multiple
 * “physical” buffers (e.g., files on disk).
 *
 * NOTE: this is to support a provisional feature.
 */
function getCompositeObjectPathForBufferPath(bufferPath: string): string | null {
  const parts = bufferPath.split('/');
  const firstCompositePartIndex =
    parts.findIndex(part => part.toLowerCase().split('.').at(-1) === COMPOSITE_OBJECT_DIRNAME_EXTENSION);
  if (firstCompositePartIndex >= 0) {
    const objectPathParts = parts.slice(0, firstCompositePartIndex + 1);
    return `/${objectPathParts.join('/')}`;
  } else {
    return null;
  }
}


/**
 * Given a generator of buffer paths, streams strings representing
 * logical object paths.
 *
 * NOTE: May return the same object path more than once, since multiple buffers
 * can be part of a single object (although that feature isn’t implemented yet).
 */
export async function * listObjectPaths(
  /**
   * A generator of POSIX-style slash-prepended “physical” buffer paths.
   */
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
