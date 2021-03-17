/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/core';
import React from 'react';
import { IconName } from '@blueprintjs/core';


export interface NavBreadcrumb {
  icon?: { blueprintIconName: IconName } | { fileName: string }
  title: string | JSX.Element
  onClose?: () => void
  onNavigate?: () => void
}


export interface NavProps {
  breadcrumbs: NavBreadcrumb[]
}


const Nav: React.FC<NavProps> = function ({ breadcrumbs }) {
  return (
    <div css={css`display: flex; flex-flow: row nowrap; align-items: center;`}>
      {breadcrumbs.map((bc, idx) =>
        <Breadcrumb
          key={idx}
          {...bc}
          isCurrent={idx === breadcrumbs.length - 1}
        />
      )}
    </div>
  );
};


const Breadcrumb: React.FC<NavBreadcrumb & { isCurrent: boolean }> =
function ({ icon, title, onClose, onNavigate, isCurrent }) {
  return (
    <div css={css`${isCurrent ? 'font-weight: bold' : ''}`}>
      {title}
    </div>
  );
}


export default Nav;
