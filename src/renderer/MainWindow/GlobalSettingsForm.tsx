/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { jsx, css } from '@emotion/react';

import React, { useContext, useState } from 'react';
import { Button, Classes, Colors, H4, Icon, IconSize, InputGroup, Switch } from '@blueprintjs/core';
import { Tooltip2 } from '@blueprintjs/popover2';

import { GlobalSettingsContext } from '@riboseinc/paneron-extension-kit/SettingsContext';
import PropertyView, { TextInput, Select } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import HelpTooltip from '@riboseinc/paneron-extension-kit/widgets/HelpTooltip';
import PanelSeparator from '@riboseinc/paneron-extension-kit/widgets/panels/PanelSeparator';

import { clearDataAndRestart, ClearOption, CLEAR_OPTIONS, selectDirectoryPath } from 'common';
import { getNewRepoDefaults, setNewRepoDefaults } from 'repositories/ipc';
import type { NewRepositoryDefaults } from 'repositories/types';
import { listLocalPlugins, pluginsUpdated, removeLocalPluginPath, specifyLocalPluginPath } from 'plugins';
import DatasetExtension from 'plugins/renderer/DatasetExtensionCard';

import { Context } from './context';
import { updateSetting } from './settings';
import AuthorForm from './repositories/AuthorForm';
import { describeBundledExecutable } from 'subprocesses';


const CLEAR_OPTION_INFO: Record<ClearOption, { label: JSX.Element, description?: JSX.Element, warning?: JSX.Element }> = {
  'ui-state': {
    label: <>UI state and settings</>,
    description: <>The state of application interface (such as what’s selected and which sidebar blocks are collapsed).</>,
  },
  'db-indexes': {
    label: <>index DBs</>,
    description: <>Indexed data caches. They will be auto-rebuilt on next use.</>,
  },
  plugins: {
    label: <>extensions</>,
    description: <>Information about installed extensions, as well as extensions themselves. They will be reinstalled afterwords as you need them.</>,
  },
  //settings: {
  //  label: <>settings</>,
  //  description: <>App settings, such as author name, email, default branch, default Git username, etc.</>,
  //},
  repositories: {
    label: <>repositories <Icon iconSize={IconSize.STANDARD} icon="warning-sign" /></>,
    description: <>Information about repositories, as well as new repository defaults (e.g., author name and email), and most importantly <strong>repository data itself</strong>.</>,
    warning: <>This will clear repository configuration <strong>and all local data,</strong> but will not remove repository copies on remote Git servers (you’ll be able to re-import those afterwards). Please double-check all important changes were synchronized.</>,
  }
}


const SettingsFormSection: React.FC<{ title?: string | JSX.Element }> = function ({ title, children }) {
  return <div css={css`padding: 15px;`} className={Classes.ELEVATION_0}>
    {title
      ? <H4 css={css`font-weight: 400; font-size: 14px !important;`}>
          {title}
        </H4>
      : null}
    {children}
  </div>
}


