/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { jsx, css } from '@emotion/core';
import React, { useEffect } from 'react';

import { WindowComponentProps } from 'window';

import useDebounce from 'renderer/useDebounce';
import { BaseAction } from 'renderer/usePersistentStateReducer';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';

import useRepositoryList from 'renderer/repositories/useRepositoryList';
import type { Repository, RepositoryListQuery } from 'repositories/types';

import Nav, { NavBreadcrumb } from './Nav';
import { NonIdealState } from '@blueprintjs/core';


interface BaseState {
  view: string
  repoQuery: RepositoryListQuery
  selectedRepoWorkDir: unknown
  selectedDatasetID: unknown
}
interface RepoListState extends BaseState {
  view: 'repo-list'
  selectedRepoWorkDir: null
  selectedDatasetID: null 
}
interface OpenRepoState extends BaseState {
  view: 'repo-settings'
  selectedRepoWorkDir: string
  selectedDatasetID: null
}
interface OpenDatasetState extends BaseState {
  view: 'dataset'
  selectedRepoWorkDir: string
  selectedDatasetID: string
}
type State =
  | RepoListState
  | OpenRepoState
  | OpenDatasetState

const initialState: State = {
  view: 'repo-list',
  repoQuery: {},
  selectedRepoWorkDir: null,
  selectedDatasetID: null,
}


interface UpdateRepoQueryAction extends BaseAction {
  type: 'update-query'
  payload: RepositoryListQuery
}
interface AddRepoAction extends BaseAction {
  type: 'add-repo'
}
interface SelectRepoAction extends BaseAction {
  type: 'open-repo-settings'
  workDir: string
}
interface SelectDatasetAction extends BaseAction {
  type: 'open-dataset'
  datasetID: string
}
interface CloseAction extends BaseAction {
  type: 'close-dataset' | 'close-repo'
}
type Action =
  | UpdateRepoQueryAction
  | AddRepoAction
  | SelectRepoAction
  | SelectDatasetAction
  | CloseAction


const MainWindow: React.FC<WindowComponentProps> = function () {

  const [state, dispatch, stateLoaded] = usePaneronPersistentStateReducer(
    reducer,
    initialState,
    null,
    'main-window',
  );

  const normalizedRepoFilterString = useDebounce(state.repoQuery.matchesText?.trim() ?? '', 250);

  const repositories = useRepositoryList({
    matchesText: normalizedRepoFilterString.trim(),
  });

  useEffect(() => {
    if (stateLoaded && !repositories.isUpdating) {
      if (state.view === 'dataset' &&
          getDataset(state.selectedRepoWorkDir, state.selectedDatasetID) === undefined) {
        log.warn("Main window: Can’t show dataset: Missing dataset or repository",
          state.selectedRepoWorkDir, state.selectedDatasetID, repositories.value);
        dispatch({ type: 'close-dataset' });
      } else if (state.view === 'repo-settings' &&
          getRepo(state.selectedRepoWorkDir) === undefined) {
        log.warn("Main window: Can’t show repo-settings: Missing repository",
          state.selectedRepoWorkDir, repositories.value);
        dispatch({ type: 'close-repo' });
      }
    }
  }, [stateLoaded, state.view, repositories.isUpdating]);

  function getRepo(workDir: string): Repository | undefined {
    if (repositories.isUpdating === false) {
      return repositories.value.objects.
        find(repo => repo.gitMeta.workingCopyPath === workDir && repo.paneronMeta !== undefined);
    }
    return undefined;
  }

  function getDataset(workDir: string, datasetID: string): true | undefined {
    const repo = getRepo(workDir);
    if (repo && repo.paneronMeta?.datasets?.[datasetID]) {
      return true;
    }
    return undefined;
  }

  function reducer(prevState: State, action: Action): State {
    switch (action.type) {
      case 'open-repo-settings':
        if (getRepo(action.workDir)) {
          return {
            ...prevState,
            view: 'repo-settings',
            selectedRepoWorkDir: action.workDir,
            selectedDatasetID: null,
          };
        }
        return prevState;

      case 'open-dataset':
        if (prevState.selectedRepoWorkDir && getDataset(prevState.selectedRepoWorkDir, action.datasetID)) {
          return {
            ...prevState,
            view: 'dataset',
            selectedDatasetID: action.datasetID,
          };
        }
        return prevState;

      case 'close-dataset':
        if (prevState.selectedRepoWorkDir) {
          return {
            ...prevState,
            view: 'repo-settings',
            selectedDatasetID: null,
          };
        } else {
          log.warn("Trying to close dataset, but repo is not open");
          // Unexpected state
          return prevState;
        }

      case 'close-repo':
        return {
          ...prevState,
          view: 'repo-list',
          selectedRepoWorkDir: null,
          selectedDatasetID: null,
        };

      default:
        throw new Error("Invalid action");
    }
  }

  let topPanelBreadcrumbs: NavBreadcrumb[] = [{
    title: 'Paneron',
    onClose: undefined,
    onNavigate: state.view !== 'repo-list'
      ? () => dispatch({ type: 'close-repo' })
      : undefined,
  }];
  if (state.selectedRepoWorkDir) {
    const repo = getRepo(state.selectedRepoWorkDir);
    if (repo) {
      const title = repo.paneronMeta?.title ?? repo.gitMeta?.workingCopyPath;
      topPanelBreadcrumbs.push({
        title,
        onClose: () => dispatch({ type: 'close-repo' }),
        onNavigate: state.view === 'dataset'
          ? () => dispatch({ type: 'close-dataset' })
          : undefined,
      });
    }
  }
  if (state.selectedDatasetID) {
    const dataset = getDataset(state.selectedRepoWorkDir, state.selectedDatasetID);
    if (dataset) {
      topPanelBreadcrumbs.push({
        title: state.selectedDatasetID,
        onNavigate: undefined,
      });
    }
  }

  let mainView: JSX.Element;

  if (state.view === 'repo-list') {
    mainView = <RepoList
      repositories={repositories}
      query={state.repoQuery}
      onQueryChange={(payload: RepositoryListQuery) => dispatch({ type: 'update-query', payload })}
      onOpenRepo={(workDir: string) => dispatch({ type: 'open-repo-settings', workDir })}
    />;

  } else if (state.view === 'repo-settings') {
    mainView = <RepoSettings
      workDir={state.selectedRepoWorkDir}
      onOpenDataset={(datasetID: string) => dispatch({ type: 'open-dataset', datasetID })}
    />;

  } else if (state.view === 'dataset') {
    mainView = <Dataset
      workDir={state.selectedRepoWorkDir}
      datasetID={state.selectedDatasetID}
    />;

  } else {
    mainView = <NonIdealState
      title="Nothing to show"
      icon="heart-broken" />;
  }

  return (
    <div css={css`position: absolute; top: 0; right: 0; bottom: 0; left: 0`}>
      <Nav breadcrumbs={topPanelBreadcrumbs} />
      {mainView}
    </div>
  );
};


export default MainWindow;
