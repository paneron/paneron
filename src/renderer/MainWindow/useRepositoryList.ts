import log from 'electron-log';
import { ValueHook } from '@riboseinc/paneron-extension-kit/types';

import { listRepositories, repositoriesChanged, repositoryBuffersChanged } from 'repositories/ipc';
import type { Repository, RepositoryListQuery } from 'repositories/types';


interface RepositoryList {
  objects: Repository[]
}

export default function useRepositoryList(query: RepositoryListQuery):
ValueHook<RepositoryList> {
  const hookResult = listRepositories.renderer!.useValue({ query }, { objects: [] });

  repositoriesChanged.renderer!.useEvent(async () => {
    log.debug("useRepositoryList: Handling “repositories changed” event");
    hookResult.refresh();
  }, []);

  repositoryBuffersChanged.renderer!.useEvent(async () => {
    log.debug("useRepositoryList: Handling “repository buffers changed” event");
    hookResult.refresh();
  }, []);

  return hookResult;
};
