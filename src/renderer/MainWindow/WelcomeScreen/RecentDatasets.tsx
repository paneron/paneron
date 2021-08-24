/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React from 'react';
import { jsx } from '@emotion/react';
import { Menu } from '@blueprintjs/core';
import { listRecentlyOpenedDatasets } from 'datasets/ipc';
import DatasetMenuItem from './DatasetMenuItem';

const RecentDatasets: React.FC<{ onOpenDataset?: (workDir: string, dsID: string) => void; }> = function ({ onOpenDataset }) {
  const recentDatasetsResp = listRecentlyOpenedDatasets.renderer!.useValue({}, { datasets: [] });
  const datasets = recentDatasetsResp.value.datasets;
  return (
    <Menu>
      {datasets.map(({ workDir, datasetID }) => <DatasetMenuItem
        workDir={workDir}
        datasetID={datasetID}
        showRepoInfo
        onClick={onOpenDataset ? () => onOpenDataset!(workDir, datasetID) : undefined} />
      )}
    </Menu>
  );
};

export default RecentDatasets;
