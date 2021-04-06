/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/core';
import React from 'react';
import { Icon, IconName, PopoverInteractionKind, Spinner } from '@blueprintjs/core';
import { Tooltip2 as Tooltip } from '@blueprintjs/popover2';


const ICON_PROPS = {
  iconSize: 10,
};

const SPINNER_PROPS = {
  size: 10,
};

export const Breadcrumb: React.FC<BreadcrumbProps> =
function ({ icon, title, onClose, onNavigate, status, progress, onRefresh, className }) {
  let statusIcon: JSX.Element;
  if (progress) {
    if (progress.loaded || progress.total) {
      const progressValue = Math.floor(100 / (progress.total || 100) * (progress.loaded || 0.5)) / 100;
      statusIcon = <Spinner {...SPINNER_PROPS} value={progressValue} />;
    } else {
      statusIcon = <Spinner {...SPINNER_PROPS} />;
    }
  } else if (onRefresh) {
    statusIcon = <Icon {...ICON_PROPS} icon="refresh" onClick={onRefresh} title="Click to refresh" />;
  } else if (icon?.type === 'blueprint') {
    statusIcon = <Icon {...ICON_PROPS} icon={icon.iconName} />;
  } else if (icon?.type === 'file') {
    statusIcon = <img src={icon.fileName} />;
  } else {
    statusIcon = <Icon {...ICON_PROPS} icon="symbol-circle" />;
  }

  let progressDescription: JSX.Element | null;
  if (progress) {
    progressDescription = <>
      {progress.phase}
      {progress.loaded || progress.total
        ? <span>: <code>{progress.loaded ?? '?'}</code> of <code>{progress.total ?? '?'}</code>…</span>
        : null}
    </>;
  } else {
    progressDescription = null;
  }

  const titleEl: JSX.Element = <span onClick={onNavigate} css={css`${onNavigate ? 'cursor: pointer;' : ''}`}>
    {title}
  </span>;

  return (
    <div
      css={css`
          padding: 0 10px;
          display: flex;
          flex-flow: row nowrap;
          align-items: center;
          transform: skew(45deg);
        `}
      className={className}
      onClick={onNavigate}>

      <div css={css`margin-right: .5rem;`}>
        {statusIcon}
      </div>

      {status || progressDescription
        ? <Tooltip
              minimal
              interactionKind={PopoverInteractionKind.HOVER}
              hoverCloseDelay={200}
              position="bottom-right"
              content={<div css={css`font-size: 80%`} onClick={e => e.stopPropagation()}>
                {progressDescription ? <div css={css`text-transform: capitalize`}>{progressDescription}</div> : null}
                {status ? <div>{status}</div> : null}
              </div>}>
            {titleEl}
          </Tooltip>
        : titleEl}

    </div>
  );
};


export interface BreadcrumbProps {
  icon?: { type: 'blueprint'; iconName: IconName; } | { type: 'file'; fileName: string; };
  title: string | JSX.Element;

  status?: JSX.Element;
  error?: true | string;
  progress?: {
    phase: string;
    loaded?: number;
    total?: number;
  };
  onRefresh?: () => void;

  onClose?: () => void;
  onNavigate?: () => void;

  className?: string;
}


export default Breadcrumb;
