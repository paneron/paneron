/** @jsx jsx */
/** @jsxFrag React.Fragment */

//import log from 'electron-log';
import { jsx, css } from '@emotion/react';
import React, { useCallback, useContext, useEffect, useState, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import MathJax from 'react-mathjax2';
import { NonIdealState, ProgressBar, Spinner, Toaster } from '@blueprintjs/core';

import type { DatasetContext } from '@riboseinc/paneron-extension-kit/types';

import { unloadDataset } from 'datasets/ipc';
import getDataset from 'datasets/renderer/getDataset';
import { getContext } from 'datasets/renderer/context';
import type { DatasetInfo } from 'datasets/types';
import ErrorBoundary from '../common/ErrorBoundary';
import { Context } from './context';


const NODE_MODULES_PATH = process.env.NODE_ENV === 'production'
  ? `${__static}/../../app.asar.unpacked/node_modules`
  : `${__static}/../../node_modules`;

const MATHJAX_PATH = `${NODE_MODULES_PATH}/mathjax/MathJax.js?config=AM_HTMLorMML`;


const toaster = Toaster.create({ position: 'bottom-left', canEscapeKeyClear: false });


const Dataset: React.FC<{ className?: string; showExportOptions?: true }> =
function ({ className, showExportOptions }) {
  const { state: { selectedRepoWorkDir, selectedDatasetID } } = useContext(Context);
  const [isLoading, setLoading] = useState(false);
  const [dsProps, setDatasetProperties] = useState<{
    writeAccess: boolean;
    dataset: DatasetInfo;
    MainView: React.FC<DatasetContext & { className?: string }>;
  } | null>(null);

  const [operationKey, setOperationKey] = useState<string | undefined>(undefined);
  const performOperation = useCallback(function <P extends any[], R>(gerund: string, func: (...opts: P) => Promise<R>) {
    return async (...opts: P) => {
      const opKey = toaster.show({
        message: <div css={css`display: flex; flex-flow: row nowrap; white-space: nowrap; align-items: center;`}>
          <ProgressBar intent="primary" css={css`width: 50px;`} />
          &emsp;
          {gerund}…
        </div>,
        intent: 'primary',
        timeout: 0,
      });
      setOperationKey(opKey);
      try {
        // TODO: Investigate whether/why calls to console or electron-log from within func()
        // are not resulting in expected console output.
        const result: R = await func(...opts);
        toaster.dismiss(opKey);
        toaster.show({ message: `Done ${gerund}`, intent: 'success', icon: 'tick-circle' });
        setOperationKey(undefined);
        return result;
      } catch (e) {
        let errMsg: string;
        const rawErrMsg = (e as any).toString?.();
        if (rawErrMsg.indexOf('Error:')) {
          const msgParts = rawErrMsg.split('Error:');
          errMsg = msgParts[msgParts.length - 1].trim();
        } else {
          errMsg = rawErrMsg;
        }
        toaster.dismiss(opKey);
        toaster.show({
          message: `Problem ${gerund}. The error said: “${errMsg}”`,
          intent: 'danger',
          icon: 'error',
          timeout: 0,
          onDismiss: () => {
            setOperationKey(undefined);
          },
        });
        throw e;
      }
    }
  }, [operationKey]);

  useEffect(() => {
    performOperation('loading dataset', async () => {
      setLoading(true);
      if (selectedRepoWorkDir && selectedDatasetID) {
        try {
          setDatasetProperties(await getDataset(selectedRepoWorkDir, selectedDatasetID));
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
        setDatasetProperties(null);
      }
    })();
    return function cleanup() {
      if (selectedRepoWorkDir && selectedDatasetID) {
        unloadDataset.renderer!.trigger({
          workingCopyPath: selectedRepoWorkDir,
          datasetID: selectedDatasetID,
        });
      }
    }
  }, [selectedRepoWorkDir, selectedDatasetID]);

  const ctx = useMemo((() => selectedRepoWorkDir && selectedDatasetID && dsProps
    ? {
        ...getContext({
          writeAccess: dsProps.writeAccess,
          workingCopyPath: selectedRepoWorkDir,
          datasetID: selectedDatasetID,
          nodeModulesPath: NODE_MODULES_PATH,
          datasetInfo: dsProps.dataset,
          getObjectView: () => () => <></>,
        }),
        performOperation,
        operationKey,
      }
    : null
  ), [
    selectedRepoWorkDir,
    selectedDatasetID,
    JSON.stringify(dsProps),
    performOperation,
    operationKey,
  ]);

  const view = ctx && dsProps
    ? <ErrorBoundary viewName="dataset"><dsProps.MainView {...ctx} /></ErrorBoundary>
    : isLoading
      ? <NonIdealState
          icon={<Spinner />}
          description={<>This should take a few seconds<br />Please make sure you’re online</>}
        />
      : <NonIdealState icon="heart-broken" description="Unable to load dataset" />

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
