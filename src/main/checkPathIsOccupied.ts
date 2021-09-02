import { statSync } from 'fs';



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
