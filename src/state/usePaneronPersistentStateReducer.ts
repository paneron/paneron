import usePersistentStateReducer, {
  BaseAction,
  PersistentStateReducerHook,
} from 'renderer/usePersistentStateReducer';
import { loadState, storeState } from './ipc';


/* An implementation of PersistentStateReducer
   that uses Paneron’s state management IPC endpoints. */
function usePaneronPersistentStateReducer<S, A extends BaseAction>(
  ...args: Parameters<PersistentStateReducerHook<S, A>>
) {
  function _storeState(storageKey: string, state: S) {
    storeState.renderer!.trigger({
      key: storageKey,
      newState: state,
    });
  }
  async function _loadState(storageKey: string): Promise<S | undefined> {
    const loadedState =
      (await loadState.renderer!.trigger({ key: storageKey })).
        result?.state as S | undefined;
    return loadedState;
  }

  return usePersistentStateReducer(
    _storeState,
    _loadState,
    ...args);
}

export default usePaneronPersistentStateReducer;
