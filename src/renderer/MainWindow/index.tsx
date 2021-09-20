/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/react';
import React, { useContext, useState } from 'react';
import { Button, ButtonProps, Classes, Colors, Dialog, NonIdealState } from '@blueprintjs/core';
import { GlobalSettingsContext } from '@riboseinc/paneron-extension-kit/SettingsContext';
import { INITIAL_GLOBAL_SETTINGS } from '@riboseinc/paneron-extension-kit/settings';

import { WindowComponentProps } from 'window/types';
import { useSettings } from './settings';

import Nav from './Nav';
import ContextProvider, { Context } from './context';
import Dataset from './Dataset';
import WelcomeScreen from './WelcomeScreen';
import GlobalSettingsForm from './GlobalSettingsForm';


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
              css={css`position: absolute; bottom: 0; right: -15px; left: -15px; height: ${NAV_HEIGHT_PX}px; z-index: 2;`}>
              small
              minimal
            <NavbarButton
              icon="settings"
              title="Settings"
              active={settingsDialogOpen}
              onClick={() => setSettingsDialogOpen(true)}
            />
          </Nav>
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
            <Dialog
                isOpen={settingsDialogOpen}
                title="Settings"
                usePortal={false}
                onClose={() => setSettingsDialogOpen(false)}
                css={css`padding-bottom: 0; height: 70vh; width: 70vw;`}>
              <GlobalSettingsContext.Provider value={globalSettingsContext}>
                <GlobalSettingsForm css={css`padding: 5px;`} />
              </GlobalSettingsContext.Provider>
            </Dialog>
          </div>
        </div>
      </ContextProvider>
    </React.StrictMode>
  );
};


const NavbarButton: React.FC<ButtonProps & { title?: string }> = function (props) {
  return <Button
    small
    minimal
    css={css`
      transform: skew(45deg);
      border-radius: 0;
      .bp3-icon {
        transform: scale(0.7);
      }
    `}
    {...props}
  />;
}


const MainView: React.FC<{ className?: string }> = function ({ className }) {
  const { state: { view }, dispatch } = useContext(Context);

  if (view === 'welcome-screen') {
    return <WelcomeScreen
      className={className}
      css={css`position: absolute; inset: 0; margin: auto; height: 70vh; width: 70vw;`}
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
