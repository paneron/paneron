/** @jsx jsx */

import { jsx, css } from '@emotion/core';
import React, { useContext } from 'react';
import { Classes, NonIdealState } from '@blueprintjs/core';

import { WindowComponentProps } from 'window/types';

import Nav from './Nav';
import RepoList from './RepoList';
import RepoSettings from './RepoSettings';
import ContextProvider, { Context } from './context';
import Dataset from './Dataset';


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
              `}>
            <MainView css={css`flex: 1; background: white;`} className={Classes.ELEVATION_3} />
          </div>
        </div>
      </ContextProvider>
    </React.StrictMode>
  );
};


const MainView: React.FC<{ className?: string }> = function ({ className }) {
  const { state: { view } } = useContext(Context);

  if (view === 'repo-list') {
    return <RepoList className={className} />;

  } else if (view === 'repo-settings') {
    return <RepoSettings className={className} />;

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
