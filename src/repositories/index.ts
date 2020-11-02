import { makeWindowForComponent } from '../window';
import { EmptyPayload, makeEndpoint, _ } from '../ipc';
import {
  CommitOutcome,
  FileChangeType,
  GitAuthor,
  NewRepositoryDefaults,
  ObjectChangeset,
  ObjectDataset,
  Repository, RepositoryType,
  RepoStatus, StructuredRepoInfo,
} from './types';
export * from './types';


// Creating repos

export const listAvailableTypes = makeEndpoint.main(
  'listAvailableTypes',
  <EmptyPayload>_,
  <{ types: RepositoryType[] }>_,
);

export const addRepository = makeEndpoint.main(
  'addRepository',
  <{ gitRemoteURL: string, workingCopyPath: string, username: string, author: GitAuthor }>_,
  <{ success: true }>_,
);

export const createRepository = makeEndpoint.main(
  'createRepository',
  <{ workingCopyPath: string, author: GitAuthor, pluginID: string }>_,
  <{ success: true }>_,
);

export const getNewRepoDefaults = makeEndpoint.main(
  'getNewRepoDefaults',
  <EmptyPayload>_,
  <NewRepositoryDefaults>_,
);

export const validateNewWorkingDirectoryPath = makeEndpoint.main(
  'validateNewWorkingDirectoryPath',
  <{ _path: string }>_,
  <{ available: boolean }>_,
);

export const getDefaultWorkingDirectoryContainer = makeEndpoint.main(
  'getDefaultWorkingDirectoryContainer',
  <EmptyPayload>_,
  <{ path: string }>_,
);


export const selectWorkingDirectoryContainer = makeEndpoint.main(
  'selectWorkingDirectoryContainer',
  <{ _default: string }>_,
  <{ path: string }>_,
);


// Repo management

export const listRepositories = makeEndpoint.main(
  'listRepositories',
  <Record<never, never>>_,
  <{ objects: Repository[] }>_,
);

export const getRepositoryStatus = makeEndpoint.main(
  'getRepositoryStatus',
  <{ workingCopyPath: string }>_,
  <RepoStatus>_,
);

export const getRepositoryInfo = makeEndpoint.main(
  'getRepositoryInfo',
  <{ workingCopyPath: string }>_,
  <{ info: Repository }>_,
);

export const getStructuredRepositoryInfo = makeEndpoint.main(
  'getStructuredRepositoryInfo',
  <{ workingCopyPath: string }>_,
  <{ info: StructuredRepoInfo | null }>_,
);

export const savePassword = makeEndpoint.main(
  'savePassword',
  <{ workingCopyPath: string, remoteURL: string, username: string, password: string }>_,
  <{ success: true }>_,
);

export const setRemote = makeEndpoint.main(
  'setRemote',
  <{ workingCopyPath: string, url: string, username: string, password?: string }>_,
  <{ success: true }>_,
);

export const deleteRepository = makeEndpoint.main(
  'deleteRepository',
  <{ workingCopyPath: string }>_,
  <{ deleted: true }>_,
);


// Making changes

export const listObjectPaths = makeEndpoint.main(
  'listObjectPaths',
  <{ workingCopyPath: string, query: { pathPrefix: string, contentSubstring?: string } }>_,
  <string[]>_,
);

export const listAllObjectPathsWithSyncStatus = makeEndpoint.main(
  'listAllObjectPathsWithSyncStatus',
  <{ workingCopyPath: string }>_,
  <Record<string, FileChangeType>>_,
);

export const readContents = makeEndpoint.main(
  'readContents',
  <{ workingCopyPath: string, objects: Record<string, 'utf-8' | 'binary'> }>_,
  <ObjectDataset>_,
);

export const commitChanges = makeEndpoint.main(
  'commitChanges',
  <{ workingCopyPath: string, changeset: ObjectChangeset, commitMessage: string, ignoreConflicts?: true }>_,
  <CommitOutcome>_,
);


// Events

export const repositoriesChanged = makeEndpoint.renderer(
  'repositoriesChanged',
  <{ changedWorkingPaths?: string[], createdWorkingPaths?: string[], deletedWorkingPaths?: string[] }>_,
);

export const repositoryStatusChanged = makeEndpoint.renderer(
  'repositoryStatusChanged',
  <{ workingCopyPath: string, status: RepoStatus }>_,
);

export const repositoryContentsChanged = makeEndpoint.renderer(
  'repositoryContentsChanged',
  <{ workingCopyPath: string, objects?: Record<string, Exclude<FileChangeType, 'unchanged'> | true> }>_,
);


// Windows

export const repositoryDashboard = makeWindowForComponent(
  'repositoryDashboard',
  () => import('renderer/repositories/Dashboard'),
  'Dashboard',
  {
    dimensions: {
      minWidth: 500,
      minHeight: 600,
      width: 500,
      height: 600,
    },
  },
);

export const repositoryDetails = makeWindowForComponent(
  'repositoryDetails',
  () => import('renderer/repositories/Details'),
  'Repository',
  {
    dimensions: {
      minWidth: 980,
      minHeight: 600,
      width: 1100,
      height: 750,
    },
  },
);
