/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React from 'react';
import { jsx, css } from '@emotion/react';
import { Menu, Colors } from '@blueprintjs/core';
import { listRecentlyOpenedDatasets } from 'datasets/ipc';
import DatasetMenuItem from './DatasetMenuItem';

const RecentDatasets: React.FC<{
  onOpenDataset?: (workDir: string, dsID: string) => void;
  className?: string;
}> = function ({ onOpenDataset, className }) {
  const recentDatasetsResp = listRecentlyOpenedDatasets.renderer!.useValue({}, { datasets: [] });
  const datasets = recentDatasetsResp.value.datasets;
  return (
    <Menu className={className} css={css`.bp4-dark & { background: ${Colors.DARK_GRAY1}; }`}>
      {datasets.map(({ workDir, datasetID }) => <DatasetMenuItem
        key={`${workDir}-${datasetID}`}
        workDir={workDir}
        datasetID={datasetID}
        showRepoInfo
        onClick={onOpenDataset ? () => onOpenDataset!(workDir, datasetID) : undefined} />
      )}
    </Menu>
  );
};

export default RecentDatasets;
