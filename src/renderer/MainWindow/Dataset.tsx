/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { jsx, css } from '@emotion/react';
import React, { useContext, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import MathJax from 'react-mathjax2';
import { IconSize, NonIdealState, Spinner, Toaster } from '@blueprintjs/core';
import { DatasetContext } from '@riboseinc/paneron-extension-kit/types';
import { unloadDataset } from 'datasets/ipc';
import getDataset from 'datasets/renderer/getDataset';
import { ContextGetterProps, getContext } from 'datasets/renderer/context';
import { Context } from './context';


const NODE_MODULES_PATH = process.env.NODE_ENV === 'production'
  ? `${__static}/../../app.asar.unpacked/node_modules`
  : `${__static}/../../node_modules`;

const MATHJAX_PATH = `${NODE_MODULES_PATH}/mathjax/MathJax.js?config=AM_HTMLorMML`;


const toaster = Toaster.create({ position: 'bottom' });


const Dataset: React.FC<{ className?: string }> =
function ({ className }) {
  const { state: { selectedRepoWorkDir, selectedDatasetID }, showMessage } = useContext(Context);

  const [datasetView, setDatasetView] = useState<JSX.Element | null>(null);
  const [datasetContext, setDatasetContext] = useState<DatasetContext | null>(null);

  const [_operationKey, setOperationKey] = useState<string | undefined>(undefined);
  function performOperation<R>(gerund: string, func: () => Promise<R>) {
    return async () => {
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
        const result: R = await func();
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

  useEffect(() => {
    (async () => {
      if (selectedRepoWorkDir && selectedDatasetID) {
        try {
          const { MainView, dataset, writeAccess } = await getDataset(selectedRepoWorkDir, selectedDatasetID);

          const datasetGetterProps: ContextGetterProps = {
            writeAccess,
            workingCopyPath: selectedRepoWorkDir,
            datasetPath: selectedDatasetID,
            nodeModulesPath: NODE_MODULES_PATH,
            datasetInfo: dataset,
            getObjectView: () => () => <></>,
          };

          const datasetContext = getContext(datasetGetterProps);
          datasetContext.performOperation = performOperation;

          setDatasetContext(datasetContext);
          setDatasetView(<MainView {...datasetContext} />);
        } catch (e) {
          log.error("Error loading dataset", e);
          setDatasetContext(null);
          setDatasetView(<NonIdealState icon="heart-broken" title="Failed to load dataset" />);
          showMessage({ intent: 'danger', icon: 'error', message: "Failed to load dataset" });
        }
      } else {
        setDatasetContext(null);
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
          <title>{datasetContext?.title ?? selectedDatasetID} (dataset)</title>
        </Helmet>
        {datasetView}
      </div>
    </MathJax.Context>
  );
}


export default Dataset;
