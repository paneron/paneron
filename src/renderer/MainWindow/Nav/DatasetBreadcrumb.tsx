/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/react';
import React, { useState } from 'react';
import type { IndexStatus } from '@riboseinc/paneron-extension-kit/types/indexes';
import { getPluginInfo, pluginsUpdated } from 'plugins';
import { describeIndex, indexStatusChanged } from 'datasets/ipc';
import { getDatasetInfo } from 'datasets/ipc';
import { Breadcrumb } from './Breadcrumb';


export const DatasetBreadcrumb: React.FC<{
  workDir: string
  datasetID: string
  onClose: () => void
}> = function ({ workDir, datasetID, onClose }) {
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);

  const datasetInfoResp = getDatasetInfo.renderer!.useValue(
    { workingCopyPath: workDir, datasetID },
    { info: null });

  const datasetInfo = datasetInfoResp.value.info

  const indexDescResp = describeIndex.renderer!.useValue({
    workingCopyPath: workDir,
    datasetID: datasetID,
  }, { status: initialDefaultDatasetIndexStatus });

  const pluginInfoResp = getPluginInfo.renderer!.useValue(
    { id: datasetInfo?.type.id ?? 'N/A' },
    { plugin: null });

  const activeDatasetUIExtension = pluginInfoResp.value.plugin;

  pluginsUpdated.renderer!.useEvent(async () => {
    pluginInfoResp.refresh();
  }, [workDir, datasetID]);

  indexStatusChanged.renderer!.useEvent(async ({ workingCopyPath, datasetID: dsID, indexID, status }) => {
    if (workingCopyPath === workDir && dsID === datasetID && indexID === undefined) {
      setIndexStatus(status);
    }
  }, [workDir, datasetID]);

  const status = indexStatus ?? indexDescResp.value.status;

  return (
    <Breadcrumb
      title={datasetInfo?.title ?? 'N/A'}
      icon={{ type: 'blueprint', iconName: "database" }}
      onClose={onClose}
      status={<>
        <code>{status.objectCount}</code> object(s) in dataset
        <br />
        Dataset UI extension version:
        {" "}
        <code>
          {activeDatasetUIExtension?.installedVersion ?? 'N/A'}
        </code>
        {activeDatasetUIExtension?.isLocal
          ? <strong> (local)</strong>
          : null}
      </>}
      progress={status.progress}
    />
  );
};


const initialDefaultDatasetIndexStatus: IndexStatus = { objectCount: 0, progress: { phase: 'initializing', total: 0, loaded: 0 } };


export default DatasetBreadcrumb;
