import { RecentlyOpenedDataset } from 'datasets/types';
import { loadState, storeState } from 'state/manage';

const RECENT_DATASETS_STATE_KEY = 'recent-datasets';
const MAX_RECENTLY_OPENED_DATASETS = 5;

/** Stores metadata of a recently opened dataset in UI state store. */
export async function record(workDir: string, datasetID: string) {
  const state = await loadState(RECENT_DATASETS_STATE_KEY);
  const datasetsPrev: RecentlyOpenedDataset[] = state?.datasets ?? [];
  const otherDatasets = datasetsPrev.filter(ds => ds.workDir !== workDir || ds.datasetID !== datasetID);
  const datasets: RecentlyOpenedDataset[] = [
    { workDir, datasetID },
    ...otherDatasets,
  ].slice(0, MAX_RECENTLY_OPENED_DATASETS);
  await storeState(RECENT_DATASETS_STATE_KEY, {
    datasets,
  });
}

/** Loads recently opened datasets from UI state store. */
export async function list(): Promise<RecentlyOpenedDataset[]> {
  const state = await loadState(RECENT_DATASETS_STATE_KEY);
  const datasets: RecentlyOpenedDataset[] = state?.datasets ?? [];
  return datasets;
}
