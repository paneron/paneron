import { ValueHook } from '@riboseinc/paneron-extension-kit/types';
import {
  listPaneronRepositories,
  listRepositories,
  PaneronRepository,
  repositoriesChanged,
} from 'repositories';
import type { Repository as GitRepository } from 'repositories/types';


interface RepositoryListHookQuery {
  matchesString?: string
}

export interface Repository {
  gitMeta: GitRepository
  paneronMeta?: PaneronRepository
}

interface RepositoryList {
  repositories: Repository[]
}

export default function useRepositoryList(query: RepositoryListHookQuery):
ValueHook<RepositoryList> {
  const repos = listRepositories.renderer!.useValue({}, { objects: [] });
  const paneronRepos = listPaneronRepositories.renderer!.useValue(
    { workingCopyPaths: repos.value.objects.map(v => v.workingCopyPath) },
    { objects: {} });

  repositoriesChanged.renderer!.useEvent(async () => {
    repos.refresh();
    paneronRepos.refresh();
  }, []);

  const repositories: Repository[] = repos.value.objects.map(gitMeta => {
    const paneronMeta: PaneronRepository | undefined =
      paneronRepos.value.objects[gitMeta.workingCopyPath] ?? undefined;

    return {
      gitMeta,
      paneronMeta,
    };
  });

  return {
    ...repos,
    isUpdating: repos.isUpdating || paneronRepos.isUpdating,
    value: { repositories },
    errors: [],
  };
}
