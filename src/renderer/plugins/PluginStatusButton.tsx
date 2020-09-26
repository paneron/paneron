/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/core';

import React, { useState } from 'react';

import { getPluginInfo, installPlugin, pluginsUpdated } from 'plugins';
import { Button } from '@blueprintjs/core';


const PluginStatusButton: React.FC<{ id: string }> = function ({ id }) {
  const pluginInfo = getPluginInfo.renderer!.useValue({ id }, { id, title: id });
  const installedVersion = pluginInfo.value.installedVersion;
  const [isBusy, setBusy] = useState(false);

  async function handleInstall() {
    if (installedVersion) { return; }

    setBusy(true);
    try {
      await installPlugin.renderer!.trigger({ id });
    } finally {
      setBusy(false);
    }
  }

  pluginsUpdated.renderer!.useEvent(async ({ changedIDs }) => {
    if (changedIDs === undefined || changedIDs.indexOf(id) >= 0) {
      pluginInfo.refresh();
    }
  }, []);

  if (pluginInfo.errors.length > 0) {
    const fetchError = pluginInfo.findError('FetchError');
    if (fetchError && fetchError.message.indexOf('registry.npmjs.org') >= 0) {
      return <Button icon="offline" disabled>Cannot connect to plugin registry</Button>;
    } else {
      return <Button icon="error" disabled>Cannot find plugin</Button>;
    }
  }

  return (
    <Button
        disabled={isBusy || installedVersion !== undefined}
        loading={isBusy || pluginInfo.isUpdating}
        intent="success"
        onClick={handleInstall}
        icon={installedVersion ? 'tick-circle' : 'download'}>
      {installedVersion ? `Installed ${installedVersion}` : 'Install'}
    </Button>
  );
};


export default PluginStatusButton;
