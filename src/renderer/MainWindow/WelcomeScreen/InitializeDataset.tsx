/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/react';
import React, { useMemo, useCallback, useContext, useState } from 'react';
import { Card, Button, Colors, InputGroup, Classes } from '@blueprintjs/core';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import type { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import OperationQueueContext from '@riboseinc/paneron-extension-kit/widgets/OperationQueue/context';

import { listAvailablePlugins } from 'plugins';
import type { Extension } from 'plugins/types';
import DatasetExtension, { type DatasetExtensionCardProps } from 'plugins/renderer/DatasetExtensionCard';
import { loadRepository } from 'repositories/ipc';
import { initializeDataset, proposeDatasetPath } from 'datasets/ipc';
import getPlugin from 'plugins/renderer/getPlugin';
import { getBasicReadAPI } from 'datasets/renderer/context';


const InitializeDataset: React.FC<{ workDir: string }> =
function ({ workDir }) {
  const { performOperation, isBusy } = useContext(OperationQueueContext);

  const [selectedExtension, selectExtension] = useState<Extension | null>(null);

  const [datasetID, setDatasetID] = useState<string>('');
  const [title, setTitle] = useState<string>('');

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

      const initialBufferDataset: BufferDataset = {};

      const plugin = await getPlugin(selectedExtension.npm.name, selectedExtension.npm.version);
      if (typeof plugin.initialMigration?.migrator === 'function') {
        const { migrator } = plugin.initialMigration;
        for await (const buf of migrator(getBasicReadAPI({ workingCopyPath: workDir, datasetID }))) {
          Object.assign(initialBufferDataset, buf);
        }
      }

      await initializeDataset.renderer!.trigger({
        workingCopyPath: workDir,
        meta: {
          title,
          type: {
            id: selectedExtension.npm.name,
            version: selectedExtension.npm.version,
          },
        },
        initialBufferDataset,
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
            validationErrors={title.trim() === ''
              ? ["Short descriptive human-readable title for the new dataset."]
              : []} />
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

const DatasetExtensionBrowser: React.FC<{
  onSelect?: (extension: Extension) => void
  selectedExtension?: Extension
  className?: string
}> = React.memo(function ({ selectedExtension, onSelect, className }) {
  const [searchString, setSearchString] = useState('');
  const searchStringNormalized = searchString.toLowerCase().trim();

  const extensionResp = listAvailablePlugins.renderer!.useValue({}, { extensions: [] });

  const extensionsToShow = useMemo(() => {
    return extensionResp.value.extensions.filter(ext => {
      const str = searchStringNormalized;
      if (str.length < 3) {
        // Show featured extensions if no search string is provided
        return ext.featured;
      } else {
        // If a search string is provided, show matching extensions
        return (
          ext.title.toLowerCase().indexOf(str) >= 0 ||
          ext.description.toLowerCase().indexOf(str) >= 0 ||
          ext.author.toLowerCase().indexOf(str) >= 0 ||
          ext.npm.name.toLowerCase().indexOf(str) >= 0);
      }
    });
  }, [searchStringNormalized, extensionResp.value.extensions]);

  const extensionList: JSX.Element | JSX.Element[] = useMemo(() => {
    return extensionResp.isUpdating
      ? <>
          {/* Placeholders */}
          <DatasetExtensionCardInBrowser />
          <DatasetExtensionCardInBrowser />
          <DatasetExtensionCardInBrowser />
        </>
      : extensionsToShow.map(ext =>
          <DatasetExtensionCardInBrowser
            searchString={searchString.trim().length < 3 ? undefined : searchString}
            full={extensionsToShow.length === 1 ? true : undefined}
            extension={ext}
            key={ext.title}
            selected={ext.npm.name === selectedExtension?.npm?.name || undefined}
            onSelect={onSelect ?? undefined}
          />
        )
  }, [extensionResp.isUpdating, extensionsToShow, selectedExtension, searchString, onSelect]);

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
            <Button
              minimal
              disabled={searchStringNormalized === ''}
              onClick={() => setSearchString('')}
              icon="cross"
            />
          }
          value={searchString}
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            setSearchString(evt.currentTarget.value)}
        />
      </div>
      <div css={css`
        flex: 1;
        overflow-y: auto;
        background: ${Colors.LIGHT_GRAY1};
        .bp4-dark & {
          background: ${Colors.DARK_GRAY2};
        }
      `}>
        {extensionList}
      </div>
    </div>
  );
});

const DatasetExtensionCardInBrowser: React.FC<DatasetExtensionCardProps & {
  onSelect?: (ext: Extension) => void
  selected?: true
}> = React.memo(function (props) {
  const handleClick = useCallback(() => {
    if (props.onSelect && props.extension) {
      return props.onSelect(props.extension);
    }
  }, [props.extension, props.onSelect]);
  return (
    <Card
        interactive={props.onSelect !== undefined}
        onClick={handleClick}
        css={css`
          padding: 10px;
          border-radius: 0;
          background: ${props.selected ? Colors.LIGHT_GRAY4 : Colors.WHITE};
          .bp4-dark & {
            background: ${props.selected ? Colors.DARK_GRAY4 : Colors.BLACK};
          }
        `}>
      <DatasetExtension {...props} />
    </Card>
  );
});


export default InitializeDataset;
