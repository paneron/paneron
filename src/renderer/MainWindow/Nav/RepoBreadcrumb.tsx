/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { throttle } from 'throttle-debounce';
import { jsx } from '@emotion/core';
import React, { useEffect, useState } from 'react';
import { loadRepository, Repository, repositoryStatusChanged, RepoStatus } from 'repositories/ipc';
import { Breadcrumb, BreadcrumbProps } from './Breadcrumb';
import { IToastProps } from '@blueprintjs/core';


export const RepoBreadcrumb: React.FC<{
  workDir: string
  repoInfo: Repository
  onNavigate?: () => void
  onClose?: () => void
  onMessage: (opts: IToastProps) => void
}> = function ({ workDir, repoInfo, onNavigate, onClose, onMessage }) {
  useEffect(() => {
    (async () => {
      try {
        const result = await loadRepository.renderer!.trigger({ workingCopyPath: workDir });
        const status = result.result
        if (status) {
          setStatus(status);
        } else {
          log.warn("Loading repository: loadRepository() returned undefined status");
        }
        log.info("Loaded repository", result.result);
      } catch (e) {
        onMessage({ intent: 'danger', icon: 'error', message: "Error loading repository" });
        log.error("Error loading repository", e);
      }
    })();
  }, []);

  const [status, setStatus] = useState<RepoStatus>(initialStatus);

  const throttledSetStatus = throttle(50, setStatus, false);

  repositoryStatusChanged.renderer!.useEvent(async ({ workingCopyPath, status }) => {
    if (workingCopyPath === workDir) {
      throttledSetStatus(status);
    }
  }, []);

  let progress: BreadcrumbProps["progress"];
  let error: true | string | undefined;
  if (status.busy) {
    switch (status.busy?.operation) {

      // Only these operations can provide specific progress info
      case 'pushing':
      case 'pulling': // @ts-ignore: fallthrough case in switch
      case 'cloning':
        progress = status.busy.progress
          ? { ...status.busy.progress, phase: `${status.busy.operation}: ${status.busy.progress.phase}…` }
          : { phase: status.busy.operation };
        error = status.busy.networkError;

      // For the rest, show indeterminate progress
      default:
        progress = { phase: `Operation: ${status.busy.operation}…` };
        error = undefined;
    }
  } else {
    progress = undefined;
    error = undefined;
  }

  return (
    <Breadcrumb
      title={repoInfo.paneronMeta?.title ?? repoInfo.gitMeta.workingCopyPath}
      icon={{ type: 'blueprint', iconName: "git-repo" }}
      onClose={onClose}
      onNavigate={onNavigate}
      status={<>
        {status.status ? <div>Status: {status.status}</div> : null}
        <div>Working copy: {repoInfo.gitMeta.workingCopyPath}</div>
      </>}
      progress={progress}
      error={error}
    />
  );
};

const initialStatus: RepoStatus = { busy: { operation: 'initializing' } };


export default RepoBreadcrumb;
