/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/react';
import React, { useState } from 'react';
import { IndexStatus } from '@riboseinc/paneron-extension-kit/types/indexes';
import { getPluginInfo, pluginsUpdated } from 'plugins';
import { describeIndex, indexStatusChanged } from 'datasets/ipc';
import { DatasetInfo } from 'datasets/types';
import { Breadcrumb } from './Breadcrumb';


export const DatasetBreadcrumb: React.FC<{
  workDir: string
  datasetID: string
  datasetInfo: DatasetInfo
  onClose: () => void
}> = function ({ workDir, datasetID, datasetInfo, onClose }) {
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);

  const indexDescResp = describeIndex.renderer!.useValue({
    workingCopyPath: workDir,
    datasetPath: datasetID,
  }, { status: initialDefaultDatasetIndexStatus });

  const pluginInfoResp = getPluginInfo.renderer!.useValue(
    { id: datasetInfo.type.id ?? 'N/A' },
    { plugin: null });

  const activeDatasetUIExtension = pluginInfoResp.value.plugin;

  pluginsUpdated.renderer!.useEvent(async () => {
    pluginInfoResp.refresh();
  }, [datasetInfo.type.id]);

  indexStatusChanged.renderer!.useEvent(async ({ workingCopyPath, datasetPath, indexID, status }) => {
    if (workingCopyPath === workDir && datasetPath === datasetID && indexID === undefined) {
      setIndexStatus(status);
    }
  }, [workDir, datasetID]);

  const status = indexStatus ?? indexDescResp.value.status;

  return (
    <Breadcrumb
      title={datasetInfo.title}
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
