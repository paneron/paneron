/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/core';
import semver from 'semver';

import React, { useState } from 'react';

import { getPluginInfo, installPlugin, pluginsUpdated, upgradePlugin } from 'plugins';
import { Button, InputGroup, Intent, Toaster } from '@blueprintjs/core';


const toaster = Toaster.create({ position: 'bottom' });


const PluginStatusButton: React.FC<{ id: string }> =
function ({ id }) {
  const pluginInfo = getPluginInfo.renderer!.useValue({ id }, { plugin: null });
  const installedVersion = pluginInfo.value.plugin?.installedVersion;
  const currentNPMVersion = pluginInfo.value.plugin?.npm.version;
  const [customVersionToInstall, setVersionToInstall] = useState<string | undefined>(undefined);
  const versionToInstall = customVersionToInstall || currentNPMVersion;
  const [isBusy, setBusy] = useState(false);

  const wantToInstall = (
    !installedVersion ||
    installedVersion !== versionToInstall ||
    versionToInstall === undefined);

  const canInstall = (
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

  pluginsUpdated.renderer!.useEvent(async ({ changedIDs }) => {
    if (changedIDs === undefined || changedIDs.indexOf(id) >= 0) {
      pluginInfo.refresh();
    }
  }, []);

  if (!installedVersion && versionToInstall === undefined) {
    const fetchError = pluginInfo.findError('FetchError');
    if (fetchError && fetchError.message.indexOf('registry.npmjs.org') >= 0) {
      return <Button icon="offline" disabled>Cannot connect to package registry</Button>;
    } else if (pluginInfo.isUpdating) {
      return <Button loading />;
    } else {
      return <Button icon="error" disabled>Cannot find extension</Button>;
    }
  }

  let installIntent: Intent | undefined;
  let installVerb: string | undefined;
  if (canInstall) {
    if (installedVersion && versionToInstall) {
      let upgrading: boolean;
      try {
        upgrading = semver.gt(versionToInstall, installedVersion)
        installIntent = 'warning';
        if (upgrading) {
          installVerb = "Upgrade to";
        } else {
          installVerb = "Downgrade to";
        }
      } catch (e) {
        upgrading = false;
        installVerb = undefined;
        installIntent = undefined;
      }
    } else {
      installVerb = 'Install';
      installIntent = 'primary';
    }
  } else {
    installVerb = undefined;
    installIntent = undefined;
  }

  return (
    <>
      <InputGroup
        disabled
        leftIcon={installedVersion ? 'tick' : 'cross'}
        intent={installedVersion ? 'success' : undefined}
        value={installedVersion !== null ? `Installed ${installedVersion}` : 'Not installed'} />
      {wantToInstall
        ? <Button
              disabled={!canInstall}
              css={css`white-space: nowrap;`}
              loading={isBusy ?? pluginInfo.isUpdating}
              intent={installIntent}
              onClick={handleInstall}
              icon="play">
            {installVerb}
          </Button>
        : null}
      <InputGroup
        placeholder={installedVersion === currentNPMVersion
          ? 'Change version…'
          : `${currentNPMVersion} (latest)`}
        disabled={isBusy ?? pluginInfo.isUpdating}
        intent={installIntent}
        value={customVersionToInstall ?? ''}
        onChange={(evt: React.FormEvent<HTMLInputElement>) =>
          setVersionToInstall(evt.currentTarget.value)} />
    </>
  );
};


export default PluginStatusButton;
