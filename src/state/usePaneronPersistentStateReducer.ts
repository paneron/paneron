import { type Dispatch, useCallback } from 'react';
import usePersistentStateReducer, {
  type BaseAction,
  type PersistentStateReducerHook,
} from '@riboseinc/paneron-extension-kit/usePersistentStateReducer';
import { loadState, storeState } from './ipc';


export type PaneronPersistentStateReducerHook<S, A extends BaseAction> = (...args: Parameters<PersistentStateReducerHook<S, A>>) => [state: S, dispatch: Dispatch<A>, initialized: boolean];

/**
 * An implementation of PersistentStateReducer
 * that uses Paneron’s state management IPC endpoints.
 */
function usePaneronPersistentStateReducer<S extends Record<string, any>, A extends BaseAction>(
  ...args: Parameters<PersistentStateReducerHook<S, A>>
) {
  const _storeState = useCallback(function _storeState(storageKey: string, state: S) {
    storeState.renderer!.trigger({
      key: storageKey,
      newState: state,
    });
  }, [storeState.renderer!.trigger]);

  const _loadState = useCallback(async function _loadState(storageKey: string): Promise<S | undefined> {
    const loadedState =
      (await loadState.renderer!.trigger({ key: storageKey })).
        result?.state as S | undefined;
    return loadedState;
  }, [loadState.renderer!.trigger]);

  return usePersistentStateReducer(
    _storeState,
    _loadState,
    ...args);
}

export default usePaneronPersistentStateReducer;
