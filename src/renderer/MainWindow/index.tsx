/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { jsx, css } from '@emotion/core';
import React, { useEffect } from 'react';
import useRepositoryList, { Repository } from 'renderer/repositories/useRepositoryList';
import usePaneronPersistedStateReducer from 'state/usePaneronPersistedStateReducer';
import { BaseAction } from 'renderer/usePersistentStateReducer';
import { WindowComponentProps } from 'window';
import useDebounce from 'renderer/useDebounce';


interface BaseState {
  view: string
  repoFilterString: string
  selectedRepoWorkDir: unknown
  selectedDatasetID: unknown
}
interface RepoListState extends BaseState {
  view: 'repo-list'
  repoFilterString: string
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
  repoFilterString: '',
  selectedRepoWorkDir: null,
  selectedDatasetID: null,
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
  workDir: string
  datasetID: string
}
interface CloseAction extends BaseAction {
  type: 'close-dataset' | 'close-repo'
}
type Action =
  | AddRepoAction
  | SelectRepoAction
  | SelectDatasetAction
  | CloseAction


const MainWindow: React.FC<WindowComponentProps> = function () {

  const [state, dispatch, stateLoaded] = usePaneronPersistedStateReducer(
    reducer,
    initialState,
    null,
    'main-window',
  );

  const normalizedRepoFilterString = useDebounce(state.repoFilterString.trim(), 250);

  const repositories = useRepositoryList({
    matchesString: normalizedRepoFilterString.trim(),
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
      return repositories.value.repositories.
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
        if (getDataset(action.workDir, action.datasetID)) {
          return {
            ...prevState,
            view: 'dataset',
            selectedRepoWorkDir: action.workDir,
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

  function handleOpenRepo(workDir: string) {
    dispatch({ type: 'open-repo-settings', workDir });
  }

  function handleSelectDataset(workDir: string, datasetID: string) {
    dispatch({ type: 'open-dataset', workDir, datasetID });
  }

  function handleCloseRepo() {
    dispatch({ type: 'close-repo' });
  }

  function handleCloseDataset() {
    dispatch({ type: 'close-dataset' });
  }

  let mainView: JSX.Element;

  return (
    <div css={css`position: absolute; top: 0; right: 0; bottom: 0; left: 0`}>
      <div>
      </div>
    </div>
  );
};


export default MainWindow;
