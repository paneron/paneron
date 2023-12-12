/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/react';
import React, { memo, useMemo } from 'react';
import { type ToastProps, Toaster } from '@blueprintjs/core';
import OperationQueueContextProvider from '@riboseinc/paneron-extension-kit/widgets/OperationQueue/index';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import reducer, { initialState, type State } from './reducer';
import type { Action } from './actions';


const toaster = Toaster.create({ position: 'bottom' });


interface ContextSpec {
  state: State
  dispatch: React.Dispatch<Action>
  stateLoaded: boolean
  showMessage: (opts: ToastProps) => void
}


/** `MainWindow` state (repo, dataset) and action dispatch. */
export const Context = React.createContext<ContextSpec>({
  state: initialState,
  dispatch: () => void 0,
  stateLoaded: false,
  showMessage: toaster.show,
});



/**
 * Provides `MainWindow`’s context, along with `OperationQueueContext`.
 * Uses persistent state reducer hook to persist state.
 */
const ContextProvider: React.FC<Record<never, never>> = memo(function ({ children }) {
  const [state, dispatch, stateLoaded] = usePaneronPersistentStateReducer(
    'main-window',
    undefined,
    undefined,
    reducer,
    initialState,
    null,
  );

  const ctx: ContextSpec = useMemo(() => ({
    state,
    dispatch,
    stateLoaded,
    showMessage: toaster.show,
  }), [state, stateLoaded, dispatch]);

  return (
    <Context.Provider value={ctx}>
      <OperationQueueContextProvider>
        {children}
      </OperationQueueContextProvider>
    </Context.Provider>
  );
});

export default ContextProvider;
