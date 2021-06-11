/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { Classes, ControlGroup, H5, Icon, InputGroup } from '@blueprintjs/core';
import { css, jsx } from '@emotion/react';
import { Extension } from 'plugins/types';
import React from 'react';
import { MarkedText } from 'renderer/widgets';
import PluginStatusButton from './PluginStatusButton';


export interface DatasetExtensionCardProps {
  extension?: Extension
  full?: true
  searchString?: string
}
const DatasetExtension: React.FC<DatasetExtensionCardProps> =
function ({ extension, full, searchString }) {
  const title = extension?.title || 'Loading…';
  const description = extension?.description || 'Loading…';
  const author = extension?.author || 'Loading…';

  return (
    <>
      <H5 css={css`display: flex; flex-flow: row nowrap; align-items: center;`}>
        <img
          src={extension?.iconURL}
          className={!extension ? Classes.SKELETON : undefined}
          css={css`height: 2rem; width: 2rem; display: block; margin-right: .5em;`} />
        <span className={!extension ? Classes.SKELETON : undefined}>
          <MarkedText text={title} term={searchString} />
        </span>
        &emsp;
        <small className={!extension ? Classes.SKELETON : undefined} css={css`font-weight: normal;`}>
          {extension?.npm.version}&emsp;
        </small>
      </H5>
      <div css={css`margin-bottom: 10px;`}>
        by
        {" "}
        <MarkedText text={author} term={searchString} />
      </div>
      {full && extension?.npm.name
        ? <>
            <ControlGroup css={css`margin-bottom: 1rem;`} vertical fill>
              <PluginStatusButton id={extension.npm.name} />
              <InputGroup title="Extension’s NPM package ID" fill disabled value={extension.npm.name} />
            </ControlGroup>
          </>
        : null}
      <p
          className={!extension ? Classes.SKELETON : undefined}
          css={css`
            margin: 0;
            ${!full ? css`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` : ''}
          `}>
        {extension?.featured
          ? <span css={css`margin-right: 1em;`}><Icon icon="star" css={{ color: 'gold' }} />&ensp;Featured</span>
          : null}
        <MarkedText text={description} term={searchString} />
      </p>
    </>
  );
};


export default DatasetExtension;
