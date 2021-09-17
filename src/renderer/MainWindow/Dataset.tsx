/** @jsx jsx */
/** @jsxFrag React.Fragment */

//import log from 'electron-log';
import { jsx, css } from '@emotion/react';
import React, { useContext, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import MathJax from 'react-mathjax2';
import { IconSize, NonIdealState, Spinner, Toaster } from '@blueprintjs/core';
import { DatasetContext } from '@riboseinc/paneron-extension-kit/types';
import { unloadDataset } from 'datasets/ipc';
import getDataset from 'datasets/renderer/getDataset';
import { getContext } from 'datasets/renderer/context';
import { ErrorBoundary } from '../widgets';
import { Context } from './context';
import { DatasetInfo } from 'datasets/types';


const NODE_MODULES_PATH = process.env.NODE_ENV === 'production'
  ? `${__static}/../../app.asar.unpacked/node_modules`
  : `${__static}/../../node_modules`;

const MATHJAX_PATH = `${NODE_MODULES_PATH}/mathjax/MathJax.js?config=AM_HTMLorMML`;


const toaster = Toaster.create({ position: 'bottom' });


const Dataset: React.FC<{ className?: string }> =
function ({ className }) {
  const { state: { selectedRepoWorkDir, selectedDatasetID } } = useContext(Context);
  const [isLoading, setLoading] = useState(false);
  const [dsProps, setDatasetProperties] = useState<{
    writeAccess: boolean;
    dataset: DatasetInfo;
    MainView: React.FC<DatasetContext & { className?: string }>;
  } | null>(null);

  const [operationKey, setOperationKey] = useState<string | undefined>(undefined);
  function performOperation<P extends any[], R>(gerund: string, func: (...opts: P) => Promise<R>) {
    return async (...opts: P) => {
      const opKey = toaster.show({
        message: `${gerund}…`,
        intent: 'primary',
        icon: <Spinner size={IconSize.STANDARD} />,
        timeout: 0,
      });
      setOperationKey(opKey);
      try {
        // TODO: Investigate why calls to console or electron-log from within func()
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
  }

  const loadDataset = performOperation('loading dataset', async () => {
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
  })

  useEffect(() => {
    loadDataset();
    return function cleanup() {
      if (selectedRepoWorkDir && selectedDatasetID) {
        unloadDataset.renderer!.trigger({
          workingCopyPath: selectedRepoWorkDir,
          datasetPath: selectedDatasetID,
        });
      }
    }
  }, [selectedRepoWorkDir, selectedDatasetID]);

  const ctx = selectedRepoWorkDir && selectedDatasetID && dsProps
    ? { ...getContext({
        writeAccess: dsProps.writeAccess,
        workingCopyPath: selectedRepoWorkDir,
        datasetPath: selectedDatasetID,
        nodeModulesPath: NODE_MODULES_PATH,
        datasetInfo: dsProps.dataset,
        getObjectView: () => () => <></>,
      }), performOperation, operationKey }
    : null;

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
