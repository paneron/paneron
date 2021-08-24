import { ObjectChangeset, ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { ChangeStatus, CommitOutcome } from '@riboseinc/paneron-extension-kit/types/changes';
import { IndexStatus } from '@riboseinc/paneron-extension-kit/types/indexes';
import { EmptyPayload, makeEndpoint, _ } from '../ipc';
import { DatasetInfo, DatasetType, MigrationSequenceOutcome, RecentlyOpenedDataset } from './types';


/* List dataset types, provided by extensions, available for dataset initialization */
export const listAvailableTypes = makeEndpoint.main(
  'listAvailableTypes',
  <EmptyPayload>_,
  <{ types: DatasetType[] }>_,
);

export const listRecentlyOpenedDatasets = makeEndpoint.main(
  'listRecentlyOpenedDatasets',
  <EmptyPayload>_,
  <{ datasets: RecentlyOpenedDataset[] }>_,
);

export const getDatasetInfo = makeEndpoint.main(
  'getDatasetInfo',
  <{ workingCopyPath: string, datasetPath?: string /* Can be undefined, meaning dataset is at repository root */}>_,
  <{ info: DatasetInfo | null }>_
);

/* Checks whether a dataset can be initialized at given location. Returns a path if it’s valid, undefined otherwise. */
export const proposeDatasetPath = makeEndpoint.main(
  'proposeDatasetPath',
  <{ workingCopyPath: string, datasetPath?: string /* Can be undefined, meaning dataset is at repository root */}>_,
  <{ path?: string }>_,
);

/* Initializes a new dataset using dataset type extension specified in meta.type */
export const initializeDataset = makeEndpoint.main(
  'initializeDataset',
  <{
    workingCopyPath: string
    meta: DatasetInfo
    datasetPath?: string // Can be undefined, meaning dataset is at repository root
  }>_,
  <{ info: DatasetInfo }>_,
);

/* Loads dataset. This may call extension to run indexing, etc.
   throw if a migration is outstanding. */
export const loadDataset = makeEndpoint.main(
  'loadDataset',
  <{ workingCopyPath: string, datasetPath: string }>_,
  <{ success: true }>_,
);

export const unloadDataset = makeEndpoint.main(
  'unloadDataset',
  <{ workingCopyPath: string, datasetPath: string }>_,
  <{ success: true }>_,
);

export const deleteDataset = makeEndpoint.main(
  'deleteDataset',
  <{ workingCopyPath: string, datasetPath: string }>_,
  <{ success: true }>_,
);


// Working with data

export const getOrCreateFilteredIndex = makeEndpoint.main(
  'datasets_getOrCreateFilteredIndex',
  <{ workingCopyPath: string, datasetPath: string, queryExpression: string, keyExpression?: string }>_,
  <{ indexID: string | undefined }>_,
);

export const describeIndex = makeEndpoint.main(
  'datasets_describeIndex',
  <{ workingCopyPath: string, datasetPath: string, indexID?: string }>_,
  <{ status: IndexStatus }>_,
);

export const getFilteredObject = makeEndpoint.main(
  'datasets_getFilteredObject',
  <{ workingCopyPath: string, datasetPath: string, indexID: string, position: number }>_,
  <{ objectPath: string }>_,
);

export const locateFilteredIndexPosition = makeEndpoint.main(
  'datasets_locateFilteredIndexPosition',
  <{ workingCopyPath: string, datasetPath: string, indexID: string, objectPath: string }>_,
  <{ position: number | null }>_,
);

export const getObjectDataset = makeEndpoint.main(
  'datasets_getObjectDataset',
  <{ workingCopyPath: string, datasetPath: string, objectPaths: string[] }>_,
  <{ data: ObjectDataset }>_,
);

export const updateObjects = makeEndpoint.main(
  'datasets_updateObjects',
  <{
    workingCopyPath: string
    datasetPath: string
    commitMessage: string
    objectChangeset: ObjectChangeset
    _dangerouslySkipValidation?: true
  }>_,
  <CommitOutcome>_,
);


// Events

export const objectsChanged = makeEndpoint.renderer(
  'dataset_objectsChanged',
  <{ workingCopyPath: string, datasetPath: string, objects?: Record<string, ChangeStatus | true> }>_,
);

export const filteredIndexUpdated = makeEndpoint.renderer(
  'dataset_indexContentsChanged',
  <{ workingCopyPath: string, datasetPath: string, indexID: string }>_,
);

export const indexStatusChanged = makeEndpoint.renderer(
  'dataset_indexStatusChanged',
  <{ workingCopyPath: string, datasetPath: string, indexID?: string, status: IndexStatus }>_,
);


// Migrations

export const getOutstandingMigration = makeEndpoint.main(
  'getOutstandingMigration',
  <{ workingCopyPath: string, datasetPath: string }>_,
  <{ migration?: { versionSpec: string } }>_,
);

export const applyOutstandingMigrations = makeEndpoint.main(
  'applyOutstandingMigrations',
  <{ workingCopyPath: string, datasetPath: string }>_,
  <{ outcome: MigrationSequenceOutcome }>_,
);

export const reportMigrationStatus = makeEndpoint.renderer(
  'reportMigrationStatus',
  <{ datasetVersion: string, currentMigrationVersionSpec?: string, operation: string, progress?: number }>_,
)


// Operations on object changesets, object datasets and object paths
// that make them dataset-relative or repo-relative.

// export function makeChangesetRepoRelative(changeset: ObjectChangeset, datasetPath: string): ObjectChangeset {
//   return Object.entries(changeset).
//     map(([objPath, data]) =>
//       ({ [makeObjectPathRepoRelative(objPath, datasetPath)]: data })
//     ).reduce((prev, curr) => ({ ...prev, ...curr }), {});
// }
// 
// export function makeObjectStatusSetDatasetRelative(statuses: ObjectChangeStatusSet, datasetPath: string): ObjectChangeStatusSet {
//   return Object.entries(statuses).
//     map(([repoPath, payload]) =>
//       ({ [makeObjectPathDatasetRelative(repoPath, datasetPath)]: payload })
//     ).reduce((prev, curr) => ({ ...prev, ...curr }), {});
// }
// 
// export function makeDataRequestRepoRelative(request: ObjectDataRequest, datasetPath: string): ObjectDataRequest {
//   return Object.entries(request).
//     map(([datasetObjectPath, reqParams]) =>
//       ({ [makeObjectPathRepoRelative(datasetObjectPath, datasetPath)]: reqParams })
//     ).reduce((prev, curr) => ({ ...prev, ...curr }), {});
// }
// 
// export function makeDatasetDatasetRelative(dataset: ObjectDataset, datasetPath: string): ObjectDataset {
//   return Object.entries(dataset).
//     map(([objPath, data]) =>
//       ({ [makeObjectPathDatasetRelative(objPath, datasetPath)]: data })
//     ).reduce((prev, curr) => ({ ...prev, ...curr }), {});
// }
// 
// export function makeObjectPathDatasetRelative(repoObjectPath: string, datasetPath: string): string {
//   return repoObjectPath.replace(`${datasetPath}/`, '');
// }
// 
// export function makeObjectPathRepoRelative(datasetObjectPath: string, datasetPath: string): string {
//   return datasetPath ? path.join(datasetPath, datasetObjectPath) : datasetObjectPath;
// }
