/** @jsx jsx */
/** @jsxFrag React.Fragment */

import styled from '@emotion/styled';
import { Button as BPButton } from '@blueprintjs/core';


export const Button = styled(BPButton)`
  white-space: nowrap;

  .bp4-button-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;


/** A link with colors forced to inherit. */
export const ColorNeutralLink = styled.a`
  color: inherit !important;
  text-decoration: underline;
  text-decoration-style: dotted;
  &:link {
    color: inherit !important;
  }
  &:visited {
    color: inherit !important;
  }
  &:hover {
    color: inherit !important;
    text-decoration-style: solid;
  }
`;