export const GlobalSettingsForm: React.FC<{ className?: string; }> = function ({ className }) {
  const { settings, refresh: refreshSettings } = useContext(GlobalSettingsContext);
  const { performOperation, isBusy } = useContext(Context);

  const { value: { fullPath: metanormaExecPath } } =
    describeBundledExecutable.renderer!.useValue({ name: 'metanorma' }, { fullPath: '' });

  const localExtensionQuery = listLocalPlugins.renderer!.useValue({}, {});
  pluginsUpdated.renderer!.useEvent(async () => localExtensionQuery.refresh(), []);

  const [clearOptionSelection, setClearOptionSelection] =
  useState<Record<typeof CLEAR_OPTIONS[number], boolean>>({
    plugins: false,
    //settings: false,
    'db-indexes': false,
    'ui-state': false,
    repositories: false,
  });

  const canClear = Object.values(clearOptionSelection).indexOf(true) >= 0;

  async function _handleAddLocalExtension() {
    const dirResult = await selectDirectoryPath.renderer!.trigger({
      prompt: "Select development extension folder",
    });
    const directoryPath = dirResult.result.directoryPath;
    if (directoryPath && directoryPath.trim() !== '') {
      await specifyLocalPluginPath.renderer!.trigger({ directoryPath });
    } else {
      throw new Error("No directory was selected");
    }
  }

  const handleAddLocalExtension = performOperation('adding local extension', _handleAddLocalExtension);

  function handleDeleteLocalExtension(pluginName: string) {
    return performOperation('removing local extension', async () =>
      await removeLocalPluginPath.renderer!.trigger({ pluginName })
    );
  }

  async function handleClear() {
    await clearDataAndRestart.renderer!.trigger({
      options: clearOptionSelection,
    });
  }

  async function handleUpdate(key: string, value: unknown) {
    try {
      await performOperation(`writing ${key} setting`, async () => {
        await updateSetting('global', { key, value });
      })();
    } finally {
      setTimeout(refreshSettings, 1000);
    }
  }

  const localExtensions = Object.entries(localExtensionQuery.value).map(([id, ext]) => ({
    id,
    ext,
  }));

  return (
    <div className={className}>
      <SettingsFormSection title="Authoring info &amp; Git VCS defaults">
        <NewRepositoryDefaults />
      </SettingsFormSection>

      <SettingsFormSection title={<>
        Interface options
        &nbsp;
        <HelpTooltip content="Some of these settings may not have effect until next time you open a dataset." />
      </>}>
        <PropertyView label="Main navigation bar position">
          <Select
            options={[{ value: 'top', label: "Top" }, { value: 'bottom', label: "Bottom" }]}
            onChange={!isBusy
              ? (evt => handleUpdate('mainNavbarPosition', evt.currentTarget.value as 'top' | 'bottom'))
              : undefined}
            value={settings.mainNavbarPosition}
          />
        </PropertyView>
        <PropertyView label="Sidebar position">
          <Select
            options={[{ value: 'left', label: "Left" }, { value: 'right', label: "Right" }]}
            onChange={!isBusy
              ? (evt => handleUpdate('sidebarPosition', evt.currentTarget.value as 'left' | 'right'))
              : undefined}
            value={settings.sidebarPosition}
          />
        </PropertyView>
      </SettingsFormSection>

      <SettingsFormSection title={<>
          Local extensions
          &nbsp;
          <HelpTooltip content="Specify local path to an extension, which will force Paneron to use it (even if a publicly released version is available) for any dataset that requires it. The folder you specify must contain a “package.json” file." />
          &ensp;
          <Button disabled={isBusy} minimal small icon="add" onClick={handleAddLocalExtension}>
            Add…
          </Button>
        </>}>
        {localExtensions.map(({ id, ext }) =>
          <div
              key={id}
              css={css`position: relative; margin: 5px 0; background: ${Colors.LIGHT_GRAY4};`}>
            <InputGroup
              fill
              value={ext.localPath}
              css={css`input { border-radius: 0; }`}
              disabled
              rightElement={
                <Button
                  small minimal intent="danger"
                  onClick={handleDeleteLocalExtension(id)}
                  disabled={isBusy}
                  icon="cross"
                  title="Unload this local extension. The folder will remain in place, but Paneron won’t use it anymore"
                  css={css`position: absolute; top: 0; right: 0;`}
                />
              }
            />
            <div css={css`background: white; transform: scale(0.9); transform-origin: top center; padding: 5px;`}>
              <DatasetExtension extension={ext} />
            </div>
          </div>
        )}
      </SettingsFormSection>

      <SettingsFormSection title="Executables">
        <PropertyView label="Metanorma">
          <TextInput
            inputGroupProps={{ intent: metanormaExecPath.trim() === '' ? 'danger' : undefined }}
            value={metanormaExecPath || '(not found)'}
          />
        </PropertyView>
      </SettingsFormSection>

      <SettingsFormSection title="Reset (for troubleshooting)">
        <div css={css`display: flex; flex-flow: column nowrap; align-items: flex-start; margin-bottom: 5px;`}>
          {CLEAR_OPTIONS.map(opt =>
            <Tooltip2 minimal interactionKind="hover-target" position="bottom" content={<div css={css`width: 70vw`}>
                <div>{CLEAR_OPTION_INFO[opt].description}</div>
                {CLEAR_OPTION_INFO[opt].warning
                  ? <div css={css`font-weight: strong`}>{CLEAR_OPTION_INFO[opt].warning}</div>
                  : null}
            </div>}>
              <Switch
                css={css`margin: 0;`}
                labelElement={<>Clear {CLEAR_OPTION_INFO[opt].label}</>}
                checked={clearOptionSelection[opt] === true}
                disabled={isBusy}
                onChange={(evt) => setClearOptionSelection({ ...clearOptionSelection, [opt]: evt.currentTarget.checked })} />
            </Tooltip2>
          )}
        </div>

        <Button
            fill
            small
            outlined
            intent={canClear ? 'danger' : undefined}
            disabled={!canClear || isBusy}
            onClick={handleClear}>
          Clear &amp; restart
        </Button>
      </SettingsFormSection>
    </div>
  );
};


