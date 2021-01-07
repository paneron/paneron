import path from 'path';
import { ObjectChangeset, ObjectChangeStatusSet, ObjectDataRequest, ObjectDataset } from '@riboseinc/paneron-extension-kit/types';
import { makeWindowForComponent } from 'window';
import { EmptyPayload, makeEndpoint, _ } from '../ipc';
import { DatasetInfo, DatasetType, MigrationSequenceOutcome } from './types';


/* List dataset types, provided by extensions, available for dataset initialization */
export const listAvailableTypes = makeEndpoint.main(
  'listAvailableTypes',
  <EmptyPayload>_,
  <{ types: DatasetType[] }>_,
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


export const deleteDataset = makeEndpoint.main(
  'deleteDataset',
  <{ workingCopyPath: string, datasetPath: string }>_,
  <{ success: true }>_,
);


// Working with data

export const listObjectPaths = makeEndpoint.main(
  'datasets_listObjectPaths',
  <{ workingCopyPath: string, datasetPath: string, queryExpression?: string }>_,
  <{ objectPaths: string[] }>_,
);

export const readObjects = makeEndpoint.main(
  'datasets_readObjects',
  <{ workingCopyPath: string, datasetPath: string, objectPaths: string[] }>_,
  <{ data: Record<string, Record<string, any>> }>_,
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


// Windows

export const datasetDetails = makeWindowForComponent(
  'datasetDetails',
  () => import('datasets/View'),
  'Dataset',
  {
    dimensions: {
      minWidth: 980,
      minHeight: 600,
      width: 1100,
      height: 750,
    },
  },
);


// Operations on object changesets, object datasets and object paths
// that make them dataset-relative or repo-relative.

export function makeChangesetRepoRelative(changeset: ObjectChangeset, datasetPath: string): ObjectChangeset {
  return Object.entries(changeset).
    map(([objPath, data]) =>
      ({ [makeObjectPathRepoRelative(objPath, datasetPath)]: data })
    ).reduce((prev, curr) => ({ ...prev, ...curr }), {});
}

export function makeObjectStatusSetDatasetRelative(statuses: ObjectChangeStatusSet, datasetPath: string): ObjectChangeStatusSet {
  return Object.entries(statuses).
    map(([repoPath, payload]) =>
      ({ [makeObjectPathDatasetRelative(repoPath, datasetPath)]: payload })
    ).reduce((prev, curr) => ({ ...prev, ...curr }), {});
}

export function makeDataRequestRepoRelative(request: ObjectDataRequest, datasetPath: string): ObjectDataRequest {
  return Object.entries(request).
    map(([datasetObjectPath, reqParams]) =>
      ({ [makeObjectPathRepoRelative(datasetObjectPath, datasetPath)]: reqParams })
    ).reduce((prev, curr) => ({ ...prev, ...curr }), {});
}

export function makeDatasetDatasetRelative(dataset: ObjectDataset, datasetPath: string): ObjectDataset {
  return Object.entries(dataset).
    map(([objPath, data]) =>
      ({ [makeObjectPathDatasetRelative(objPath, datasetPath)]: data })
    ).reduce((prev, curr) => ({ ...prev, ...curr }), {});
}

export function makeObjectPathDatasetRelative(repoObjectPath: string, datasetPath: string): string {
  return repoObjectPath.replace(`${datasetPath}/`, '');
}

export function makeObjectPathRepoRelative(datasetObjectPath: string, datasetPath: string): string {
  return datasetPath ? path.join(datasetPath, datasetObjectPath) : datasetObjectPath;
}
