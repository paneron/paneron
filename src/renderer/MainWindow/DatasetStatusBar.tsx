/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/core';
import React, { useContext, useState } from 'react';
import { ProgressBar, Text } from '@blueprintjs/core';
import { IndexStatus } from '@riboseinc/paneron-extension-kit/types/indexes';
import { Context } from './context';
import { describeIndex, indexStatusChanged } from 'datasets/ipc';


export const DatasetStatusBar: React.FC<Record<never, never>> = React.memo(function () {
  const { state: { selectedRepoWorkDir, selectedDatasetID } } = useContext(Context);

  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);

  const indexDescResp = describeIndex.renderer!.useValue({
    workingCopyPath: selectedRepoWorkDir ?? '',
    datasetPath: selectedDatasetID ?? '',
  }, { status: initialStatus });

  indexStatusChanged.renderer!.useEvent(async ({ workingCopyPath, datasetPath, indexID, status }) => {
    if (workingCopyPath === selectedRepoWorkDir && datasetPath === selectedDatasetID && indexID === undefined) {
      setIndexStatus(status);
    }
  }, [selectedRepoWorkDir, selectedDatasetID]);

  const status = indexStatus ?? indexDescResp.value.status;

  const progressValue = Math.floor(100 / (status.progress?.total || 100) * (status.progress?.loaded || 1)) / 100

  return (
    status.progress
      ? <>
          <Text>
            {status.progress.phase}:
            {" "}
            {status.progress.loaded} of {status.progress.total}
          </Text>
          &emsp;
          <ProgressBar
            stripes={false}
            value={progressValue} />
        </>
      : <>
          {status.objectCount} object(s) in dataset
        </>
  );
});

const initialStatus: IndexStatus = { objectCount: 0, progress: { phase: 'initializing', total: 0, loaded: 0 } };

export default DatasetStatusBar;
