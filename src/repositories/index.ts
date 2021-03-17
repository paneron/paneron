import { makeWindowForComponent } from '../window';
import { EmptyPayload, makeEndpoint, _ } from '../ipc';
import {
  GitAuthor,
  NewRepositoryDefaults,
  RepoStatus,
  Repository,
  PaneronRepository,
  GitRepository,
  RepositoryListQuery,
} from './types';
import { ChangeStatus, CommitOutcome } from '@riboseinc/paneron-extension-kit/types/changes';
import { BufferChangeset, BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
export * from './types';


export const PANERON_REPOSITORY_META_FILENAME = 'paneron.yaml';


export const queryGitRemote = makeEndpoint.main(
  'queryRemote',
  <{ url: string, username: string, password?: string }>_,
  <{ isBlank: boolean, canPush: boolean }>_,
);


// Creating repos

export const addRepository = makeEndpoint.main(
  'addRepository',
  <{ gitRemoteURL: string, workingCopyPath: string, username: string, password?: string, author: GitAuthor }>_,
  <{ success: true }>_,
);

export const createRepository = makeEndpoint.main(
  'createRepository',
  <{ workingCopyPath: string, author: GitAuthor, title: string }>_,
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
  <{ query: RepositoryListQuery }>_,
  <{ objects: Repository[] }>_,
);

export const loadRepository = makeEndpoint.main(
  'loadRepository',
  <{ workingCopyPath: string }>_,
  <RepoStatus>_,
);

/* Only works on loaded repositories. */
export const describeRepository = makeEndpoint.main(
  'getRepository',
  <{ workingCopyPath: string }>_,
  <{ info: Repository }>_,
);

export const deleteRepository = makeEndpoint.main(
  'deleteRepository',
  <{ workingCopyPath: string }>_,
  <{ deleted: true }>_,
);


// Git repositories

export const describeGitRepository = makeEndpoint.main(
  'getGitRepository',
  <{ workingCopyPath: string }>_,
  <{ info: GitRepository, isLoaded: boolean }>_,
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

export const unsetRemote = makeEndpoint.main(
  'unsetRemote',
  <{ workingCopyPath: string }>_,
  <{ success: true }>_,
);

export const unsetWriteAccess = makeEndpoint.main(
  'unsetWriteAccess',
  <{ workingCopyPath: string }>_,
  <{ success: true }>_,
);

export const setAuthorInfo = makeEndpoint.main(
  'setAuthorInfo',
  <{ workingCopyPath: string, author: GitAuthor }>_,
  <{ success: true }>_,
);


// Paneron repositories

export const updatePaneronRepository = makeEndpoint.main(
  'setPaneronRepositoryInfo',
  <{ workingCopyPath: string, info: Omit<PaneronRepository, 'datasets' | 'dataset'> }>_,
  <{ success: true }>_,
);


// Working with buffers

export const getBufferDataset = makeEndpoint.main(
  'getBufferDataset',
  <{ workingCopyPath: string, paths: string[] }>_,
  <BufferDataset>_,
);

export const updateBuffers = makeEndpoint.main(
  'commitChanges',
  <{ workingCopyPath: string, bufferChangeset: BufferChangeset, commitMessage: string, ignoreConflicts?: true }>_,
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

export const repositoryBuffersChanged = makeEndpoint.renderer(
  'repositoryBuffersChanged',
  <{ workingCopyPath: string, changedPaths?: Record<string, ChangeStatus | true> }>_,
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
