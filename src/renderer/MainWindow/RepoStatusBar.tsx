/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { jsx, css } from '@emotion/core';
import React, { useContext, useEffect, useState } from 'react';
import { throttle } from 'throttle-debounce';
import { ProgressBar, Spinner, Tag, Text } from '@blueprintjs/core';
import { loadRepository, repositoryStatusChanged, RepoStatus } from 'repositories/ipc';
import { Context } from './context';


export const RepoStatusBar: React.FC<Record<never, never>> = React.memo(function () {
  const { state: { selectedRepoWorkDir }, showMessage } = useContext(Context);

  useEffect(() => {
    (async () => {
      try {
        const result = await loadRepository.renderer!.trigger({ workingCopyPath: selectedRepoWorkDir ?? '' });
        const status = result.result
        if (status) {
          setStatus(status);
        } else {
          log.warn("Loading repository: loadRepository() returned undefined status");
        }
        log.info("Loaded repository", result.result);
      } catch (e) {
        showMessage({ intent: 'danger', icon: 'error', message: "Error loading repository" });
        log.error("Error loading repository", e);
      }
    })();
  }, []);

  const [status, setStatus] = useState<RepoStatus>(initialStatus);

  const throttledSetStatus = throttle(50, setStatus, false);

  repositoryStatusChanged.renderer!.useEvent(async ({ workingCopyPath, status }) => {
    if (workingCopyPath === selectedRepoWorkDir) {
      throttledSetStatus(status);
    }
  }, []);

  let maybeProgressBar: JSX.Element | null;
  if (status.busy) {
    switch (status.busy?.operation) {
      case 'pushing':
      case 'pulling': // @ts-ignore: fallthrough case in switch
      case 'cloning':
        maybeProgressBar = <>
          <Text>
            {status.busy.operation}:
            {" "}
            {status.busy.progress?.phase}
          </Text>
          <ProgressBar
            css={css`margin-left: 10px;`}
            value={status.busy.progress
              ? status.busy.progress.loaded / status.busy.progress.total
              : undefined} />
          {status.busy.networkError
            ? <Tag intent="danger" icon="error">Error</Tag>
            : null}
        </>;
      default:
        maybeProgressBar = <>
          <Text>
            {status.busy.operation}
          </Text>
          <Spinner size={10} css={css`margin-left: 10px;`} />
        </>;
    }
  } else {
    maybeProgressBar = null;
  }

  return (
    <>
      {status.status}
      {maybeProgressBar}
    </>
  );
});

const initialStatus: RepoStatus = { busy: { operation: 'initializing' } };

export default RepoStatusBar;
