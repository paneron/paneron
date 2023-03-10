/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/react';
import React, { useContext, useState } from 'react';
import { Button, ButtonProps, Classes, Colors, Dialog, Spinner, NonIdealState } from '@blueprintjs/core';
import { GlobalSettingsContext } from '@riboseinc/paneron-extension-kit/SettingsContext';
import { INITIAL_GLOBAL_SETTINGS } from '@riboseinc/paneron-extension-kit/settings';

import { getAppVersion, refreshMainWindow, showGlobalSettings } from 'common';
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
  const {
    isUpdating: versionIsUpdating,
    value: { version, isPackaged },
  } = getAppVersion.renderer!.useValue({}, { version: '' });

  showGlobalSettings.renderer!.useEvent(async () => {
    setSettingsDialogOpen(true);
  }, []);

  const Frag = isPackaged ? React.Fragment : React.StrictMode;

  if (versionIsUpdating) {
    return <Spinner className="initial-spinner" />;
  }

  return (
    <Frag>
      <ContextProvider>
        <div css={css`position: absolute; inset: 0; box-sizing: border-box; overflow: hidden;`}>
          <div
              css={css`
                position: absolute; right: 0; left: 0;
                ${globalSettingsContext.settings.mainNavbarPosition === 'bottom'
                  ? `bottom: ${NAV_HEIGHT_PX}px; top: 0;`
                  : `top: ${NAV_HEIGHT_PX}px; bottom: 0;`}
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
                <GlobalSettingsForm css={css`overflow-y: auto;`} />
              </GlobalSettingsContext.Provider>
            </Dialog>
          </div>
          <Nav
              anchor={globalSettingsContext.settings.mainNavbarPosition === 'top' ? 'start' : 'end'}
              className={globalSettingsContext.settings.mainNavbarPosition === 'bottom' ? Classes.ELEVATION_2 : Classes.ELEVATION_1}
              css={css`
                position: absolute;
                ${globalSettingsContext.settings.mainNavbarPosition === 'bottom'
                  ? 'bottom: 0'
                  : 'top: 0'};
                right: -15px; left: -15px;
                height: ${NAV_HEIGHT_PX}px;
                z-index: 2;`}>
            <NavbarButton
              title="Host application version"
              text={isPackaged ? `v${version}` : 'DEV'}
              disabled
            />
            <NavbarButton
              icon="refresh"
              title="Refresh window"
              onClick={() => refreshMainWindow.renderer!.trigger({})}
            />
            <NavbarButton
              icon="settings"
              title="Settings"
              active={settingsDialogOpen}
              onClick={() => setSettingsDialogOpen(true)}
            />
          </Nav>
        </div>
      </ContextProvider>
    </Frag>
  );
};


const NavbarButton: React.FC<ButtonProps & { title?: string }> = function (props) {
  return <Button
    small
    minimal
    css={css`
      transform: skew(45deg);
      border-radius: 0;
      .bp4-icon {
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
