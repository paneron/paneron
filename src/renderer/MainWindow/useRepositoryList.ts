import log from 'electron-log';
import { ValueHook } from '@riboseinc/paneron-extension-kit/types';

import { listRepositories, repositoriesChanged } from 'repositories/ipc';
import type { Repository, RepositoryListQuery } from 'repositories/types';


interface RepositoryList {
  objects: Repository[]
}

export default function useRepositoryList(query: RepositoryListQuery):
ValueHook<RepositoryList> & {
  selectRepo: (workDir: string) => Repository | undefined
  selectDataset: (workDir: string, datasetID: string) => true | undefined
} {
  const hookResult = listRepositories.renderer!.useValue({ query }, { objects: [] });

  repositoriesChanged.renderer!.useEvent(async () => {
    log.debug("useRepositoryList: Handling repositories changed event");
    hookResult.refresh();
  }, []);


  function selectRepo(workDir: string): Repository | undefined {
    return hookResult.value.objects.
      find(repo => repo.gitMeta.workingCopyPath === workDir);
  }

  function selectDataset(workDir: string, datasetID: string): true | undefined {
    const repo = selectRepo(workDir);
    if (repo && repo.paneronMeta?.datasets?.[datasetID]) {
      return true;
    }
    return undefined;
  }

  return {
    ...hookResult,
    selectRepo,
    selectDataset,
  };
};
