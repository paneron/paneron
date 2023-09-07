/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/react';
import React, { useContext } from 'react';
import { Button, ButtonProps, Classes, Colors, NonIdealState } from '@blueprintjs/core';
import { GlobalSettingsContext } from '@riboseinc/paneron-extension-kit/SettingsContext';
import { INITIAL_GLOBAL_SETTINGS } from '@riboseinc/paneron-extension-kit/settings';

import { getAppVersion, refreshMainWindow } from 'common';
import { useSettings } from './settings';

import Nav from './Nav';
import ContextProvider, { Context } from './context';
import Dataset from './Dataset';
import WelcomeScreen from './WelcomeScreen';
import GlobalSettingsForm from './GlobalSettingsForm';


const MainWindow: React.FC<Record<never, never>> = function () {
  const { value: { settings: { mainNavbarPosition } } } =
    useSettings('global', INITIAL_GLOBAL_SETTINGS);

  const { value: { version, isPackaged } } =
    getAppVersion.renderer!.useValue({}, { version: '' });

  const Frag = isPackaged ? React.Fragment : React.StrictMode;

  return (
    <Frag>
      <ContextProvider>
        <div css={css`position: absolute; inset: 0; box-sizing: border-box; overflow: hidden;`}>
          <div
              css={css`
                position: absolute; right: 0; left: 0;
                ${mainNavbarPosition === 'bottom'
                  ? `bottom: ${NAV_HEIGHT_PX}px; top: 0;`
                  : `top: ${NAV_HEIGHT_PX}px; bottom: 0;`}
                display: flex;
                flex-flow: column nowrap;
                z-index: 1;
                overflow: hidden;
                background: ${Colors.LIGHT_GRAY2};
                .bp4-dark & {
                  background: ${Colors.DARK_GRAY2};
                }
              `}>
            <MainView
              css={css`
                flex: 1;
                overflow: hidden;
                background: ${Colors.WHITE};
                .bp4-dark & {
                  background: ${Colors.DARK_GRAY1};
                }
              `}
              className={Classes.ELEVATION_3}
            />
          </div>
          <Navbar
            mainNavbarPosition={mainNavbarPosition}
            isPackaged={isPackaged}
            version={version}
          />
        </div>
      </ContextProvider>
    </Frag>
  );
};


const Navbar: React.FC<{ version: string, isPackaged?: boolean, mainNavbarPosition: 'top' | 'bottom' }> =
function ({ version, isPackaged, mainNavbarPosition }) {
  const { state: { view }, dispatch } = useContext(Context);
  return (
    <Nav
        anchor={mainNavbarPosition === 'top'
          ? 'start'
          : 'end'}
        className={mainNavbarPosition === 'bottom'
          ? Classes.ELEVATION_2
          : Classes.ELEVATION_1}
        css={css`
          position: absolute;
          ${mainNavbarPosition === 'bottom'
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
        active={view === 'settings'}
        onClick={() => dispatch({ type: view === 'settings' ? 'close-settings' : 'open-settings' })}
      />
    </Nav>
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
  const globalSettings = useSettings('global', INITIAL_GLOBAL_SETTINGS);
  const globalSettingsContext = {
    settings: globalSettings.value.settings,
    refresh: globalSettings.refresh,
  };
  const { state, dispatch } = useContext(Context);

  if (state.view === 'welcome-screen') {
    return <WelcomeScreen
      className={className}
      css={css`position: absolute; inset: 0; margin: auto; height: 70vh; width: 70vw;`}
      onOpenDataset={(workDir, datasetID) => dispatch({ type: 'open-dataset', workDir, datasetID })}
      onExportDataset={(workDir, datasetID) => dispatch({ type: 'export-dataset', workDir, datasetID })}
    />;

  } else if (state.view === 'dataset') {
    return <Dataset className={className} showExportOptions={state.export ? true : undefined} />;


  } else if (state.view === 'settings') {
    return (
      <GlobalSettingsContext.Provider value={globalSettingsContext}>
        <GlobalSettingsForm className={className} css={css`overflow-y: auto !important; display: flex; flex-flow: column nowrap;`} />
      </GlobalSettingsContext.Provider>
    );
    //return <Dataset className={className} showExportOptions />;

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
