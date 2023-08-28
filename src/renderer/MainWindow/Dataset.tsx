/** @jsx jsx */
/** @jsxFrag React.Fragment */

//import log from 'electron-log';
import { jsx, css } from '@emotion/react';
import { useContext, useEffect, useState, useMemo } from 'react';
import React from 'react';
import { Helmet } from 'react-helmet';
import MathJax from 'react-mathjax2';
import { FormGroup, Button, Radio, RadioGroup, Icon, IconSize, Classes, NonIdealState, Spinner } from '@blueprintjs/core';

import HelpTooltip from '@riboseinc/paneron-extension-kit/widgets/HelpTooltip';
import type { RendererPlugin, DatasetContext } from '@riboseinc/paneron-extension-kit/types';
import OperationQueueContext from '@riboseinc/paneron-extension-kit/widgets/OperationQueue/context';

import { ZipArchive } from '../../renderer/zip/ZipArchive';
import { stripLeadingSlash } from '../../utils';

import { getBufferDataset, getBufferPaths } from 'repositories/ipc';
import { unloadDataset } from 'datasets/ipc';
import getDataset from 'datasets/renderer/getDataset';
import { getFullAPI } from 'datasets/renderer/context';
import type { DatasetInfo } from 'datasets/types';
import { getPluginInfo } from 'plugins';
import ErrorBoundary from '../common/ErrorBoundary';
import { Context } from './context';


const NODE_MODULES_PATH = process.env.NODE_ENV === 'production'
  ? `${__static}/../../app.asar.unpacked/node_modules`
  : `${__static}/../../node_modules`;

const MATHJAX_PATH = `${NODE_MODULES_PATH}/mathjax/MathJax.js?config=AM_HTMLorMML`;


//const toaster = Toaster.create({ position: 'bottom-left', canEscapeKeyClear: false });


const Dataset: React.FC<{ className?: string; showExportOptions?: true }> =
function ({ className, showExportOptions }) {
  const { state: { selectedRepoWorkDir, selectedDatasetID }, dispatch } = useContext(Context);
  const { performOperation, isBusy } = useContext(OperationQueueContext);
  const [isLoading, setLoading] = useState(false);
  const [dsProps, setDatasetProperties] = useState<{
    writeAccess: boolean;
    dataset: DatasetInfo;
    MainView: React.FC<DatasetContext & { className?: string }>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    performOperation('loading dataset', async () => {
      if (cancelled) { return };
      if (selectedRepoWorkDir && selectedDatasetID) {
        setLoading(true);
        try {
          const dsProps = await getDataset(selectedRepoWorkDir, selectedDatasetID);
          if (cancelled) { return };
          setDatasetProperties(dsProps);
        } finally {
          if (cancelled) { return };
          setLoading(false);
        }
      } else {
        setLoading(false);
        setDatasetProperties(null);
      }
    }, { blocking: true })();
    return function cleanup() {
      cancelled = true;
      if (selectedRepoWorkDir && selectedDatasetID) {
        unloadDataset.renderer!.trigger({
          workingCopyPath: selectedRepoWorkDir,
          datasetID: selectedDatasetID,
        });
      }
    }
  }, [selectedRepoWorkDir, selectedDatasetID]);

  const ctx: DatasetContext | null =
  useMemo((() => selectedRepoWorkDir && selectedDatasetID && dsProps
    ? {
        ...getFullAPI({
          workingCopyPath: selectedRepoWorkDir,
          datasetID: selectedDatasetID,
          writeAccess: dsProps.writeAccess,
          performOperation,
          isBusy,
        }),
        title: dsProps.dataset.title,
      }
    : null
  ), [
    selectedRepoWorkDir,
    selectedDatasetID,
    JSON.stringify(dsProps),
    performOperation,
  ]);

  const view = ctx && dsProps
    ? <ErrorBoundary viewName="dataset"><dsProps.MainView {...ctx} /></ErrorBoundary>
    : isLoading
      ? <NonIdealState
          icon={<Spinner />}
          description={<>This should take a few seconds<br />Please make sure you’re online</>}
        />
      : <NonIdealState icon="heart-broken" description="Unable to load dataset" />;

  return (
    <MathJax.Context
        script={`file://${MATHJAX_PATH}`}
        options={{
          asciimath2jax: {
            useMathMLspacing: true,
            delimiters: [["`","`"]],
            preview: "none",
          },
        }}>
      <div css={css`display: flex; flex-flow: row nowrap;`} className={className}>
        <Helmet>
          <title>{ctx?.title ?? selectedDatasetID} (dataset)</title>
        </Helmet>
        {view}
      </div>
    </MathJax.Context>
  );
}


export default Dataset;
