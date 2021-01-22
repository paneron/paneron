import { DiffStatus } from '@riboseinc/paneron-extension-kit/types/changes';
import { stripTrailingSlash } from 'utils';


export function normalizeURL(repoURL: string): string {
  const slashNormalized = stripTrailingSlash(repoURL);
  const suffixNormalized = slashNormalized.endsWith('.git')
    ? slashNormalized
    : `${slashNormalized}.git`;
  return suffixNormalized;
}



export async function* diffDatasets<O extends Object | Buffer>(
  paths: AsyncGenerator<string>,
  readItems: (path: string) => Promise<[ item1: O | null, item2: O | null ]>,
  compareItems: (item1: O, item2: O) => boolean,
): AsyncGenerator<[ path: string, changeStatus: DiffStatus ]> {

  for await (const p of paths) {
    const [item1, item2] = await readItems(p);

    if (item1 === null || item2 === null) {
      if (item1 !== item2) {
        // Only one is null, so buffer either added or removed
        if (item1 === null) {
          yield [p, 'added'];
        } else {
          yield [p, 'removed'];
        }
      } else {
        // Both are null
        yield [p, 'unchanged'];
      }
    }

    else if (!compareItems(item1, item2)) {
      yield [p, 'modified'];
    }

    else {
      yield [p, 'unchanged'];
    }
  }
}
