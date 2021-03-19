/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/core';
import React from 'react';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import reducer, { initialState, State } from './reducer';
import { Action } from './actions';


interface ContextSpec {
  state: State
  dispatch: React.Dispatch<Action> 
  stateLoaded: boolean
}


export const Context = React.createContext<ContextSpec>({
  state: initialState,
  dispatch: () => void 0,
  stateLoaded: false,
});


const ContextProvider: React.FC<Record<never, never>> = function ({ children }) {
  const [state, dispatch, stateLoaded] = usePaneronPersistentStateReducer(
    reducer,
    initialState,
    null,
    'main-window',
  );
  return (
    <Context.Provider value={{ state, dispatch, stateLoaded }}>
      {children}
    </Context.Provider>
  );
};

export default ContextProvider;
