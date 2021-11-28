/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { throttle } from 'throttle-debounce';

import React, { useEffect, useState } from 'react';
import { jsx } from '@emotion/react';
import { IToastProps } from '@blueprintjs/core';

import { loadRepository, repositoryStatusChanged } from 'repositories/ipc';
import { Repository, RepoStatus } from 'repositories/types';

import { Breadcrumb, BreadcrumbProps } from './Breadcrumb';


const initialStatus: RepoStatus = { busy: { operation: 'initializing' } };


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
        const status = result.result;
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

  const throttledSetStatus = throttle(10, setStatus, false);

  loadedRepositoryStatusChanged.renderer!.useEvent(async ({ workingCopyPath, status }) => {
    if (workingCopyPath === workDir) {
      throttledSetStatus(status);
    }
  }, [workDir]);

  let progress: BreadcrumbProps["progress"];
  let error: true | string | undefined;
  if (status.busy) {
    switch (status.busy?.operation) {

      // Only these operations can provide specific progress info
      case 'pushing':
      case 'pulling':
      case 'cloning':
        progress = status.busy.progress
          ? { ...status.busy.progress, phase: `${status.busy.operation}: ${status.busy.progress.phase}…` }
          : { phase: status.busy.operation };
        error = status.busy.networkError;
        break;

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
      title={
        repoInfo.paneronMeta?.title ??
        repoInfo.gitMeta.workingCopyPath.slice(
          repoInfo.gitMeta.workingCopyPath.length - 20,
          repoInfo.gitMeta.workingCopyPath.length)}
      icon={{ type: 'blueprint', iconName: "git-repo" }}
      onClose={onClose}
      onNavigate={onNavigate}
      status={<>
        {status.status ? <div>Status: {status.status}</div> : null}
        <div>Working copy: <code>{repoInfo.gitMeta.workingCopyPath}</code></div>
        <div>Branch: <code>{repoInfo.gitMeta.mainBranch}</code></div>
      </>}
      progress={progress}
      error={error}
    />
  );
};


export default RepoBreadcrumb;
