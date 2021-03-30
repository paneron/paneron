/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/core';
import React, { useContext, useEffect, useState } from 'react';
import { getDataset } from 'datasets/renderer/View';
import { Context } from './context';
import { ContextGetterProps, getContext } from 'datasets/renderer/context';
import { NonIdealState } from '@blueprintjs/core';


const NODE_MODULES_PATH = process.env.NODE_ENV === 'production'
  ? `${__static}/../../app.asar.unpacked/node_modules`
  : `${__static}/../../node_modules`;


const Dataset: React.FC<Record<never, never>> =
function () {
  const { state: { selectedRepoWorkDir, selectedDatasetID } } = useContext(Context);

  const [datasetView, setDatasetView] = useState<JSX.Element | null>(null);

  useEffect(() => {
    (async () => {
      if (selectedRepoWorkDir && selectedDatasetID) {
        const { MainView, dataset } = await getDataset(selectedRepoWorkDir);

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
      } else {
        setDatasetView(<NonIdealState icon="heart-broken" title="Nothing to show here" />);
      }
    })();
  }, [selectedRepoWorkDir, selectedDatasetID]);

  return (
    <div css={css`display: flex; flex-flow: row nowrap;`}>
      Dataset WIP
      {datasetView}
    </div>
  );
}


export default Dataset;
