/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { throttle } from 'throttle-debounce';

import React, { useState, useMemo } from 'react';
import { jsx } from '@emotion/react';
import type { ToastProps } from '@blueprintjs/core';

import { loadRepository, loadedRepositoryStatusChanged } from 'repositories/ipc';
import type { Repository, RepoStatus } from 'repositories/types';

import { Breadcrumb, type BreadcrumbProps } from './Breadcrumb';


const initialStatus: RepoStatus = { busy: { operation: 'initializing' } };


export const RepoBreadcrumb: React.FC<{
  workDir: string
  repoInfo: Repository
  isLoaded: boolean
  onNavigate?: () => void
  onClose?: () => void
  onMessage: (opts: ToastProps) => void
}> = function ({ workDir, repoInfo, isLoaded: _isLoaded, onNavigate, onClose, onMessage }) {
  const repoStatus = loadRepository.renderer!.useValue({
    workingCopyPath: workDir,
  }, initialStatus);

  const [_status, setStatus] = useState<RepoStatus | null>(null);

  const status = _status ?? repoStatus.value;

  const isLoaded = _status ? _status.status !== 'unloaded' : _isLoaded;

  const throttledSetStatus = useMemo(() => throttle(50, setStatus, false), []);

  loadedRepositoryStatusChanged.renderer!.useEvent(async ({ workingCopyPath, status }) => {
    if (workingCopyPath === workDir) {
      throttledSetStatus(status);
    }
  }, [workDir]);

  const [progress, error]: [BreadcrumbProps["progress"], true | string | undefined] =
  useMemo(() => {
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
    return [progress, error]
  }, [JSON.stringify(status.busy ?? {})]);

  return (
    <Breadcrumb
      title={
        repoInfo.paneronMeta?.title ??
        repoInfo.gitMeta.workingCopyPath.slice(
          repoInfo.gitMeta.workingCopyPath.length - 20,
          repoInfo.gitMeta.workingCopyPath.length)}
      icon={{ type: 'blueprint', iconName: isLoaded ? 'git-repo' : 'offline' }}
      onClose={onClose}
      onNavigate={onNavigate}
      status={<>
        <div>{isLoaded ? "Loaded" : "Not loaded"} — status: {status.status ?? "N/A"}</div>
        <div>Working copy: <code>{repoInfo.gitMeta.workingCopyPath}</code></div>
        <div>Branch: <code>{repoInfo.gitMeta.mainBranch}</code></div>
      </>}
      progress={progress}
      error={error}
    />
  );
};


export default RepoBreadcrumb;
