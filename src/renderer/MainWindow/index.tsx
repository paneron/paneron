/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/react';
import React, { useContext, useState } from 'react';
import { Classes, Colors, Dialog, NonIdealState } from '@blueprintjs/core';

import { WindowComponentProps } from 'window/types';

import Nav from './Nav';
import ContextProvider, { Context } from './context';
import Dataset from './Dataset';
import WelcomeScreen from './WelcomeScreen';
import GlobalSettingsForm from './GlobalSettingsForm';
import { GlobalSettingsContext } from '@riboseinc/paneron-extension-kit/SettingsContext';
import { INITIAL_GLOBAL_SETTINGS } from '@riboseinc/paneron-extension-kit/settings';
import { useSettings } from './settings';


const MainWindow: React.FC<WindowComponentProps> = function () {
  const globalSettings = useSettings('global', INITIAL_GLOBAL_SETTINGS);
  const globalSettingsContext = {
    settings: globalSettings.value.settings,
    refresh: globalSettings.refresh,
  };
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  return (
    <React.StrictMode>
      <ContextProvider>
        <div css={css`position: absolute; top: 0; right: 0; bottom: 0; left: 0; box-sizing: border-box; overflow: hidden;`}>
          <Nav
            onOpenSettings={() => setSettingsDialogOpen(true)}
            css={css`position: absolute; bottom: 0; right: -15px; left: -15px; height: ${NAV_HEIGHT_PX}px; z-index: 2;`} />
          <div
              css={css`
                position: absolute; top: 0; right: 0; left: 0; bottom: ${NAV_HEIGHT_PX}px;
                display: flex;
                flex-flow: column nowrap;
                z-index: 1;
                overflow: hidden;
                background: ${Colors.LIGHT_GRAY2}
              `}>
            <MainView
              css={css`flex: 1; background: white; overflow: hidden;`}
              className={Classes.ELEVATION_3}
            />
          </div>
          <Dialog
              isOpen={settingsDialogOpen}
              title="Settings"
              onClose={() => setSettingsDialogOpen(false)}
              css={css`padding-bottom: 0;`}>
            <GlobalSettingsContext.Provider value={globalSettingsContext}>
              <GlobalSettingsForm css={css`padding: 5px;`} />
            </GlobalSettingsContext.Provider>
          </Dialog>
        </div>
      </ContextProvider>
    </React.StrictMode>
  );
};


const MainView: React.FC<{ className?: string }> = function ({ className }) {
  const { state: { view }, dispatch } = useContext(Context);

  if (view === 'welcome-screen') {
    return <WelcomeScreen
      className={className}
      onOpenDataset={(workDir, datasetID) => dispatch({ type: 'open-dataset', workDir, datasetID })}
    />;

  } else if (view === 'dataset') {
    return <Dataset className={className} />;

  } else {
    return <NonIdealState
      title="Unknown view"
      icon="heart-broken"
      description="Please try refreshing the window."
    />;
  }
}


const NAV_HEIGHT_PX = '24';


export default MainWindow;
