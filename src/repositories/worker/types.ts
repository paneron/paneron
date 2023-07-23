import type { Observable } from 'threads/observable';
import type { ChangeStatus, CommitOutcome, PathChanges } from '@riboseinc/paneron-extension-kit/types/changes';
import type { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import type {
  AuthoringGitOperationParams,
  BufferCommitRequestMessage,
  CloneRequestMessage,
  DeleteRequestMessage,
  GitAuthentication,
  GitOperationParams,
  InitRequestMessage,
  LFSParams,
  PullRequestMessage,
  PushRequestMessage,
  RepoStatus,
  RepoStatusUpdater,
  CommitMeta,
} from 'repositories/types';


/**
 * Operation on an opened local repository.
 * Same function as F, but omits “workDir” from first parameter.
 *
 * See `openLocalRepo` function for details.
 *
 * (The convention is that all worker methods take first argument
 * as an object containing required parameters, often including “workDir”.)
 */
type OpenedRepoOperation<F extends (opts: any) => any> =
  (opts: Omit<Parameters<F>[0], 'workDir'>) =>
    ReturnType<F>
// TODO: Check in `OpenedRepoOperation` that wrapped function takes workDir parameter
// TODO: Consolidate the two `OpenedRepoOperation` types, they seem to attempt the same in different ways.


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

    /**
     * Describes a remote, including whether it’s blank,
     * whether given auth credentials can push to it (NOTE: deprecated),
     * what’s the default/main branch name
     * and latest commit OID, if any.
     */
    export type Describe = (msg: {
      url: string
      auth: GitAuthentication
    }) => Promise<{
      isBlank: boolean,
      canPush: boolean,
      mainBranchName: string | undefined,
      currentCommit: string | undefined,
      availableBranches: string[],
    }>;

    /**
     * Returns a flag indicating whether given auth can push
     * to given remote URL.
     */
    export type AssessPushCapability = (msg: {
      url: string
      auth: GitAuthentication
    }) => Promise<{
      canPush: boolean,
    }>;

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

    export type ResolveChanges = (msg: GitOperationParams & {
      rootPath: string
      oidBefore: string
      oidAfter: string
    }) => Promise<{
      changedBuffers: [path: string, changeStatus: ChangeStatus][]
    }>

    export type ChooseMostRecentCommit = (msg: GitOperationParams & {
      candidates: string[]
    }) => Promise<{ commitHash: string }>

    export type GetCurrentCommit = (msg: GitOperationParams) =>
      Promise<{ commitHash: string }>

    /**
     * Returns a list of recent commit hashes, newest to oldest, optionally
     * only affecting an object at given path relative to repo root.
     */
    export type ListCommits = (msg: GitOperationParams) =>
      Promise<{ commitHashes: string[] }>

    /**
     * Retrieves commit metadata, given commit hash.
     */
    export type DescribeCommit = (msg: GitOperationParams & { commitHash: string }) =>
      Promise<{ commit: CommitMeta }>

    /**
     * Resets HEAD to previous commit hash. Takes the current commit hash.
     * Intended for that time window when commit was created and not yet pushed.
     *
     * Will throw and do nothing in any of these circumstances:
     *
     * 1. If given commit hash is not the latest commit.
     * 2. If given latest commit already exists in remote (got already synced).
     * 3. If given unpushed latest commit has more than one parent (is a merge somehow).
     * 4. If given unpushed latest commit has no parents (is initial commit somehow).
     * 5. If there are uncommitted changes in working directory (somehow).
     * 6. Repository is not on a branch (detached HEAD).
     */
    export type UndoCommit = (msg: GitOperationParams & {
      commitHash: string
      remoteURL: string | undefined
      auth: GitAuthentication
    }) =>
      Promise<{ newCommitHash: string }>

    export type GetBufferDataset = (msg: GitOperationParams & {
      paths: string[]
    }) => Promise<BufferDataset>

    export type ReadBuffers = (msg: GitOperationParams & {
      rootPath: string

      /**
       * Parameters for resolving LFS.
       * If undefined, will not resolve LFS pointers.
       * If provided, may error if fetch from LFS fails.
       */
      resolveLFS?: LFSParams
    }) => Promise<Record<string, Uint8Array>>

    export type ReadBuffersAtVersion = (msg: GitOperationParams & {
      rootPath: string
      commitHash: string
    }) => Promise<Record<string, Uint8Array>>

    export type UpdateBuffers =
      (msg: BufferCommitRequestMessage) =>
        Promise<CommitOutcome>

    export type UpdateBuffersWithStatusReporter =
      WithStatusUpdater<UpdateBuffers>

    export type AddExternalBuffers = (msg: AuthoringGitOperationParams & {
      commitMessage: string

      /** Map of external paths to repo-relative paths. */
      paths: Record<string, string>

      /**
       * Parameters for accessing LFS if offload is required.
       * If provided, all objects will be stored as LFS pointers,
       * with actual data uploaded to LFS before commit takes place.
       */
      offloadToLFS?: LFSParams
    }) => Promise<CommitOutcome>

    export type AddExternalBuffersWithStatusReporter =
      WithStatusUpdater<AddExternalBuffers>

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


export interface RepoUpdate {
  oid: string
  paths: PathChanges
}


export default interface WorkerMethods {

  // Worker setup and teardown methods

  /**
   * “Opening” a local repo (represented by working directory path)
   * serves two purposes:
   *
   * 1. Avoiding subsequently passing workDir to every function that needs it.
   * 2. Helping ensure at most one worker mutates given Git repository
   *    (within itself, the worker can use fast in-memory locking).
   *
   * The second point is not enforced yet,
   * but it already provides a good way for signaling caller’s intention
   * and making it obvious if two code paths use openWorkDir in writeable mode.
   * (Locking working directory for writes could be implemented in future
   * if caller’s discipline becomes a concern, e.g. via a lockfile though
   * that’s less portable to non-Node environments such as Web workers.)
   *
   * Working directory assignment is final for worker lifetime.
   *
   * Working directory does not need to exist for opening in 'rw' mode.
   *
   * If a function requiring working directory to be open is called before
   * the directory is assigned, it will throw.
   */
  openLocalRepo: (workDirPath: string, mode: 'r' | 'rw') => Promise<void>

  destroy: () => Promise<void>


  // Streams worker work results

  streamStatus: () => Observable<RepoStatus>

  /**
   * Returns a stream that emits every time
   * HEAD is updated (e.g., after a pull or a commit).
   *
   * Each emitted value indicates new current OID hash
   * and changed buffers, if any.
   *
   * Not yet fully supported.
   */
  streamChanges: () => Observable<RepoUpdate>


  // Git operations that don’t require opening a repo

  git_workDir_validate: Git.WorkDir.Validate
  git_delete: Git.WorkDir.Delete
  git_describeRemote: Git.Remotes.Describe


  // Git operations

  git_init: OpenedRepoOperation<Git.WorkDir.Init>
  git_clone: OpenedRepoOperation<Git.Sync.Clone>
  git_pull: OpenedRepoOperation<Git.Sync.Pull>
  git_push: OpenedRepoOperation<Git.Sync.Push>
  git_addOrigin: OpenedRepoOperation<Git.Remotes.AddOrigin>
  git_deleteOrigin: OpenedRepoOperation<Git.Remotes.DeleteOrigin>


  // Housekeeping

  git_workDir_discardUncommittedChanges: OpenedRepoOperation<Git.WorkDir.DiscardUncommittedChanges>


  // Working with raw unstructured data (internal)

  /** Returns the hash of the latest commit in the repository. */
  repo_getCurrentCommit: OpenedRepoOperation<Repositories.Data.GetCurrentCommit>

  /** Returns hashes of N most recent commits. */
  repo_listCommits: OpenedRepoOperation<Repositories.Data.ListCommits>

  /** Return metadata for commit at given hash. */
  repo_describeCommit: OpenedRepoOperation<Repositories.Data.DescribeCommit>

  repo_undoLatestCommit: OpenedRepoOperation<Repositories.Data.UndoCommit>

  /**
   * Given a list of commit hashes,
   * walks back history and returns one that was created most recently.
   */
  repo_chooseMostRecentCommit: OpenedRepoOperation<Repositories.Data.ChooseMostRecentCommit>

  /**
   * Given a list of buffer paths,
   * returns a map of buffer paths to buffers or null.
   */
  repo_getBufferDataset: OpenedRepoOperation<Repositories.Data.GetBufferDataset>

  /**
   * Given a work dir and a rootPath, returns a map of descendant buffer paths
   * to buffer blobs.
   *
   * Optionally resolves LFS pointers, in which case may take a while.
   */
  repo_readBuffers: OpenedRepoOperation<Repositories.Data.ReadBuffers>

  /**
   * Given a path, returns a map of descendant buffer paths
   * to buffers.
   */
  repo_readBuffersAtVersion: OpenedRepoOperation<Repositories.Data.ReadBuffersAtVersion>

  /** Updates buffers in repository. */
  repo_updateBuffers: OpenedRepoOperation<Repositories.Data.UpdateBuffers>

  /**
   * Creates buffers using specified files from filesystem.
   *
   * Overwrites existing buffers, if any.
   *
   * If any of specified absolute file paths does not exist in filesystem,
   * throws an error.
   */
  repo_addExternalBuffers: OpenedRepoOperation<Repositories.Data.AddExternalBuffers>

  /** Deletes repository subtree. Fast, but doesn’t validate data. */
  repo_deleteTree: OpenedRepoOperation<Repositories.Data.DeleteTree>

  /** Moves repository subtree to another location. Fast, but doesn’t validate data. */
  repo_moveTree: OpenedRepoOperation<Repositories.Data.MoveTree>

  /**
   * Takes commit hash before and after a change.
   * Walks through repository tree and checks which buffer paths changed.
   * Returns those.
   */
  repo_resolveChanges: OpenedRepoOperation<Repositories.Data.ResolveChanges>
}
