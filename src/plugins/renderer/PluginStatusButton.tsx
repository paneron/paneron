/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/react';

import React, { useState } from 'react';

import { getPluginInfo, installPlugin, pluginsUpdated, removePlugin, upgradePlugin } from 'plugins';
import { Button, InputGroup, Toaster } from '@blueprintjs/core';


const toaster = Toaster.create({ position: 'bottom' });

const DEV_VERSION = '0.0.0';


const PluginStatusButton: React.FC<{ id: string }> =
function ({ id }) {
  const pluginInfo = getPluginInfo.renderer!.useValue({ id }, { plugin: null });
  const installedVersion = pluginInfo.value.plugin?.installedVersion;
  const availableVersion = pluginInfo.value.plugin?.npm.version ?? DEV_VERSION;
  const [customVersionToInstall, setVersionToInstall] = useState<string | undefined>(undefined);
  const versionToInstall = customVersionToInstall || availableVersion;
  const isDev = installedVersion === DEV_VERSION && availableVersion === DEV_VERSION;
  const [isBusy, setBusy] = useState(false);

  const wantToInstall = (
    !installedVersion ||
    installedVersion !== versionToInstall ||
    versionToInstall === undefined);

  const wantToUninstall = (
    installedVersion &&
    !customVersionToInstall);

  const canInstall = (
    !isDev &&
    !isBusy &&
    !pluginInfo.isUpdating &&
    installedVersion !== versionToInstall &&
    versionToInstall !== undefined);

  async function handleInstall() {
    if (installedVersion && installedVersion === versionToInstall) { return; }
    if (!versionToInstall) { return; }

    setBusy(true);
    try {
      if (!installedVersion) {
        await installPlugin.renderer!.trigger({ id, version: versionToInstall });
      } else {
        await upgradePlugin.renderer!.trigger({ id, version: versionToInstall });
      }
      toaster.show({
        icon: 'tick-circle',
        intent: 'success',
        timeout: 4000,
        message: `Installed or upgraded extension ${pluginInfo.value.plugin?.title}@${versionToInstall}`,
      });
    } catch (e) {
      toaster.show({
        icon: 'heart-broken',
        intent: 'danger',
        timeout: 6000,
        message: `Failed to install extension ${pluginInfo.value.plugin?.title}@${versionToInstall}`,
      });
    } finally {
      setVersionToInstall(undefined);
      setBusy(false);
    }
  }

  async function handleUninstall() {
    setBusy(true);
    const extName = pluginInfo.value.plugin?.title;
    if (!extName) {
      toaster.show({
        icon: 'heart-broken',
        intent: 'danger',
        message: "Failed to uninstall extension: extension info is missing",
      });
    }
    try {
      await removePlugin.renderer!.trigger({ id });
      toaster.show({
        icon: 'tick-circle',
        intent: 'success',
        timeout: 4000,
        message: `Removed extension ${extName}`,
      });
    } catch (e) {
      toaster.show({
        icon: 'heart-broken',
        intent: 'danger',
        message: `Failed to uninstall extension: ${e}`,
      });
    } finally {
      setVersionToInstall(undefined);
      setBusy(false);
    }
  }

  pluginsUpdated.renderer!.useEvent(async ({ changedIDs }) => {
    if (changedIDs === undefined || changedIDs.indexOf(id) >= 0) {
      pluginInfo.refresh();
    }
  }, []);

  if (!installedVersion && versionToInstall === undefined) {
    const fetchError = pluginInfo.errors.find(err => err.indexOf('FetchError') >= 0);
    if (fetchError && fetchError.indexOf('registry.npmjs.org') >= 0) {
      return <Button icon="offline" disabled>Cannot connect to package registry</Button>;
    } else if (pluginInfo.isUpdating) {
      return <Button loading />;
    } else {
      return <Button icon="error" disabled>Cannot find extension</Button>;
    }
  }

  return (
    <>
      <InputGroup
        disabled
        leftIcon={installedVersion ? 'tick' : 'cross'}
        intent={installedVersion ? 'success' : undefined}
        value={installedVersion !== null ? `Installed ${installedVersion ?? 'N/A'}` : 'Not installed'} />
      {wantToInstall || wantToUninstall
        ? <Button
              disabled={!canInstall && !wantToUninstall}
              loading={isBusy || pluginInfo.isUpdating}
              intent={wantToInstall ? 'primary' : 'danger'}
              onClick={wantToInstall ? handleInstall : handleUninstall}
              icon={wantToInstall ? 'play' : 'cross'}>
            {wantToInstall
              ? installedVersion
                ? `Update to`
                : `Install`
              : `Uninstall`}
          </Button>
        : null}
      <InputGroup
        placeholder={installedVersion === availableVersion
          ? 'Change version…'
          : `${availableVersion} (latest)`}
        disabled={isBusy || pluginInfo.isUpdating}
        intent={wantToInstall ? 'primary' : undefined}
        value={customVersionToInstall || ''}
        onChange={(evt: React.FormEvent<HTMLInputElement>) =>
          setVersionToInstall(evt.currentTarget.value)} />
    </>
  );
};


export default PluginStatusButton;
