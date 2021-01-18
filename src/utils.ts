import fs from 'fs';


export function forceSlug(val: string): string {
  return val.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');
}


export async function checkPathIsOccupied(absolutePath: string): Promise<boolean> {
  try {
    fs.statSync(absolutePath);
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
