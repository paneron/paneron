import type { Progress } from '@riboseinc/paneron-extension-kit/types/progress';
import type { BufferChangeset } from '@riboseinc/paneron-extension-kit/types/buffers';
import type { ObjectChangeset } from '@riboseinc/paneron-extension-kit/types/objects';


// Repository info

export type PaneronRepository = {
  title?: string
} & ({
  datasets: { [path: string]: true }
  dataset?: undefined
} | {
  datasets?: undefined
  dataset: true
})

export interface GitRepository {
  workingCopyPath: string
  remote?: GitRemote
  author?: GitAuthor
}

export interface Repository {
  gitMeta: GitRepository
  paneronMeta?: PaneronRepository
}

export interface GitRemote {
  username: string
  url: string
  writeAccess?: true
}

export interface RepositoryListQuery {
  sortBy?: 'recentlyLoaded'
  matchesText?: string
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
  progress?: Progress
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

export type RepoStatusUpdater = (newStatus: RepoStatus) => void;



// Git-related types used by worker
// TODO: Consolidate Git-related types

/* Authentication as expected by Isomorphic Git */
export interface GitAuthentication {
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

export interface DatasetOperationParams extends GitOperationParams {
  datasetDir: string
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

export interface BufferDataRequestMessage extends GitOperationParams {
  bufferPaths: string[]
}

export interface ObjectDataRequestMessage extends GitOperationParams {
  objectPaths: string[]
}

export interface BufferCommitRequestMessage extends AuthoringGitOperationParams {
  bufferChangeset: BufferChangeset
  commitMessage: string
  _dangerouslySkipValidation?: true
}

export interface CommitRequestMessage extends AuthoringGitOperationParams, DatasetOperationParams {
  objectChangeset: ObjectChangeset
  commitMessage: string
  _dangerouslySkipValidation?: true
}

export interface DeleteRequestMessage extends GitOperationParams {
  yesReallyDestroyLocalWorkingCopy: true
}

// export type ObjectRequester<Encoding extends string | undefined> =
//   (msg: ObjectDataRequestMessage<Encoding>) => Encoding extends string


export type WorkerMessage =
  CloneRequestMessage
  | PullRequestMessage
  | FetchRequestMessage
  | PushRequestMessage;
