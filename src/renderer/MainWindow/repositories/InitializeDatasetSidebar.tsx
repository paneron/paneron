/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/react';

import React, { useContext, useState } from 'react';
import { Card, Button, Colors, InputGroup, Classes } from '@blueprintjs/core';
import makeSidebar from '@riboseinc/paneron-extension-kit/widgets/Sidebar';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import { describeRepository, repositoriesChanged, Repository } from 'repositories/ipc';
import { Context } from '../context';
import DatasetExtension, { DatasetExtensionCardProps } from 'plugins/renderer/DatasetExtensionCard';
import { Extension } from 'plugins/types';
import { listAvailablePlugins } from 'plugins';
import { initializeDataset, proposeDatasetPath } from 'datasets/ipc';


const Sidebar = makeSidebar(usePaneronPersistentStateReducer);


export const InitializeDatasetSidebar: React.FC<{ workDir: string; repoInfo?: Repository; className?: string; }> = function ({ workDir, repoInfo, className }) {
  const { performOperation, isBusy } = useContext(Context);

  const [selectedExtension, selectExtension] = useState<Extension | null>(null);

  const [datasetID, setDatasetID] = useState<string>('');
  const [title, setTitle] = useState<string>('');

  const openedRepoResp = describeRepository.renderer!.useValue(
    { workingCopyPath: workDir },
    { info: { gitMeta: { workingCopyPath: workDir, mainBranch: '' } } });

  repositoriesChanged.renderer!.useEvent(async ({ changedWorkingPaths }) => {
    if ((changedWorkingPaths ?? []).indexOf(workDir) >= 0) {
      openedRepoResp.refresh();
    }
  }, [workDir]);

  const checkResult = proposeDatasetPath.renderer!.useValue({
    workingCopyPath: workDir,
    datasetPath: datasetID,
  }, { path: undefined });


  const canInitialize = datasetID.trim() !== '' && title.trim() !== '' && selectedExtension !== null && checkResult.value.path;
  async function _initializeDataset() {
    if (!canInitialize) {
      throw new Error("Missing information required for dataset initialization");
    }
    if (title && checkResult.value.path && selectedExtension) {
      await initializeDataset.renderer!.trigger({
        workingCopyPath: workDir,
        meta: {
          title,
          type: {
            id: selectedExtension.npm.name,
            version: selectedExtension.npm.version,
          },
        },
        datasetPath: checkResult.value.path,
      });
      setDatasetID('');
      setTitle('');
    }
  }

  return <Sidebar
    stateKey='initialize-dataset-panels'
    title="Initialize new dataset"
    blocks={[{
      key: 'extension',
      title: "Extension",
      content: <DatasetExtensionBrowser onSelect={selectExtension} selectedExtension={selectedExtension ?? undefined} />,
    }, {
      key: 'meta',
      title: "Metadata",
      content: <>
        <PropertyView label="ID">
          <TextInput
            value={datasetID}
            onChange={(id) => setDatasetID(id.toLowerCase())} 
            validationErrors={datasetID.trim() === ''
              ? ["Alphanumeric, no spaces. This will also be used as a name for dataset directory under repository root."]
              : !checkResult.value.path
                ? ["This ID may already be taken. Please choose another."]
                : []}>
          </TextInput>
        </PropertyView>
        <PropertyView label="Title">
          <TextInput
            value={title}
            onChange={setTitle}
            validationErrors={title.trim() === '' ? ["Short descriptive human-readable title for the new dataset."] : []} />
        </PropertyView>
      </>
    }, {
      key: 'initialize',
      title: "Initialize",
      nonCollapsible: true,
      content: <>
        <Button small fill
          disabled={!canInitialize || isBusy}
          intent={canInitialize ? 'primary' : undefined}
          onClick={canInitialize
            ? performOperation('initializing dataset', _initializeDataset)
            : undefined}>
          Initialize {selectedExtension?.title} dataset
        </Button>
      </>,
    }]}
    className={className} />;
};

const DatasetExtensionBrowser: React.FC<{ onSelect?: (extension: Extension) => void, selectedExtension?: Extension }> =
function ({ selectedExtension, onSelect }) {
  const [searchString, setSearchString] = useState('');
  const extensionResp = listAvailablePlugins.renderer!.useValue({}, { extensions: [] });
  const extensions = extensionResp.value.extensions.filter(ext => {
    const str = searchString.toLowerCase();
    if (str.trim().length < 3) {
      return ext.featured;
    } else {
      return (
        ext.title.toLowerCase().indexOf(str) >= 0 ||
        ext.description.toLowerCase().indexOf(str) >= 0 ||
        ext.author.toLowerCase().indexOf(str) >= 0 ||
        ext.npm.name.toLowerCase().indexOf(str) >= 0);
    }
  });

  return (
    <div css={css`
        flex: 1;
        display: flex;
        flex-flow: column nowrap;
        overflow: hidden;
      `}>
      <div css={css`padding: .15rem 0 .25rem 0; z-index: 1;`} className={Classes.ELEVATION_1}>
        <InputGroup
          fill
          leftIcon="search"
          placeholder="Search…"
          rightElement={
            <Button minimal disabled={searchString.trim() === ''} onClick={() => setSearchString('')} icon="cross" />
          }
          value={searchString}
          onChange={(evt: React.FormEvent<HTMLInputElement>) => setSearchString(evt.currentTarget.value)} />
      </div>
      <div css={css`height: 30vh; overflow-y: auto; background: ${Colors.LIGHT_GRAY1};`}>
        {extensionResp.isUpdating
          ? <>
              {/* Placeholders */}
              <DatasetExtensionCardInBrowser />
              <DatasetExtensionCardInBrowser />
              <DatasetExtensionCardInBrowser />
            </>
          : extensions.map(ext =>
              <DatasetExtensionCardInBrowser
                searchString={searchString.trim().length < 3 ? undefined : searchString}
                full={extensions.length === 1 ? true : undefined}
                extension={ext}
                key={ext.title}
                selected={ext.npm.name === selectedExtension?.npm?.name ? true : undefined}
                onSelect={onSelect ? () => onSelect!(ext) : undefined} />
            )
          }
      </div>
    </div>
  );
};

const DatasetExtensionCardInBrowser:
React.FC<DatasetExtensionCardProps & { onSelect?: () => void, selected?: true }>
= function (props) {
  return (
    <Card
        interactive={props.onSelect !== undefined}
        onClick={props.onSelect}
        css={css`padding: 10px; border-radius: 0; background: ${props.selected ? Colors.LIGHT_GRAY4 : 'white'}`}>
      <DatasetExtension {...props} />
    </Card>
  )
}


export default InitializeDatasetSidebar;
