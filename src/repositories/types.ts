export type { ObjectData, ObjectDataset, ObjectChange, ObjectChangeset } from '@riboseinc/paneron-extension-kit/types';
import type { ObjectChangeset } from '@riboseinc/paneron-extension-kit/types';


export type FileChangeType = 'modified' | 'added' | 'removed' | 'unchanged';


// Repository info

export interface StructuredRepoInfo {
  title: string
  pluginID: string
}

export interface RepositoryType {
  title: string
  pluginID: string
}

export interface Repository {
  workingCopyPath: string
  remote?: GitRemote
  author?: GitAuthor
}

interface GitRemote {
  username: string
  url: string
}


// Creating repos

export interface NewRepositoryDefaults {
  workingDirectoryContainer?: string
  remote?: Omit<GitRemote, 'url'>
  author?: GitAuthor
}


// Repository status

/* Initializing a new repository locally */
interface CreationStatus {
  operation: 'creating'
}
/* During start up */
interface InitStatus {
  operation: 'initializing'
}
interface LocalChecksStatus {
  operation: 'checking-local-changes'
}

export interface AuthoringOpStatus {
  awaitingAuthorInfo?: boolean
}
interface CommitStatus extends AuthoringOpStatus {
  operation: 'committing'
}

export interface RemoteOpStatus {
  awaitingPassword?: boolean
  networkError?: true
  progress?: {
    phase: string
    loaded: number
    total: number
  }
}
interface PullStatus extends RemoteOpStatus {
  operation: 'pulling'
}
interface PushStatus extends RemoteOpStatus {
  operation: 'pushing'
}
interface CloneStatus extends RemoteOpStatus {
  operation: 'cloning'
}

type RepoOperationStatus =
    InitStatus
  | CreationStatus
  | CloneStatus
  | PullStatus
  | PushStatus
  | LocalChecksStatus
  | CommitStatus;

export type RepoStatus = {
  status: 'ahead' | 'behind' | 'diverged' | 'ready' | 'invalid-working-copy'
  busy?: undefined
} | {
  busy: RepoOperationStatus
  status?: undefined
}


export interface ObjectDataRequest {
  [objectPath: string]: 'utf-8' | 'binary'
}


export interface CommitOutcome {
  newCommitHash?: string
  conflicts?: {
    [objectPath: string]: true
  }
}



// Git-related types used by worker
// TODO: Consolidate Git-related types

export interface GitAuthentication {
  /* Authentication as expected by isomorphic-git */

  username?: string
  password?: string

  // Unsupported currently
  oauth2format?: 'github' | 'gitlab' | 'bitbucket'
  token?: string
}

export interface GitAuthor {
  name: string
  email: string
}


// Worker messages

export interface GitOperationParams {
  workDir: string
}

export interface AuthoringGitOperationParams extends GitOperationParams {
  author: GitAuthor
}

export interface RemoteGitOperationParams extends GitOperationParams {
  repoURL: string
  auth: GitAuthentication
  _presumeCanceledErrorMeansAwaitingAuth?: true
}


export interface StatusRequestMessage extends GitOperationParams {}
export interface InitRequestMessage extends GitOperationParams {}

export interface CloneRequestMessage extends RemoteGitOperationParams {}
export interface PullRequestMessage extends RemoteGitOperationParams, AuthoringGitOperationParams {}
export interface PushRequestMessage extends RemoteGitOperationParams {
  // Passing this parameter implies rejected push should not be treated as error.
  // TODO: Get rid of this either when Isomorphic Git stops rejecting push when nothing to push,
  // or when we start checking server refs before attempting push.
  _presumeRejectedPushMeansNothingToPush?: true
}

export interface FetchRequestMessage extends RemoteGitOperationParams {}

export interface CommitRequestMessage extends AuthoringGitOperationParams {
  writeObjectContents: ObjectChangeset
  commitMessage: string
  _dangerouslySkipValidation?: true
}

export interface DeleteRequestMessage extends GitOperationParams {
  yesReallyDestroyLocalWorkingCopy: true
}

export interface ObjectDataRequestMessage extends GitOperationParams {
  readObjectContents: ObjectDataRequest
}

// export type ObjectRequester<Encoding extends string | undefined> =
//   (msg: ObjectDataRequestMessage<Encoding>) => Encoding extends string


export type WorkerMessage =
  CloneRequestMessage
  | PullRequestMessage
  | FetchRequestMessage
  | PushRequestMessage;
