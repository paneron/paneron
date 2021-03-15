/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/core';
import React from 'react';
import { IconName } from '@blueprintjs/core';


export interface NavBreadcrumb {
  icon?: IconName
  title: string | JSX.Element
  onClose?: () => void
  onNavigate?: () => void
}

export interface NavProps {
  breadcrumbs: NavBreadcrumb[]
}

const Nav: React.FC<NavProps> = function ({ breadcrumbs }) {
  return <p>Nav</p>;
};


export default Nav;
