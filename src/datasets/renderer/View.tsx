/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { css, jsx } from '@emotion/core';
import React, { useState } from 'react';

import {
  Button, ButtonGroup,
  Callout,
  Classes, Colors,
  Navbar,
  NonIdealState,
  ProgressBar,
  Tag,
  Text,
  Tooltip,
  UL,
} from '@blueprintjs/core';

import { INITIAL_INDEX_STATUS } from '@riboseinc/paneron-extension-kit/types/indexes';
import { progressToValue } from '@riboseinc/paneron-extension-kit/util';

import { WindowComponentProps } from '../../window/types';
import { ErrorBoundary } from '../../renderer/widgets';

// IPC endpoints
import { getPluginInfo } from '../../plugins';
import { getClipboardStatus } from '../../clipboard/ipc';

import { DatasetInfo } from '../types';
import { describeIndex, indexStatusChanged } from '../ipc';

import { ContextGetterProps, getContext } from './context';
import getDataset from './getDataset';


const NODE_MODULES_PATH = process.env.NODE_ENV === 'production'
  ? `${__static}/../../app.asar.unpacked/node_modules`
  : `${__static}/../../node_modules`;


const query = new URLSearchParams(window.location.search);
const workingCopyPath = (query.get('workingCopyPath') || '').trim();
const datasetPath = (query.get('datasetPath') || '').trim() || undefined;

if (!datasetPath) {
  throw new Error("Missing dataset path");
}

//repositoryContentsChanged.renderer!.handle(async (evt) => {
//  if (workingCopyPath === evt.workingCopyPath) {
//    for (const objPath of Object.keys(evt.objects || {})) {
//      delete _index[makeObjectPathDatasetRelative(objPath, datasetPath)];
//    }
//  }
//});


const repoView: Promise<React.FC<WindowComponentProps>> = new Promise((resolve, reject) => {

  getDataset(workingCopyPath, datasetPath).then(({ writeAccess, dataset, MainView, getObjectView }) => {

    const Details: React.FC<Record<never, never>> = function () {
      const datasetGetterProps: ContextGetterProps = {
        writeAccess,
        workingCopyPath,
        datasetPath,
        nodeModulesPath: NODE_MODULES_PATH,
        datasetInfo: dataset,
        getObjectView,
      };

      const datasetContext = getContext(datasetGetterProps);

      const [datasetSettingsState, toggleDatasetSettingsState] = useState(false);

      return (
        <div css={css`flex: 1; display: flex; flex-flow: column nowrap; overflow: hidden;`}>
          <div
              className={Classes.ELEVATION_2}
              css={css`
                flex: 1; z-index: 2; display: flex; flex-flow: column nowrap; overflow: hidden;
                background: ${Colors.LIGHT_GRAY5};
              `}>
            <ErrorBoundary viewName="dataset">
              <MainView
                css={css`flex: 1; display: flex; flex-flow: column nowrap; overflow: hidden;`}
                {...datasetContext}
              />
            </ErrorBoundary>
          </div>

          <Toolbar
            dataset={dataset}
            datasetSettingsOpen={datasetSettingsState}
            onToggleDatasetSettings={() => toggleDatasetSettingsState(s => !s)} />
        </div>
      );

    }

    resolve(Details);

  }).catch((err) => resolve(() =>
    <NonIdealState
      icon="heart-broken"
      title="Error loading extension"
      css={css`background: ${Colors.LIGHT_GRAY5}`}
      description={<>
        <Callout style={{ textAlign: 'left' }} title="Suggestions to resolve" intent="primary">
          <p>Make sure Paneron can connect to internet, and try the following:</p>
          <UL>
            <li>Check that you have the extension for this dataset installed: you should
              see <Button disabled intent="success" small icon="tick-circle">Installed</Button> in dataset details pane.</li>
            <li>Downloading the latest version of Paneron, and upgrading the extension as well.</li>
          </UL>
        </Callout>
        <Callout title="Error details" style={{ transform: 'scale(0.8)', textAlign: 'left' }}>
          {err.message}
        </Callout>
      </>}
    />
  ));

});


