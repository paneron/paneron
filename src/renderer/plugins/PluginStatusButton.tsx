/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/core';

import React, { useState } from 'react';

import { getPluginInfo, installPlugin, pluginsUpdated, upgradePlugin } from 'plugins';
import { Button, ButtonGroup } from '@blueprintjs/core';


const PluginStatusButton: React.FC<{ id: string }> = function ({ id }) {
  const pluginInfo = getPluginInfo.renderer!.useValue({ id }, { id, title: id });
  const installedVersion = pluginInfo.value.installedVersion;
  const latestVersion = pluginInfo.value.latestVersion;
  const [isBusy, setBusy] = useState(false);

  async function handleInstall() {
    if (installedVersion !== undefined && installedVersion === latestVersion) { return; }

    setBusy(true);
    try {
      if (installedVersion === undefined) {
        await installPlugin.renderer!.trigger({ id });
      } else {
        await upgradePlugin.renderer!.trigger({ id });
      }
    } finally {
      setBusy(false);
    }
  }

  pluginsUpdated.renderer!.useEvent(async ({ changedIDs }) => {
    if (changedIDs === undefined || changedIDs.indexOf(id) >= 0) {
      pluginInfo.refresh();
    }
  }, []);

  if (installedVersion === undefined && latestVersion === undefined) {
    const fetchError = pluginInfo.findError('FetchError');
    if (fetchError && fetchError.message.indexOf('registry.npmjs.org') >= 0) {
      return <Button icon="offline" disabled>Cannot connect to package registry</Button>;
    } else if (pluginInfo.isUpdating) {
      return <Button loading />;
    } else {
      return <Button icon="error" disabled>Cannot find extension</Button>;
    }
  }

  return (
    <ButtonGroup>
      <Button
          disabled={isBusy || pluginInfo.isUpdating || installedVersion === latestVersion || latestVersion === undefined}
          loading={isBusy || pluginInfo.isUpdating}
          intent="success"
          onClick={handleInstall}
          icon={installedVersion ? 'tick-circle' : 'download'}>
        {installedVersion !== undefined
          ? (installedVersion === latestVersion || latestVersion === undefined)
            ? `Installed ${installedVersion}`
            : `Upgrade from ${installedVersion} to ${latestVersion}`
          : `Install ${latestVersion}`}
      </Button>
    </ButtonGroup>
  );
};


export default PluginStatusButton;