const NewRepositoryDefaults: React.FC<{ className?: string }> = function ({ className }) {
  const { performOperation, isBusy } = useContext(Context);
  const defaultsResp = getNewRepoDefaults.renderer!.useValue({}, { defaults: null });
  const defaults = defaultsResp.value.defaults;
  const busy = defaultsResp.isUpdating || isBusy;

  const [editedDefaults, setEditedDefaults] = useState<NewRepositoryDefaults | null>(null);

  function editAuthor(author: NewRepositoryDefaults["author"]) {
    setEditedDefaults({ ...maybeEditedDefaults, author });
  }

  function editRemoteUsername(val: string) {
    setEditedDefaults({ ...maybeEditedDefaults, remote: { ...maybeEditedDefaults.remote, username: val } });
  }

  function editBranch(val: string) {
    setEditedDefaults({ ...maybeEditedDefaults, branch: val });
  }

  const maybeEditedDefaults: NewRepositoryDefaults = { author: { name: '', email: '' }, ...defaults, ...editedDefaults };
  const author = maybeEditedDefaults.author;
  const nameValid = author.name.trim() !== '';
  const emailValid = author.email.trim() !== '';
  const remoteValid = defaults?.remote?.username?.trim() !== ''; // can be undefined by design
  const branchValid = (maybeEditedDefaults?.branch ?? '').trim() !== '';
  const defaultsValid = nameValid && emailValid && remoteValid && branchValid;
  const defaultsChanged = editedDefaults && JSON.stringify(editedDefaults) !== JSON.stringify(defaults ?? {});

  return (
    <div className={className}>
      <AuthorForm
        author={maybeEditedDefaults.author}
        onChange={!isBusy ? editAuthor : undefined}
      />
      <PanelSeparator />
      <PropertyView label="Remote username">
        <TextInput
          onChange={!busy ? (val) => editRemoteUsername(val) : undefined}
          value={maybeEditedDefaults.remote?.username ?? ''} />
      </PropertyView>
      <PropertyView label="Default main branch name">
        <TextInput
          onChange={!busy ? (val) => editBranch(val) : undefined}
          validationErrors={!branchValid
            ? ['Please specify a default branch name, e.g. “master” or “main”']
            : []}
          value={maybeEditedDefaults.branch ?? ''} />
      </PropertyView>
      <Button
        disabled={busy || !defaultsValid || !defaultsChanged} small fill outlined
        onClick={editedDefaults
          ? performOperation('updating repository defaults', async () => {
              await setNewRepoDefaults.renderer!.trigger(editedDefaults);
              setEditedDefaults(null);
              defaultsResp.refresh();
            })
          : undefined}>
        Update repository defaults
      </Button>
    </div>
  );
};


export default GlobalSettingsForm;
