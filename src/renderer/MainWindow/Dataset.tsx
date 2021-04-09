/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { jsx, css } from '@emotion/core';
import React, { useContext, useEffect, useState } from 'react';
import { NonIdealState } from '@blueprintjs/core';
import getDataset from '../../datasets/renderer/getDataset';
import { ContextGetterProps, getContext } from '../../datasets/renderer/context';
import { Context } from './context';
import { unloadDataset } from 'datasets/ipc';


const NODE_MODULES_PATH = process.env.NODE_ENV === 'production'
  ? `${__static}/../../app.asar.unpacked/node_modules`
  : `${__static}/../../node_modules`;


const Dataset: React.FC<{ className?: string }> =
function ({ className }) {
  const { state: { selectedRepoWorkDir, selectedDatasetID }, showMessage } = useContext(Context);

  const [datasetView, setDatasetView] = useState<JSX.Element | null>(null);

  useEffect(() => {
    (async () => {
      if (selectedRepoWorkDir && selectedDatasetID) {
        try {
          const { MainView, dataset } = await getDataset(selectedRepoWorkDir, selectedDatasetID);

          const datasetGetterProps: ContextGetterProps = {
            writeAccess: false,
            workingCopyPath: selectedRepoWorkDir,
            datasetPath: selectedDatasetID,
            nodeModulesPath: NODE_MODULES_PATH,
            datasetInfo: dataset,
            getObjectView: () => () => <></>,
          };

          const datasetContext = getContext(datasetGetterProps);

          setDatasetView(<MainView {...datasetContext} />);
        } catch (e) {
          log.error("Error loading dataset", e);
          showMessage({ intent: 'danger', icon: 'error', message: "Failed to load dataset" });
        }
      } else {
        setDatasetView(<NonIdealState icon="heart-broken" title="Nothing to show here" />);
      }
    })();
    return function cleanup() {
      if (selectedRepoWorkDir && selectedDatasetID) {
        unloadDataset.renderer!.trigger({
          workingCopyPath: selectedRepoWorkDir,
          datasetPath: selectedDatasetID,
        });
      }
    }
  }, [selectedRepoWorkDir, selectedDatasetID]);

  return (
    <div css={css`display: flex; flex-flow: row nowrap;`} className={className}>
      {datasetView}
    </div>
  );
}


export default Dataset;
