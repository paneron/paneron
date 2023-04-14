import type { ChangeStatus, CommitOutcome } from '@riboseinc/paneron-extension-kit/types/changes';
import type { BufferChangeset, BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';

import { type EmptyPayload, makeEndpoint, _ } from '../ipc';

import type {
  GitAuthor,
  NewRepositoryDefaults,
  RepoStatus,
  Repository,
  PaneronRepository,
  GitRepository,
  RepositoryListQuery,
  CommitMeta,
} from './types';


export const getNewRepoDefaults = makeEndpoint.main(
  'getRepositoryDefaults',
  <EmptyPayload>_,
  <{ defaults: NewRepositoryDefaults | null }>_,
);

export const setNewRepoDefaults = makeEndpoint.main(
  'setRepositoryDefaults',
  <NewRepositoryDefaults>_,
  <{ success: true }>_,
);

export const getDefaultWorkingDirectoryContainer = makeEndpoint.main(
  'getDefaultWorkingDirectoryContainer',
  <EmptyPayload>_,
  <{ path: string }>_,
);


// Creating repos

export const addRepository = makeEndpoint.main(
  'addRepository',
  <{ gitRemoteURL: string, branch: string, username: string, password?: string, author: GitAuthor }>_,
  <{ workDir: string, success: true }>_,
);

export const addDisconnected = makeEndpoint.main(
  'addRepositoryDisconnected',
  <{ gitRemoteURL: string, branch: string, username: string, password?: string }>_,
  <{ workDir: string, success: true }>_,
)

export const createRepository = makeEndpoint.main(
  'createRepository',
  <{ title?: string, author: GitAuthor, mainBranchName: string }>_,
  <{ success: true }>_,
);


// Repo management

export const listRepositories = makeEndpoint.main(
  'listRepositories',
  <{ query: RepositoryListQuery }>_,
  <{ objects: Repository[] }>_,
);

/** 
 * This would set up repository worker and start repository sync.
 * Required to load datasets and query structured data.
 */
export const loadRepository = makeEndpoint.main(
  'loadRepository',
  <{ workingCopyPath: string }>_,
  <RepoStatus>_,
);

/**
 * Returns repository info, including Git and Paneron metadata
 * as well as whether it’s currently loaded (synchronizing).
 */
export const describeRepository = makeEndpoint.main(
  'getRepository',
  <{ workingCopyPath: string }>_,
  <{ info: Repository, isLoaded: boolean }>_,
);

export const deleteRepository = makeEndpoint.main(
  'deleteRepository',
  <{ workingCopyPath: string }>_,
  <{ deleted: true }>_,
);


// Git repositories: meta/config/remote

export const queryGitRemote = makeEndpoint.main(
  'queryRemote',
  <{ url: string, username: string, password?: string }>_,
  <{ isBlank: boolean, canPush: boolean, mainBranchName?: string }>_,
);

export const describeGitRepository = makeEndpoint.main(
  'getGitRepository',
  <{ workingCopyPath: string }>_,
  <{ info: GitRepository, isLoaded: boolean }>_,
);

export const listCommits = makeEndpoint.main(
  'listCommits',
  <{ workingCopyPath: string }>_,
  <{ commitHashes: string[] }>_,
);

export const describeCommit = makeEndpoint.main(
  'describeGitCommit',
  <{ workingCopyPath: string, commitHash: string }>_,
  <{ commit: CommitMeta }>_,
);

export const undoLatestCommit = makeEndpoint.main(
  'revertGitCommit',
  <{ workingCopyPath: string, commitHash: string }>_,
  <{ newCommitHash: string }>_,
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

/**
 * Given repo-relative buffer path, resolves absolute path at HEAD;
 * if it’s an LFS pointer returns internal path to LFS blob.
 */
export const getAbsoluteBufferPath = makeEndpoint.main(
  'getBufferPath',
  <{ workingCopyPath: string, bufferPath: string }>_,
  <{ absolutePath: string }>_,
);


// Events

export const repositoriesChanged = makeEndpoint.renderer(
  'repositoriesChanged',
  <{ changedWorkingPaths?: string[], createdWorkingPaths?: string[], deletedWorkingPaths?: string[] }>_,
);

export const loadedRepositoryStatusChanged = makeEndpoint.renderer(
  'loadedRepositoryStatusChanged',
  <{ workingCopyPath: string, status: RepoStatus }>_,
);

export const repositoryBuffersChanged = makeEndpoint.renderer(
  'repositoryBuffersChanged',
  <{ workingCopyPath: string, changedPaths?: Record<string, ChangeStatus | true> }>_,
);

export const newCommit = makeEndpoint.renderer(
  'newCommit',
  <{ workingCopyPath: string, commitHash: string }>_,
);
