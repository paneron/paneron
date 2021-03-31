/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/core';
import React from 'react';
import { IToastProps, Toaster } from '@blueprintjs/core';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import reducer, { initialState, State } from './reducer';
import { Action } from './actions';


const toaster = Toaster.create({ position: 'bottom' });


interface ContextSpec {
  state: State
  dispatch: React.Dispatch<Action> 
  stateLoaded: boolean
  showMessage: (opts: IToastProps) => void
}


export const Context = React.createContext<ContextSpec>({
  state: initialState,
  dispatch: () => void 0,
  stateLoaded: false,
  showMessage: (opts) => toaster.show(opts),
});


const ContextProvider: React.FC<Record<never, never>> = function ({ children }) {
  const [state, dispatch, stateLoaded] = usePaneronPersistentStateReducer(
    reducer,
    initialState,
    null,
    'main-window',
  );
  return (
    <Context.Provider value={{ state, dispatch, stateLoaded, showMessage: (opts) => toaster.show(opts) }}>
      {children}
    </Context.Provider>
  );
};

export default ContextProvider;
