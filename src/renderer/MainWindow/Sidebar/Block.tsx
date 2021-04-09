/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { Button, ButtonGroup, Classes, Colors } from '@blueprintjs/core';
import { jsx, css } from '@emotion/core';
import React from 'react';


export interface SidebarBlockConfig {
  key: string
  title: string | JSX.Element
  content: JSX.Element
  nonCollapsible?: boolean
  collapsedByDefault?: boolean
}


interface SidebarBlockProps {
  block: SidebarBlockConfig
  onExpand?: () => void
  onCollapse?: () => void
  expanded?: boolean
}


const SidebarBlock: React.FC<SidebarBlockProps> =
function ({ expanded, onExpand, onCollapse, block }) {
  return (
    <div
        css={css`
          display: flex; flex-flow: column nowrap; background: ${Colors.LIGHT_GRAY2};
          ${block.nonCollapsible ? 'margin: 5px;' : ''}
        `}
        className={block.nonCollapsible !== true ? Classes.ELEVATION_1 : undefined}>
      {block.nonCollapsible !== true
        ? <div
              css={css`
                height: 24px; overflow: hidden; background: linear-gradient(to top, ${Colors.LIGHT_GRAY2}, ${Colors.LIGHT_GRAY3});
                display: flex; flex-flow: row nowrap; align-items: center;
                font-variation-settings: 'GRAD' 600, 'opsz' 20;
                color: ${Colors.GRAY2};
                text-shadow: 1px 1px 1px ${Colors.LIGHT_GRAY5};
              `}>
            <div css={css`flex: 1; font-size: 90%; padding: 5px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`}>
              {block.title}
            </div>
            <ButtonGroup>
              <Button minimal disabled={!onExpand} active={expanded} icon="expand-all" onClick={onExpand} />
              <Button minimal disabled={!onExpand} active={!expanded} icon="collapse-all" onClick={onCollapse} />
            </ButtonGroup>
          </div>
        : null}
      {expanded
        ? <div css={css`
                overflow-x: hidden; overflow-y: auto;
                padding: 5px;
                box-shadow:
                  inset 1px 1px 0 white,
                  -1px -1px 0 ${Colors.GRAY4},
                  -1px 0 0 ${Colors.GRAY4},
                  0 -1px 0 ${Colors.GRAY4},
                  inset -1px -1px 0 ${Colors.GRAY4},
                  1px -1px 0 ${Colors.LIGHT_GRAY5},
                  -1px 1px 0 ${Colors.LIGHT_GRAY5},
                  1px 1px 0 ${Colors.LIGHT_GRAY5};
                background: ${Colors.LIGHT_GRAY4};
                margin: ${block.nonCollapsible ? '0' : '0 5px 5px 5px'};
                flex: 1;
                line-height: 1.4;
                font-size: 90%;
              `}>
            {block.content}
          </div>
        : null}
    </div>
  );
}


export default SidebarBlock;
