import type { Observable } from 'threads/observable';
import type { ChangeStatus, CommitOutcome } from '@riboseinc/paneron-extension-kit/types/changes';
import type { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import type {
  AuthoringGitOperationParams,
  BufferCommitRequestMessage,
  CloneRequestMessage,
  DeleteRequestMessage,
  GitAuthentication,
  GitOperationParams,
  InitRequestMessage,
  PullRequestMessage,
  PushRequestMessage,
  RepoStatus,
  RepoStatusUpdater,
} from 'repositories/types';


export type ExposedGitRepoOperation<F extends (opts: any) => any> =
  (opts: Omit<Parameters<F>[0], 'workDir'>) =>
    ReturnType<F>


export type WithStatusUpdater<F extends (opts: any) => any> =
  (opts: Parameters<F>[0], statusUpdater: RepoStatusUpdater) =>
    ReturnType<F>


export namespace Git {

  export namespace WorkDir {

    export type Validate =
      (msg: GitOperationParams) => Promise<boolean>

    export type Init =
      (msg: InitRequestMessage) => Promise<{ success: true }>

    export type DiscardUncommittedChanges =
      (msg: GitOperationParams & { pathSpec?: string }) =>
        Promise<{ success: true }>

    export type Delete =
      (msg: DeleteRequestMessage) => Promise<{ success: true }>

  }

  export namespace Remotes {

    export type Describe = (msg: {
      url: string
      auth: GitAuthentication
    }) => Promise<{ isBlank: boolean, canPush: boolean }>;

    // TODO: workDir below is likely redundant?
    // repoOperation decorator provides it for initialized workers.
    export type AddOrigin = (msg: {
      workDir: string
      url: string
    }) => Promise<{ success: true }>;

    export type DeleteOrigin = (msg: {
      workDir: string
    }) => Promise<{ success: true }>

  }

  export namespace Sync {

    export type Clone =
      (msg: CloneRequestMessage) =>
        Promise<{ success: true }>

    export type Pull =
      (msg: PullRequestMessage) =>
        Promise<{
          oidBeforePull: string
          oidAfterPull: string
        }>

    export type Push =
      (msg: PushRequestMessage) =>
        Promise<{ success: true }>

  }
}


export namespace Repositories {

  export namespace Data {

    /* Takes commit hash before and after a change.

       Infers which buffer paths changed,
       infers which object paths in which datasets are affected,
       reindexes objects as appropriate,
       and sends IPC events to let Paneron & extension windows
       refresh shown data.
    */
    export type ResolveChanges = (msg: GitOperationParams & {
      rootPath: string
      oidBefore: string
      oidAfter: string
    }) => Promise<{
      changedBuffers: [path: string, changeStatus: ChangeStatus][]
    }>

    /* Given a list of commit hashes,
       walks back history and returns one that was created most recently. */
    export type ChooseMostRecentCommit = (msg: GitOperationParams & {
      candidates: string[]
    }) => Promise<{ commitHash: string }>

    /* Returns the hash of the latest commit in the repository. */
    export type GetCurrentCommit = (msg: GitOperationParams) =>
      Promise<{ commitHash: string }>

    /* Given a list of buffer paths,
       returns a map of buffer paths to buffers or null. */
    export type GetBufferDataset = (msg: GitOperationParams & {
      paths: string[]
    }) => Promise<BufferDataset>

    /* Given a path, returns a map of descendant buffer paths
       to buffers. */
    export type ReadBuffers = (msg: GitOperationParams & {
      rootPath: string
    }) => Promise<Record<string, Uint8Array>>

    /* Given a path, returns a map of descendant buffer paths
       to buffers. */
    export type ReadBuffersAtVersion = (msg: GitOperationParams & {
      rootPath: string
      commitHash: string
    }) => Promise<Record<string, Uint8Array>>

    export type UpdateBuffers =
      (msg: BufferCommitRequestMessage) =>
        Promise<CommitOutcome>

    export type UpdateBuffersWithStatusReporter =
      WithStatusUpdater<UpdateBuffers>

    export type DeleteTree = (msg: AuthoringGitOperationParams & {
      treeRoot: string
      commitMessage: string
    }) => Promise<CommitOutcome>

    export type MoveTree = (msg: AuthoringGitOperationParams & {
      oldTreeRoot: string
      newTreeRoot: string
      commitMessage: string
    }) => Promise<CommitOutcome>

  }
}


export default interface WorkerMethods {
  destroy: () => Promise<void>

  /* Initialize worker: give it Git repo’s working directory path,
     and get an observable for monitoring repository status in return. */
  initialize: (msg: { workDirPath: string }) => Observable<RepoStatus>


  // Maybe also getLatestStatus() => Promise<RepoStatus>?

  // Git operations

  git_init: ExposedGitRepoOperation<Git.WorkDir.Init>
  git_delete: Git.WorkDir.Delete

  git_clone: ExposedGitRepoOperation<Git.Sync.Clone>

  git_pull: ExposedGitRepoOperation<Git.Sync.Pull>
  git_push: ExposedGitRepoOperation<Git.Sync.Push>

  git_describeRemote: Git.Remotes.Describe
  git_addOrigin: ExposedGitRepoOperation<Git.Remotes.AddOrigin>
  git_deleteOrigin: ExposedGitRepoOperation<Git.Remotes.DeleteOrigin>


  // Housekeeping

  git_workDir_validate: Git.WorkDir.Validate
  git_workDir_discardUncommittedChanges: ExposedGitRepoOperation<Git.WorkDir.DiscardUncommittedChanges>


  // Working with raw unstructured data (internal)

  repo_getCurrentCommit: Repositories.Data.GetCurrentCommit
  repo_chooseMostRecentCommit: Repositories.Data.ChooseMostRecentCommit
  repo_getBufferDataset: Repositories.Data.GetBufferDataset
  repo_readBuffers: Repositories.Data.ReadBuffers
  repo_readBuffersAtVersion: Repositories.Data.ReadBuffersAtVersion
  repo_updateBuffers: Repositories.Data.UpdateBuffers
  repo_deleteTree: Repositories.Data.DeleteTree
  repo_moveTree: Repositories.Data.MoveTree
  repo_resolveChanges: Repositories.Data.ResolveChanges
}
