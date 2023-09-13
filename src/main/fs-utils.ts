/** Platform-specific FS-related utils. */

import { statSync, readFileSync } from 'fs';

import { stripLeadingSlash as posixStripLeadingSlash } from '../utils';

import nodePath from 'path';


/**
 * Convert platform-specific path returned by Node to POSIX format used internally.
 * No-op on POSIX systems.
 *
 * NOTE: For performance, doesn’t check that given path is POSIX or not.
 * If you have obtained a path using Node’s fs/path layers,
 * wrap it in this function if you need to pass that path anywhere else.
 */
export const posixifyPath: (platformSpecificPath: string) => string =
  process.platform === 'win32'
    ? function posixifyPath(aPath) { return aPath.split(nodePath.sep).join(nodePath.posix.sep); }
    : function posixifyPathNoOp(aPath) { return aPath; }

/**
 * Convert POSIX format path to platform-specific format for filesystem access.
 * No-op on POSIX systems.
 *
 * NOTE: For performance, doesn’t check that given path is POSIX or not.
 * Wrap paths in this function when reading data from filesystem,
 * unless you have obtained platform-specific path within the same function.
 */
export const deposixifyPath: (posixPath: string) => string =
  process.platform === 'win32'
    ? function deposixifyPath(aPath) { return aPath.split(nodePath.posix.sep).join(nodePath.sep); }
    : function deposixifyPathNoOp(aPath) { return aPath; };


export const stripLeadingSlashPlatformSpecific: (maybeSlashPrependedPath: string) => string =
  process.platform === 'win32'
    ? function stripLeadingSlashWin32(aPath) { return aPath.replace(/^\\/, ''); }
    : posixStripLeadingSlash;


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
