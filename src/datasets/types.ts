import { BufferChangeset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { PathChanges } from '@riboseinc/paneron-extension-kit/types/changes';


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
