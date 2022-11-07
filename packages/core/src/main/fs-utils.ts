import { statSync, readFileSync } from 'fs';


export function checkPathIsOccupied(absolutePath: string): boolean {
  try {
    statSync(absolutePath);
  } catch (e) {
    if ((e as any).code === 'ENOENT') {
      return false;
    } else {
      throw e;
    }
  }
  return true;
}


/**
 * Returns blob at given absolute path, or null if it doesn’t exist.
 *
 * Buffer is considered nonexistent if ENOENT is received,
 * other errors are thrown.
 */
export function readBuffer(fullPath: string): Uint8Array | null {
  try {
    return readFileSync(fullPath);
  } catch (e) {
    if ((e as any).code === 'ENOENT') {
      return null;
    } else {
      throw e;
    }
  }
}
