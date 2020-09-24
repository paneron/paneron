import { makeWindowForComponent } from '../window';
import { EmptyPayload, makeEndpoint, _ } from '../ipc';
import {
  GitAuthor,
  NewRepositoryDefaults,
  ObjectData,
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
  <{ remoteURL: string, username: string, password: string }>_,
  <{ success: true }>_,
);

export const deleteRepository = makeEndpoint.main(
  'deleteRepository',
  <{ workingCopyPath: string }>_,
  <{ deleted: true }>_,
);


// Making changes

export const readContents = makeEndpoint.main(
  'readContents',
  <{ workingCopyPath: string, objects: Record<string, true> }>_,
  <ObjectData>_,
);

export const commitChanges = makeEndpoint.main(
  'commitChanges',
  <{ workingCopyPath: string, changeset: ObjectData, commitMessage: string }>_,
  <{ success: true }>_,
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
      minWidth: 800,
      minHeight: 700,
      width: 800,
      height: 700,
    },
  },
);