export default repoView;


interface ToolbarProps {
  dataset: DatasetInfo

  datasetSettingsOpen: boolean
  onToggleDatasetSettings?: () => void
}

const Toolbar: React.FC<ToolbarProps> =
function ({ dataset, datasetSettingsOpen, onToggleDatasetSettings }) {

  const pluginInfo = getPluginInfo.renderer!.useValue({
    id: dataset.type.id || '',
  }, { plugin: null });

  const defaultIndexStatus = describeIndex.renderer!.useValue({
    workingCopyPath,
    datasetPath,
    indexID: 'default',
  }, { status: INITIAL_INDEX_STATUS });

  indexStatusChanged.renderer!.useEvent(async (evt) => {
    if (
      workingCopyPath === evt.workingCopyPath &&
      datasetPath === evt.datasetPath &&
      evt.indexID === 'default'
    ) {
      defaultIndexStatus.refresh();
    }
  }, []);

  const status = defaultIndexStatus.value.status;
  const progressValue = status.progress
    ? progressToValue(status.progress)
    : undefined;

  const clipboardStatus = getClipboardStatus.renderer!.useValue({
    workDir: workingCopyPath,
    datasetDir: datasetPath,
  }, {
    contents: null,
    canPaste: false,
  });

  const cbContents = clipboardStatus.value.contents;
  const cbCanPaste = clipboardStatus.value.canPaste;

  let clipboardTooltip: JSX.Element;
  if (cbContents !== null) {
    clipboardTooltip = <>
      <p>
        {cbContents.objectCount} object(s).
      </p>
      {cbCanPaste
        ? <>
            <p>
              Copied from dataset {cbContents.source.dataset.meta.title}
              in repository {cbContents.source.repository.title}
              (local: {cbContents.source.repository.workDir}).
            </p>
            <p>
              Paste in supported datasets.
            </p>
          </>
        : <>
            <p>
              Cannot paste in this dataset.
              Paste objects in a compatible dataset
              other than the dataset those objects were copied from.
            </p>
          </>}
    </>;
  } else {
    clipboardTooltip = <>
      <p>
        Clipboard is empty.
        Copy and paste objects between supported datasets.
      </p>
    </>;
  }

  return (
    <Navbar css={css`background: ${Colors.LIGHT_GRAY2}; height: 35px;`}>
      <Navbar.Group css={css`height: 35px`}>
        <ButtonGroup minimal>
          <Button icon="database" rightIcon="caret-up">
            {dataset.title}
            {" "}
            {pluginInfo.value.plugin
              ? <>— {pluginInfo.value.plugin.title} v{pluginInfo.value.plugin.npm.version}</>
              : null}
          </Button>
          <Button
            icon="settings"
            disabled={!onToggleDatasetSettings}
            onClick={onToggleDatasetSettings}
            active={datasetSettingsOpen} />
          <Tooltip content={clipboardTooltip}>
            <Button
                icon="clipboard"
                intent={cbCanPaste ? 'primary' : undefined}>
              {cbContents !== null
                ? <Tag>{cbContents.objectCount}</Tag>
                : null}
            </Button>
          </Tooltip>
        </ButtonGroup>
      </Navbar.Group>
      <Navbar.Group css={css`height: 35px`} align="right">
        {status
          ? <Text>{status.progress?.phase}</Text>
          : null}
        <ProgressBar
          intent="primary"
          value={progressValue}
          css={css`margin: 0 1rem; width: 10rem;`} />
        <Text css={css`white-space: nowrap;`}>
          {status.objectCount} objects
        </Text>
      </Navbar.Group>
    </Navbar>
  );
};


// const InitialView = () => <NonIdealState title={<Spinner />} />;
// const InvalidView = () => <NonIdealState title="Invalid plugin" />;


//const DatasetSettings: React.FC<Record<never, never>> = function () {
//  return <p>Dataset settings</p>
//}
