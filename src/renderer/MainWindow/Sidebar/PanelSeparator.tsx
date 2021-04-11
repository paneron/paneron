/** @jsx jsx */

import { jsx, css } from '@emotion/core';
import React from 'react';
import { Colors } from '@blueprintjs/core';


export const PanelSeparator: React.FC<Record<never, never>> = function () {
  return <hr css={css`border-color: ${Colors.LIGHT_GRAY5}`} />;
};


export default PanelSeparator;
