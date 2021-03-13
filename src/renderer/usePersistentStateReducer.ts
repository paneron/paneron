import { useReducer, useEffect, useState } from 'react';
import type { Reducer, Dispatch } from 'react';


const DEFAULT_DEBOUNCE_DELAY = 200;

const LOAD_STATE_ACTION_TYPE = 'loadedState' as const;


export interface BaseAction {
  type: string
  payload?: any
}


/* Action issued when previously stored state is loaded. */
export interface LoadStateAction<S> extends BaseAction {
  type: typeof LOAD_STATE_ACTION_TYPE
  payload?: S
}


export type PersistentStateReducerHook<S, A extends BaseAction> =
  (
    reducer: Reducer<S, A>,
    initialState: S,
    initializer: ((initialState: S) => S) | null,

    /* Each component should specify a unique storage key. */
    storageKey: string,

    /* Calls to store state will be debounced according to this delay
       in case state change too often. */
    storageDebounceMS?: number,
  ) => [state: S, dispatch: Dispatch<A>, stateRecalled: boolean];


/* Creates a reducer that handles a special loadedState action,
   relevant to persistent state reducer, in addition to any other
   action handled by component-specific reducer function passed in. */
function reducerFactory<S, A extends BaseAction>(
  reducer: Reducer<S, A>,
): Reducer<S, A | LoadStateAction<S>> {
  return (prevState: S, action: A | LoadStateAction<S>) => {
    switch (action.type) {
      case LOAD_STATE_ACTION_TYPE:
        return action.payload;
      default:
        return reducer(prevState, action as A);
    }
  }
}


/* A reducer that persists each new state,
   and attempts to load persisted state when component is mounted.
   During the initial load, initialized is set to false. */
function usePersistentStateReducer<S, A extends BaseAction>(
  storeState: (key: string, newState: S) => void,
  loadState: (key: string) => Promise<S | undefined>,
  ...args: Parameters<PersistentStateReducerHook<S, A>>
): [state: S, dispatch: Dispatch<A>, initialized: boolean] {
  const [reducer, initialState, initializer, storageKey, storageDebounceMS] = args;

  const debounceDelay = storageDebounceMS ?? DEFAULT_DEBOUNCE_DELAY;

  const effectiveReducer = reducerFactory(reducer);

  const [initialized, setInitialized] = useState(false);
  const [state, dispatch] = initializer
    ? useReducer(effectiveReducer, initialState, initializer)
    : useReducer(effectiveReducer, initialState);

  useEffect(() => {
    setInitialized(false);
    (async () => {
      const loadedState = await loadState(storageKey);
      dispatch({
        type: LOAD_STATE_ACTION_TYPE,
        payload: loadedState ?? initialState,
      });
      setInitialized(true);
    })();
  }, [storageKey]);

  useEffect(() => {
    if (initialized === true) {
      let timeout = setTimeout(() => {
        storeState(storageKey, state);
      }, debounceDelay);
      return () => clearTimeout(timeout);
    }
    return () => void 0;
  }, [storageKey, state]);

  return [state, dispatch, initialized];
}


export default usePersistentStateReducer;
