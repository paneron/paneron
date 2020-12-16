import { ObjectChangeset } from '@riboseinc/paneron-extension-kit/types';
import { Conflicts } from 'repositories/types';


export interface DatasetType {
  id: string
  version: string
}


export interface DatasetInfo {
  title: string
  type: DatasetType
}


export interface MigrationSequenceOutcome {
  success: boolean
  error?: { currentMigrationVersionSpec?: string, message: string, conflicts?: Conflicts }
  changesApplied: { commitHash: string, changeset: ObjectChangeset }[]
}
