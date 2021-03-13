import { useReducer, useEffect, useState } from 'react';
import type { Reducer, Dispatch } from 'react';


export interface BaseAction {
  type: string
  payload?: any
}


/* Action issued when previously stored state is loaded. */
export interface LoadedAction<S> extends BaseAction {
  type: 'loadedState'
  payload?: S
}


/* A reducer that persists each new state,
   and attempts to load persisted state when component is mounted.
   During the initial load, initialized is set to false. */
export type PersistentStateReducerHook<S, A extends BaseAction> =
  (
    reducer: Reducer<S, A>,
    initialState: S,
    initializer: ((initialState: S) => S) | null,
    storageKey: string,
  ) => [state: S, dispatch: Dispatch<A>, initialized: boolean];


function reducerFactory<S, A extends BaseAction>(
  reducer: Reducer<S, A>,
): Reducer<S, A | LoadedAction<S>> {
  return (prevState: S, action: A | LoadedAction<S>) => {
    switch (action.type) {
      case 'loadedState':
        return action.payload;
      default:
        return reducer(prevState, action as A);
    }
  }
}


/* An abstract implementation of persistent state reducer hook. */
function usePersistentStateReducer<S, A extends BaseAction>(
  storeState: (key: string, newState: S) => void,
  loadState: (key: string) => Promise<S | undefined>,
  ...args: Parameters<PersistentStateReducerHook<S, A>>
): [state: S, dispatch: Dispatch<A>, initialized: boolean] {
  const [reducer, initialState, initializer, storageKey] = args;

  const effectiveReducer = reducerFactory(reducer);

  const [initialized, setInitialized] = useState(false);
  const [state, dispatch] = initializer
    ? useReducer(effectiveReducer, initialState, initializer)
    : useReducer(effectiveReducer, initialState);

  useEffect(() => {
    setInitialized(false);
    (async () => {
      const loadedState = await loadState(storageKey);
      dispatch({ type: 'loadedState', payload: loadedState ?? initialState });
      setInitialized(true);
    })();
  }, [storageKey]);

  useEffect(() => {
    if (initialized === true) {
      storeState(storageKey, state);
    }
  }, [storageKey, state]);

  return [state, dispatch, initialized];
}


export default usePersistentStateReducer;
