/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { css, jsx } from '@emotion/react';
import React, { useState } from 'react';
import { Popover2 } from '@blueprintjs/popover2';
import { ButtonProps, Callout, FormGroup, Intent } from '@blueprintjs/core';
import { Button } from '../widgets';


const ButtonWithPrompt: React.FC<ButtonProps & { promptIntent: Intent; promptMessage: JSX.Element | string; }> = function (props) {
  const { promptIntent, promptMessage, ...buttonProps } = props;
  const [promptIsOpen, setPromptIsOpen] = useState(false);
  return (
    <Popover2
      isOpen={promptIsOpen}
      onClose={() => setPromptIsOpen(false)}
      usePortal={false}
      minimal
      content={<div css={css`padding: 10px 15px;`}>
        <FormGroup label="Are you sure?" helperText={<Callout intent={promptIntent}>
          {promptMessage}
        </Callout>}>
          <Button
            text={buttonProps.text}
            intent={promptIntent}
            onClick={buttonProps.onClick}>
            {buttonProps.children}
          </Button>
        </FormGroup>
      </div>}>
      <Button {...buttonProps} onClick={() => setPromptIsOpen(true)} />
    </Popover2>
  );
};


export default ButtonWithPrompt;
