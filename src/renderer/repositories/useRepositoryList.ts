import { ValueHook } from '@riboseinc/paneron-extension-kit/types';

import {
  listRepositories,
  repositoriesChanged,
} from 'repositories/ipc';

import type { Repository, RepositoryListQuery } from 'repositories/types';


interface RepositoryList {
  objects: Repository[]
}

export default function useRepositoryList(query: RepositoryListQuery):
ValueHook<RepositoryList> {
  const hookResult = listRepositories.renderer!.useValue({ query }, { objects: [] });

  repositoriesChanged.renderer!.useEvent(async () => {
    hookResult.refresh();
  }, []);

  return hookResult;
};
