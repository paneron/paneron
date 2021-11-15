/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/react';

import React, { useContext, useState } from 'react';
import { Card, Button, Colors, InputGroup, Classes } from '@blueprintjs/core';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import { listAvailablePlugins } from 'plugins';
import { Extension } from 'plugins/types';
import DatasetExtension, { DatasetExtensionCardProps } from 'plugins/renderer/DatasetExtensionCard';
import { loadRepository, describeRepository, repositoriesChanged, Repository } from 'repositories/ipc';
import { initializeDataset, proposeDatasetPath } from 'datasets/ipc';
import { Context } from '../context';


const InitializeDataset: React.FC<{ workDir: string; repoInfo?: Repository; className?: string; }> = function ({ workDir, repoInfo, className }) {
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
      await loadRepository.renderer!.trigger({
        workingCopyPath: workDir,
      });
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

  return (
    <>
      <DatasetExtensionBrowser
        css={css`flex: 1;`}
        onSelect={selectExtension}
        selectedExtension={selectedExtension ?? undefined}
      />
      <div css={css`padding: 5px; z-index: 2;`} className={Classes.ELEVATION_2}>
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
        <Button fill
          disabled={!canInitialize || isBusy}
          intent={canInitialize ? 'primary' : undefined}
          onClick={canInitialize
            ? performOperation('initializing dataset', _initializeDataset)
            : undefined}>
          Initialize {selectedExtension?.title} dataset
        </Button>
      </div>
    </>
  );
};

const DatasetExtensionBrowser: React.FC<{ onSelect?: (extension: Extension) => void, selectedExtension?: Extension, className?: string }> =
function ({ selectedExtension, onSelect, className }) {
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
    <div className={className} css={css`
        display: flex;
        flex-flow: column nowrap;
        overflow: hidden;
      `}>
      <div css={css`padding: 5px; z-index: 1;`} className={Classes.ELEVATION_1}>
        <InputGroup
          fill
          leftIcon="search"
          placeholder="Search extensions…"
          rightElement={
            <Button minimal disabled={searchString.trim() === ''} onClick={() => setSearchString('')} icon="cross" />
          }
          value={searchString}
          onChange={(evt: React.FormEvent<HTMLInputElement>) => setSearchString(evt.currentTarget.value)} />
      </div>
      <div css={css`flex: 1; overflow-y: auto; background: ${Colors.LIGHT_GRAY1};`}>
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


export default InitializeDataset;
