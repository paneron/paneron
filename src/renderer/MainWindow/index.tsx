/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/react';
import React, { useContext, useState } from 'react';
import { Button, Classes, Colors, Dialog, NonIdealState } from '@blueprintjs/core';

import { WindowComponentProps } from 'window/types';

import Nav from './Nav';
import ContextProvider, { Context } from './context';
import Dataset from './Dataset';
import WelcomeScreen from './WelcomeScreen';
import PaneronSettingsSidebar from './PaneronSettingsSidebar';
import { GlobalSettingsContext } from '@riboseinc/paneron-extension-kit/SettingsContext';
import { INITIAL_GLOBAL_SETTINGS } from '@riboseinc/paneron-extension-kit/settings';
import { useSettings } from './settings';


const MainWindow: React.FC<WindowComponentProps> = function () {
  return (
    <React.StrictMode>
      <ContextProvider>
        <div css={css`position: absolute; top: 0; right: 0; bottom: 0; left: 0; box-sizing: border-box; overflow: hidden;`}>
          <Nav
            css={css`position: absolute; bottom: 0; right: 0; height: ${NAV_HEIGHT_PX}px; z-index: 2;`} />
          <div
              css={css`
                position: absolute; top: 0; right: 0; left: 0; bottom: 0;
                display: flex;
                flex-flow: column nowrap;
                z-index: 1;
                overflow: hidden;
                background: ${Colors.LIGHT_GRAY2}
              `}>
            <MainView css={css`flex: 1; background: white; overflow: hidden;`} className={Classes.ELEVATION_3} />
          </div>
        </div>
      </ContextProvider>
    </React.StrictMode>
  );
};


const MainView: React.FC<{ className?: string }> = function ({ className }) {
  const { state: { view }, dispatch } = useContext(Context);

  const settings = useSettings('global', INITIAL_GLOBAL_SETTINGS);
  const settingsContext = {
    settings: settings.value.settings,
    refresh: settings.refresh,
  };
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  if (view === 'welcome-screen') {
    return <>
      <WelcomeScreen
        className={className}
        onOpenDataset={(workDir, datasetID) => dispatch({ type: 'open-dataset', workDir, datasetID })}
      />
      <Button
        large
        minimal
        icon="settings"
        css={css`position: absolute; top: 5px; right: 5px; border-radius: 0;`}
        title="Settings"
        onClick={() => setSettingsDialogOpen(true)}
      />
      <Dialog
          isOpen={settingsDialogOpen}
          title="Settings"
          onClose={() => setSettingsDialogOpen(false)}
          css={css`padding-bottom: 0;`}>
        <GlobalSettingsContext.Provider value={settingsContext}>
          <PaneronSettingsSidebar css={css`padding: 5px;`} />
        </GlobalSettingsContext.Provider>
      </Dialog>
    </>;

  } else if (view === 'dataset') {
    return <Dataset className={className} />;

  } else {
    return <NonIdealState
      title="Nothing to show"
      icon="heart-broken" />;
  }
}


const NAV_HEIGHT_PX = '24';


export default MainWindow;
