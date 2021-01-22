import crypto from 'crypto';
import { statSync } from 'fs';


export function forceSlug(val: string): string {
  return val.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');
}


export function checkPathIsOccupied(absolutePath: string): boolean {
  try {
    statSync(absolutePath);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return false;
    } else {
      throw e;
    }
  }
  return true;
}


export function stripLeadingSlash(aPath: string): string {
  return aPath.replace(/^\//, '');
}


export function stripTrailingSlash(aPath: string): string {
  return aPath.replace(/\/$/, '');
}


export function hash(val: string): string {
  return crypto.createHash('sha1').update(val).digest('hex');
}
