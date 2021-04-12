import type { DiffStatus } from '@riboseinc/paneron-extension-kit/types/changes';
import type { Object } from '@riboseinc/paneron-extension-kit/types/objects';
import { stripTrailingSlash } from '../../utils';


export function normalizeURL(repoURL: string): string {
  const slashNormalized = stripTrailingSlash(repoURL);
  const suffixNormalized = slashNormalized.endsWith('.git')
    ? slashNormalized
    : `${slashNormalized}.git`;
  return suffixNormalized;
}



/* General tool that diffs streams of items, could be buffers or objects,
   and returns tuples of [objectPath: string, DiffStatus]. */
export async function* diffDatasets<O extends Object | Buffer>(
  paths: AsyncGenerator<string>,
  readItems: (path: string) => Promise<[ item1: O | null, item2: O | null ]>,
  compareItems: (item1: O, item2: O) => boolean,
): AsyncGenerator<[ path: string, changeStatus: DiffStatus ]> {
  for await (const p of paths) {
    const [item1, item2] = await readItems(p);
    yield [p, diffItems(item1, item2, compareItems)];
  }
}

export function diffItems<T>(
  item1: T | null,
  item2: T | null,
  compareItems: (item1: T, item2: T) => boolean,
): DiffStatus {

  if (item1 === null || item2 === null) {
    if (item1 !== item2) {
      // Only one is null, so item either added or removed
      if (item1 === null) {
        return 'added';
      } else {
        return 'removed';
      }
    } else {
      // Both are null, so item never existed (unexpected case)
      return 'unchanged';
    }
  }

  else if (!compareItems(item1, item2)) {
    return 'modified';
  }

  else {
    return 'unchanged';
  }
}
