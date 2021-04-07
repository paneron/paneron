/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { Colors, Icon, IInputGroupProps2, InputGroup, UL } from '@blueprintjs/core';
import { Tooltip2 } from '@blueprintjs/popover2';
import { jsx, css } from '@emotion/core';
import React from 'react';


interface PropertyViewProps {
  label: JSX.Element | string
  title?: string
  tooltip?: JSX.Element | string
  className?: string 
}
const PropertyView: React.FC<PropertyViewProps> = function ({ label, title, tooltip, className, children }) {
  return (
    <div
        className={className}
        title={title}
        css={css`display: flex; flex-flow: row nowrap; align-items: flex-start; font-size: 11px; margin-bottom: 5px;`}>
      <div css={css`
            width: 40%;
            padding-right: 10px;
            text-align: right;
            padding-top: 2px;
            padding-bottom: 2px;
            white-space: nowrap;
            color: ${Colors.GRAY1};
          `}>
        {tooltip ? <Tooltip2 content={tooltip}>{label}</Tooltip2> : label}
      </div>
      <div css={css`
            width: 60%;
            word-break: break-all;
            line-height: 1.2;
            padding-top: 2px;
            padding-bottom: 2px;

            .bp3-input-group .bp3-input {
              margin-top: -2px;
              margin-bottom: -2px;
              font-size: unset;
              line-height: unset;
              border-radius: 0;
              height: 18px;
            }
          `}>
        {children}
      </div>
    </div>
  );
}


interface TextInputProps {
  value: string
  onChange?: (newValue: string) => void
  onConfirm?: () => void
  inputGroupProps?: IInputGroupProps2 
  validationErrors?: string[]
}
export const TextInput: React.FC<TextInputProps> =
function ({ value, onChange, validationErrors, inputGroupProps }) {
  const errs = validationErrors ?? [];
  const invalid = errs.length > 0;
  return (
    <InputGroup
      fill small
      disabled={!onChange}
      value={value}
      css={css`${invalid && onChange ? `.bp3-input { background: mistyrose }` : ''}`}
      rightElement={invalid
        ? <Tooltip2
              position="right"
              intent="danger"
              minimal
              content={
                <UL css={css`margin: 0;`}>
                  {errs.map((err, idx) => <li key={idx}>{err}</li>)}
                </UL>
              }>
            <Icon icon="warning-sign" iconSize={10} intent="danger" css={css`margin-right: 5px;`} />
          </Tooltip2>
        : undefined}
      {...inputGroupProps}
      onChange={onChange ? (evt: React.FormEvent<HTMLInputElement>) => onChange!(evt.currentTarget.value) : undefined}
    />
  )
}


export default PropertyView;
