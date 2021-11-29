import { AbstractIterator } from 'abstract-leveldown';
import { LevelUp } from 'levelup';
import EncodingDown from 'encoding-down';
import { BufferChangeset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { CommitOutcome, PathChanges } from '@riboseinc/paneron-extension-kit/types/changes';
import { IndexStatus } from '@riboseinc/paneron-extension-kit/types/indexes';
import { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { CommitRequestMessage, DatasetOperationParams, GitOperationParams, TreeUpdateCommitRequestMessage } from 'repositories/types';


export type ReturnsPromise<F extends (...opts: any[]) => any> =
  (...opts: Parameters<F>) => Promise<ReturnType<F>>


export type RecentlyOpenedDataset = {
  workDir: string
  datasetID: string
}


export interface DatasetType {
  id: string
  version: string
}


export interface DatasetInfo {
  title: string
  type: DatasetType
}


export interface MigrationError {
  currentMigrationVersionSpec?: string
  message: string
  conflicts?: PathChanges 
}


export interface MigrationSequenceOutcome {
  success: boolean
  error?: MigrationError
  changesApplied: { commitHash: string, bufferChangeset: BufferChangeset }[]
}



export namespace API {


  export namespace Lifecycle {
    /**
     * Registers object specs and starts creating the default index
     * that contains all objects in the dataset.
     */
    export type Load = (msg: DatasetOperationParams & {
      cacheRoot: string
    }) => Promise<void>

    /** Stops all indexing, deregisters object specs. */
    export type Unload =
      (msg: DatasetOperationParams) => Promise<void>

    export type UnloadAll =
      (msg: GitOperationParams) => Promise<void>
  }


  export namespace Indexes {

    /**
     * Creates a custom index that filters items in default index
     * using given query expression that evaluates in context of each object.
     * 
     * Custom indexes contain object paths only, object data
     * is retrieved from default index.
     * 
     * Returns index ID that can be used to query items. */
    export type GetOrCreateFiltered = (msg: DatasetOperationParams & {
      queryExpression: string
      keyExpression?: string
    }) => { indexID: string }

    /** If indexID is omitted, default index is described. */
    export type Describe = (msg: DatasetOperationParams & {
      indexID?: string
    }) => { status: IndexStatus }

    /* If indexID is omitted, default index is described. */
    // export type StreamStatus = (msg: DatasetOperationParams & {
    //   indexID?: string
    // }) => Observable<IndexStatus>

    /* If indexID is omitted, objects in default index are counted. */
    // Unnecessary. Use describe.
    // export type CountObjects = (msg: DatasetOperationParams & {
    //   indexID?: string
    // }) => Promise<{ objectCount: number }>

    /** Retrieves dataset-relative path of an object
        in the index at specified position. */
    export type GetFilteredObject = (msg: DatasetOperationParams & {
      indexID: string
      position: number
    }) => Promise<{ objectPath: string }>

    export type LocatePositionInFilteredIndex = (msg: DatasetOperationParams & {
      indexID: string
      objectPath: string
    }) => Promise<{ position: number }>
  }


  export namespace Data {

    /** Counts all objects in the dataset using default index. */
    export type CountObjects =
      (msg: DatasetOperationParams) => Promise<{ objectCount: number }>

    /**
     * Returns structured data of objects matching given paths.
     * Uses object specs to build objects from buffers.
     */
    export type GetObjectDataset = (msg: DatasetOperationParams & {
      objectPaths: string[]
      resolveLFS?: true
    }) => Promise<ObjectDataset>

    /**
     * Converts given objects to buffers using previously registered object specs,
     * checks for conflicts,
     * makes changes to buffers in working area,
     * stages and commits.
     * Returns commit hash and/or conflicts, if any.
     */
    export type UpdateObjects =
      (msg: CommitRequestMessage) => Promise<CommitOutcome>

    /**
     * This proxies a call to repository manager,
     * requesting to delete or move an entire subtree.
     * Does not do any consistency checks and can ruin data integrity if not used carefully.
     */
    export type UpdateTree =
      (msg: TreeUpdateCommitRequestMessage) => Promise<CommitOutcome>
  }

  export namespace Util {

    export interface LoadedDataset {
      /** Absolute path to directory that will contain index caches. */
      indexDBRoot: string

      indexes: {
        // Includes “default” index and any custom/filtered indexes.
        // Default index ID is 'default'.
        // Filtered index ID is the hash of filter predicate function (query expression) string.
        [id: string]:  ActiveDatasetIndex<any>
      }
    }

    export interface ActiveDatasetIndex<V> {
      dbHandle: LevelUp<EncodingDown<string, V>, AbstractIterator<string, V>>
      status: IndexStatus
      completionPromise?: Promise<true> 

      //statusSubject: Subject<IndexStatus>

      //commitHash: string

      accessed?: Date

      // These are specific to default or filtered indexes

      // Filtered index only:
      sortedDBHandle?: LevelUp<EncodingDown<number, string>, AbstractIterator<number, string>>
      predicate?: FilteredIndexPredicate
      keyer?: FilteredIndexKeyer
    }


    export interface IndexMeta {
      completed: Date
      commitHash: string
      objectCount: number
    }

    /**
     * A map of object path to deserialized object data or boolean false.
     * False values are stored at pre-indexing stage and indicate
     * that the objects exist but had not yet been indexed.
     */
    export type DefaultIndex = ActiveDatasetIndex<Record<string, any> | false> & {
    };

    /** This index’s dbHandle keeps custom keys associated with object paths
        (which are keys in default index) */
    export type FilteredIndex = ActiveDatasetIndex<string> & {

      /** A map of object’s numerical position according to the order of keys in this filtered index, and its path.
          Requested can use that path to query default index for object data. */
      sortedDBHandle: LevelUp<EncodingDown<number, string>, AbstractIterator<number, string>>
      accessed: Date
      predicate: FilteredIndexPredicate
      keyer?: FilteredIndexKeyer
    };

    export type FilteredIndexPredicate = (objPath: string, obj: Record<string, any>) => boolean;

    export type FilteredIndexKeyer = (item: Record<string, any>) => string | null

  }
}
