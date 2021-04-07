/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/core';
import React, { useState } from 'react';
import { Icon, IToastProps, Spinner, Toaster } from '@blueprintjs/core';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import reducer, { initialState, State } from './reducer';
import { Action } from './actions';


const toaster = Toaster.create({ position: 'bottom' });


interface ContextSpec {
  state: State
  dispatch: React.Dispatch<Action> 
  stateLoaded: boolean
  showMessage: (opts: IToastProps) => void
  isBusy: boolean
  performOperation: (gerund: string, func: () => Promise<void>) => void
}


export const Context = React.createContext<ContextSpec>({
  state: initialState,
  dispatch: () => void 0,
  stateLoaded: false,
  showMessage: (opts) => toaster.show(opts),
  isBusy: true,
  performOperation: () => void 0,
});


const ContextProvider: React.FC<Record<never, never>> = function ({ children }) {
  const [_operationKey, setOperationKey] = useState<string | undefined>(undefined);

  async function performOperation(gerund: string, func: () => Promise<void>) {
    const opKey = toaster.show({ message: `${gerund}…`, intent: 'primary', icon: <Spinner size={Icon.SIZE_STANDARD} /> });
    setOperationKey(opKey);
    try {
      await func();
      toaster.dismiss(opKey);
      toaster.show({ message: `Done ${gerund}`, intent: 'success', icon: 'tick-circle' });
      setOperationKey(undefined);
    } catch (e) {
      toaster.dismiss(opKey);
      toaster.show({
        message: `Problem ${gerund}. The error said: “${e.message}”`,
        intent: 'danger',
        icon: 'error',
        timeout: 0,
        action: { text: 'Acknowledge', icon: 'heart-broken' },
        onDismiss: () => {
          setOperationKey(undefined);
        },
      });
    }
  }

  const [state, dispatch, stateLoaded] = usePaneronPersistentStateReducer(
    reducer,
    initialState,
    null,
    'main-window',
  );

  return (
    <Context.Provider value={{
        state,
        dispatch,
        stateLoaded,
        showMessage: (opts) => toaster.show(opts),
        isBusy: _operationKey !== undefined,
        performOperation,
      }}>
      {children}
    </Context.Provider>
  );
};

export default ContextProvider;
