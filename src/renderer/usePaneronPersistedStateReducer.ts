import { loadWindowState, storeWindowState } from 'common';
import usePersistentStateReducer, {
  BaseAction,
  PersistentStateReducerHook,
} from './usePersistentStateReducer';


/* An implementation of PersistentStateReducer
   that uses Paneron’s state management IPC endpoints. */
function usePaneronPersistedStateReducer<S, A extends BaseAction>(
  ...args: Parameters<PersistentStateReducerHook<S, A>>
) {
  function storeState(storageKey: string, state: S) {
    storeWindowState.renderer!.trigger({
      key: storageKey,
      newState: state,
    });
  }
  async function loadState(storageKey: string): Promise<S | undefined> {
    const loadedState =
      (await loadWindowState.renderer!.trigger({ key: storageKey })).
        result?.state as S | undefined;
    return loadedState;
  }

  return usePersistentStateReducer(storeState, loadState, ...args);
}

export default usePaneronPersistedStateReducer;
