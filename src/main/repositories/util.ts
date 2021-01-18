import { stripTrailingSlash } from 'utils';


export function normalizeURL(repoURL: string): string {
  const slashNormalized = stripTrailingSlash(repoURL);
  const suffixNormalized = slashNormalized.endsWith('.git')
    ? slashNormalized
    : `${slashNormalized}.git`;
  return suffixNormalized;
}
