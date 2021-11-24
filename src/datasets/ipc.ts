import { ObjectChangeset, ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { ChangeStatus, CommitOutcome } from '@riboseinc/paneron-extension-kit/types/changes';
import { IndexStatus } from '@riboseinc/paneron-extension-kit/types/indexes';

import { EmptyPayload, makeEndpoint, _ } from '../ipc';
import { DatasetInfo, DatasetType, RecentlyOpenedDataset } from './types';


/** List dataset types, provided by extensions, available for dataset initialization */
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
  <{
    workingCopyPath: string
    datasetID: string
  }>_,
  <{ info: DatasetInfo | null }>_
);

/**
 * Checks whether a dataset can be initialized at given location.
 * Returns a path if it’s valid, undefined otherwise.
 */
export const proposeDatasetPath = makeEndpoint.main(
  'proposeDatasetPath',
  <{
    workingCopyPath: string
    datasetPath: string
  }>_,
  <{ path?: string }>_,
);

/** Initializes a new dataset using dataset type extension specified in meta.type */
export const initializeDataset = makeEndpoint.main(
  'initializeDataset',
  <{
    workingCopyPath: string
    datasetPath: string
    meta: DatasetInfo
  }>_,
  <{ info: DatasetInfo }>_,
);

/**
 * Loads dataset. This may call extension to run indexing, etc.
 * Throws if a migration is outstanding.
 */
export const loadDataset = makeEndpoint.main(
  'loadDataset',
  <{ workingCopyPath: string, datasetID: string }>_,
  <{ success: true }>_,
);

export const unloadDataset = makeEndpoint.main(
  'unloadDataset',
  <{ workingCopyPath: string, datasetID: string }>_,
  <{ success: true }>_,
);

export const deleteDataset = makeEndpoint.main(
  'deleteDataset',
  <{ workingCopyPath: string, datasetID: string }>_,
  <{ success: true }>_,
);


// Working with data

export const getOrCreateFilteredIndex = makeEndpoint.main(
  'datasets_getOrCreateFilteredIndex',
  <{ workingCopyPath: string, datasetID: string, queryExpression: string, keyExpression?: string }>_,
  <{ indexID: string | undefined }>_,
);

export const describeIndex = makeEndpoint.main(
  'datasets_describeIndex',
  <{ workingCopyPath: string, datasetID: string, indexID?: string }>_,
  <{ status: IndexStatus }>_,
);

export const getFilteredObject = makeEndpoint.main(
  'datasets_getFilteredObject',
  <{ workingCopyPath: string, datasetID: string, indexID: string, position: number }>_,
  <{ objectPath: string }>_,
);

export const locateFilteredIndexPosition = makeEndpoint.main(
  'datasets_locateFilteredIndexPosition',
  <{ workingCopyPath: string, datasetID: string, indexID: string, objectPath: string }>_,
  <{ position: number | null }>_,
);

export const getObjectDataset = makeEndpoint.main(
  'datasets_getObjectDataset',
  <{ workingCopyPath: string, datasetID: string, objectPaths: string[] }>_,
  <{ data: ObjectDataset }>_,
);

export const updateObjects = makeEndpoint.main(
  'datasets_updateObjects',
  <{
    workingCopyPath: string
    datasetID: string
    commitMessage: string
    objectChangeset: ObjectChangeset
    _dangerouslySkipValidation?: true
  }>_,
  <CommitOutcome>_,
);

export const updateSubtree = makeEndpoint.main(
  'datasets_updateSubtree',
  <{
    workingCopyPath: string
    datasetID: string
    commitMessage: string
    subtreeRoot: string // dataset-relative
    newSubtreeRoot: string | null // if null, deletes subtree
  }>_,
  <CommitOutcome>_,
);


// Events

export const objectsChanged = makeEndpoint.renderer(
  'dataset_objectsChanged',
  <{ workingCopyPath: string, datasetID: string, objects?: Record<string, ChangeStatus | true> }>_,
);

export const filteredIndexUpdated = makeEndpoint.renderer(
  'dataset_indexContentsChanged',
  <{ workingCopyPath: string, datasetID: string, indexID: string }>_,
);

export const indexStatusChanged = makeEndpoint.renderer(
  'dataset_indexStatusChanged',
  <{ workingCopyPath: string, datasetID: string, indexID?: string, status: IndexStatus }>_,
);


// Migrations
// This is part of the obsolete “main” thread extension API.

// export const getOutstandingMigration = makeEndpoint.main(
//   'getOutstandingMigration',
//   <{ workingCopyPath: string, datasetPath: string }>_,
//   <{ migration?: { versionSpec: string } }>_,
// );
// 
// export const applyOutstandingMigrations = makeEndpoint.main(
//   'applyOutstandingMigrations',
//   <{ workingCopyPath: string, datasetPath: string }>_,
//   <{ outcome: MigrationSequenceOutcome }>_,
// );
// 
// export const reportMigrationStatus = makeEndpoint.renderer(
//   'reportMigrationStatus',
//   <{ datasetVersion: string, currentMigrationVersionSpec?: string, operation: string, progress?: number }>_,
// )
