/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { Colors } from '@blueprintjs/core';
import { jsx, css } from '@emotion/core';
import React from 'react';


const WithStatusBar: React.FC<{ statusBar: JSX.Element, className?: string }> =
function ({ statusBar, className, children }) {
  return (
    <div css={css`display: flex; flex-flow: column nowrap; & > :first-child { flex: 1 1 auto; }`} className={className}>
      {children}
      <div css={css`display: flex; margin-top: 2px; flex-flow: row nowrap; align-items: center; white-space: nowrap; padding: 5px 10px; font-size: 80%; background: ${Colors.LIGHT_GRAY3}; color: ${Colors.GRAY1}`}>
        {statusBar}
      </div>
    </div>
  );
}


export default WithStatusBar;
