/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { throttle } from 'throttle-debounce';
import formatDistance from 'date-fns/formatDistance';

import React, { useState, useMemo, useEffect } from 'react';
import { jsx } from '@emotion/react';
import type { ToastProps } from '@blueprintjs/core';

import { loadRepository, unloadRepository, loadedRepositoryStatusChanged } from 'repositories/ipc';
import { describeRepository, repositoryBuffersChanged } from 'repositories/ipc';
import type { RepoStatus } from 'repositories/types';

import { Breadcrumb, type BreadcrumbProps } from './Breadcrumb';
import RepositorySummary from '../repositories/TooltipSummary';


const initialStatus: RepoStatus = { busy: { operation: 'initializing' } };


export const RepoBreadcrumb: React.FC<{
  workDir: string
  onNavigate?: () => void
  onClose?: () => void
  onMessage: (opts: ToastProps) => void
}> = function ({ workDir, onNavigate, onClose, onMessage }) {
  const openedRepoResp = describeRepository.renderer!.useValue({
    workingCopyPath: workDir,
  }, {
    info: {
      gitMeta: {
        workingCopyPath: workDir,
        mainBranch: '',
      },
    },
    isLoaded: false,
  });

  const repoInfo = openedRepoResp.value.info;

  repositoryBuffersChanged.renderer!.useEvent(async ({ workingCopyPath }) => {
    if (workingCopyPath === workDir) {
      openedRepoResp.refresh();
    }
  }, [workDir]);

  const originalRepoStatus = loadRepository.renderer!.useValue({
    workingCopyPath: workDir,
  }, initialStatus);

  const [_status, setStatus] = useState<RepoStatus | null>(null);
  const throttledSetStatus = useMemo(() => throttle(50, setStatus, false), [workDir]);
  const status = _status ?? originalRepoStatus.value;
  const isLoaded = _status?.status !== 'unloaded' ?? openedRepoResp.value.isLoaded;

  loadedRepositoryStatusChanged.renderer!.useEvent(async ({ workingCopyPath, status }) => {
    if (workingCopyPath === workDir) {
      throttledSetStatus(status);
    }
  }, [workDir]);

  const [lastSyncTS, setLastSyncTS] = useState<Date | null>(null);
  const [timeSinceLastSync, setTimeSinceLastSync] = useState<string>('');

  useEffect(() => {
    const interval = setInterval(
      (() =>
        lastSyncTS
          ? setTimeSinceLastSync(formatDistance(new Date(), lastSyncTS, { includeSeconds: true }))
          : void 0
      ),
      888);
    return function cleanup() { clearInterval(interval); };
  }, [workDir, lastSyncTS]);

  useEffect(() => {
    return function cleanup() {
      unloadRepository.renderer!.trigger({ workingCopyPath: workDir });
    }
  }, [workDir]);

  const [progress, error]: [BreadcrumbProps["progress"], true | string | undefined] =
  useMemo(() => {
    let progress: BreadcrumbProps["progress"];
    let error: true | string | undefined;
    if (status.busy) {
      switch (status.busy?.operation) {

        // Only these operations can provide specific progress info
        case 'uploading to LFS':
        case 'pushing':
        case 'pulling':
        case 'cloning':
          setLastSyncTS(new Date());
          if (status.busy.awaitingPassword) {
            progress = { phase: "Awaiting credentials" };
            error = "Unable to authenticate — please check stored access credentials in repository settings";
          } else {
            progress = status.busy.progress
              ? { ...status.busy.progress, phase: `${status.busy.operation}: ${status.busy.progress.phase}` }
              : { phase: status.busy.operation };
            error = status.busy.networkError
              ? "Possible networking issue"
              : undefined;
          }
          break;

        // For the rest, show indeterminate progress
        default:
          progress = { phase: `Operation: ${status.busy.operation}…` };
          error = undefined;
      }
    } else {
      progress = undefined;
      error = !isLoaded ? "Repository is not loaded" : undefined;
    }
    return [progress, error]
  }, [isLoaded, status.status, JSON.stringify(status.busy ?? {})]);

  return (
    <Breadcrumb
      title={
        repoInfo.paneronMeta?.title ??
        repoInfo.gitMeta.workingCopyPath.slice(
          repoInfo.gitMeta.workingCopyPath.length - 20,
          repoInfo.gitMeta.workingCopyPath.length)}
      icon={{ type: 'blueprint', iconName: 'git-repo' }}
      onClose={onClose}
      onNavigate={onNavigate}
      status={<>
        {!progress
          ? <>
              {isLoaded ? "Loaded" : "Not loaded"}
              {status.status ? ` — status: ${status.status ?? 'N/A'}` : null}
              {timeSinceLastSync ? ` — ${timeSinceLastSync} since last sync attempt` : null}
            </>
          : null}
        <RepositorySummary repo={repoInfo} />
      </>}
      progress={progress}
      error={error}
    />
  );
};


export default RepoBreadcrumb;
