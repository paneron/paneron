import { makeWindowForComponent } from '../window';
import { EmptyPayload, makeEndpoint, _ } from '../ipc';
import {
  GitAuthor,
  NewRepositoryDefaults,
  PaneronRepository,
  Repository,
  RepoStatus,
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
  <Record<never, never>>_,
  <{ objects: Repository[] }>_,
);

export const listPaneronRepositories = makeEndpoint.main(
  'listPaneronRepositories',
  <{ workingCopyPaths: string[] }>_,
  <{ objects: { [workingCopyPath: string]: PaneronRepository | null } }>_,
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

export const getPaneronRepositoryInfo = makeEndpoint.main(
  'getPaneronRepositoryInfo',
  <{ workingCopyPath: string }>_,
  <{ info: PaneronRepository | null }>_,
);

export const setPaneronRepositoryInfo = makeEndpoint.main(
  'setPaneronRepositoryInfo',
  <{ workingCopyPath: string, info: Omit<PaneronRepository, 'datasets' | 'dataset'> }>_,
  <{ success: true }>_,
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

export const deleteRepository = makeEndpoint.main(
  'deleteRepository',
  <{ workingCopyPath: string }>_,
  <{ deleted: true }>_,
);

// TODO: Remove when possible.
/* Converts an old single-dataset repository to Paneron format. */
export const migrateRepositoryFormat = makeEndpoint.main(
  'migrateRepositoryFormat',
  <{ workingCopyPath: string }>_,
  <{ newCommitHash: string }>_,
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
