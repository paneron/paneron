/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { Button, ButtonGroup, Classes, Colors } from '@blueprintjs/core';
import { jsx, css } from '@emotion/core';
import React from 'react';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import SidebarBlock, { SidebarBlockConfig } from './Block';


interface State {
  blockState: { [blockTitle: string]: boolean } 
}

type Action =
  | { type: 'expand-all' | 'collapse-all' | 'reset-state' }
  | { type: 'collapse-one' | 'expand-one', payload: { blockKey: string } };

interface SidebarProps {
  stateKey: string
  title: string | JSX.Element
  blocks: SidebarBlockConfig[]

  representsSelection?: boolean
  /* Indicate via styling that sidebar is displaying details for a selected item. */

  className?: string 
}

const Sidebar: React.FC<SidebarProps> =
function ({ title, stateKey, blocks, representsSelection, className }) {
  const [state, dispatch, stateLoaded] = usePaneronPersistentStateReducer<State, Action>(
    (prevState, action) => {
      switch (action.type) {
        case 'expand-all':
          return { blockState: blocks.map(b => ({ [b.key]: true })).reduce((prev, curr) => ({ ...prev, ...curr })) };
        case 'collapse-all':
          return { blockState: blocks.map(b => ({ [b.key]: false })).reduce((prev, curr) => ({ ...prev, ...curr })) };
        case 'reset-state':
          return { blockState: blocks.
            map(b => ({ [b.key]: b.collapsedByDefault === true ? false : true })).
            reduce((prev, curr) => ({ ...prev, ...curr })) };
        case 'expand-one':
          return { blockState: { ...prevState.blockState, [action.payload.blockKey]: true } };
        case 'collapse-one':
          return { blockState: { ...prevState.blockState, [action.payload.blockKey]: false } };
        default:
          throw new Error("Unexpected sidebar state");
      }
    }, {
      blockState:
        blocks.
          map(b => ({ [b.key]: b.collapsedByDefault === true ? false : true })).
          reduce((prev, curr) => ({ ...prev, ...curr })),
    }, null, stateKey);

  return (
    <div css={css`display: flex; flex-flow: column nowrap;`} className={className}>
      <div
          css={css`
            height: 24px; background: ${representsSelection ? Colors.BLUE2 : Colors.GRAY1};
            color: white; display: flex; flex-flow: row nowrap; align-items: center;
            overflow: hidden; z-index: 1;
            font-variation-settings: 'GRAD' 500;
          `}
          className={Classes.ELEVATION_1}>

        <div css={css`flex: 1; padding: 5px 10px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`}>
          {title}
        </div>

        <ButtonGroup css={css`background: rgba(255, 255, 255, 0.6)`}>
          <Button minimal title="Restore default collapsed state" icon="reset" onClick={() => dispatch({ type: 'reset-state' })} />
          <Button minimal title="Expand all" icon="expand-all" onClick={() => dispatch({ type: 'expand-all' }) } />
          <Button minimal title="Collapse all" icon="collapse-all" onClick={() => dispatch({ type: 'collapse-all' })} />
        </ButtonGroup>
      </div>
      <div css={css`flex: 1; overflow-x: hidden; overflow-y: auto; background: ${Colors.LIGHT_GRAY1};`}>
      {stateLoaded
        ? <>
            {blocks.map((b, idx) =>
              <SidebarBlock
                key={idx}
                expanded={state.blockState[b.key]}
                block={b}
                onCollapse={() => dispatch({ type: 'collapse-one', payload: { blockKey: b.key } })}
                onExpand={() => dispatch({ type: 'expand-one', payload: { blockKey: b.key } })}
              />
            )}
            <div css={css`font-size: 40px; text-align: center; color: ${Colors.LIGHT_GRAY4}`}>— ❧ —</div>
          </>
        : null}
      </div>
    </div>
  );
}


export default Sidebar;
