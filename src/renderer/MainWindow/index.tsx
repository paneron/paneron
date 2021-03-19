/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/core';
import React, { useContext } from 'react';
import { NonIdealState } from '@blueprintjs/core';

import { WindowComponentProps } from 'window';

import Nav from './Nav';
import RepoList from './RepoList';
import RepoSettings from './RepoSettings';
import { Context } from './context';


const MainWindow: React.FC<WindowComponentProps> = function () {
  return (
    <React.StrictMode>
      <div css={css`position: absolute; top: 0; right: 0; bottom: 0; left: 0; box-sizing: border-box;`}>
        <Nav
          css={css`position: absolute; top: 0; right: 0; left: 0; height: ${NAV_HEIGHT_PX}px`} />
        <div
            css={css`
              position: absolute; top: ${NAV_HEIGHT_PX}; right: 0; left: 0; bottom: 0;
              & > :first-child {
                position: absolute; top: 0; right: 0; left: 0; bottom: 0;
              }
            `}>
          <MainView />
        </div>
      </div>
    </React.StrictMode>
  );
};


const MainView: React.FC<Record<never, never>> = function () {
  const { state: { view } } = useContext(Context);

  if (view === 'repo-list') {
    return <RepoList />;

  } else if (view === 'repo-settings') {
    return <RepoSettings />;

  } else if (view === 'dataset') {
    return <Dataset />;

  } else {
    return <NonIdealState
      title="Nothing to show"
      icon="heart-broken" />;
  }
}


const NAV_HEIGHT_PX = '80';


export default MainWindow;
