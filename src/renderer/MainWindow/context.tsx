/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/react';
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
  performOperation: <R>(gerund: string, func: () => Promise<R>) => () => Promise<R>
}


export const Context = React.createContext<ContextSpec>({
  state: initialState,
  dispatch: () => void 0,
  stateLoaded: false,
  showMessage: (opts) => toaster.show(opts),
  isBusy: true,
  performOperation: (_, f) => f,
});


const ContextProvider: React.FC<Record<never, never>> = function ({ children }) {
  const [_operationKey, setOperationKey] = useState<string | undefined>(undefined);

  function performOperation<R>(gerund: string, func: () => Promise<R>) {
    return async () => {
      const opKey = toaster.show({
        message: `${gerund}…`,
        intent: 'primary',
        icon: <Spinner size={Icon.SIZE_STANDARD} />,
        timeout: 0,
      });
      setOperationKey(opKey);
      try {
        const result: R = await func();
        toaster.dismiss(opKey);
        toaster.show({ message: `Done ${gerund}`, intent: 'success', icon: 'tick-circle' });
        setOperationKey(undefined);
        return result;
      } catch (e) {
        let errMsg: string;
        if (e.message.indexOf('Error:')) {
          const msgParts = e.message.split('Error:');
          errMsg = msgParts[msgParts.length - 1].trim();
        } else {
          errMsg = e.message;
        }
        toaster.dismiss(opKey);
        toaster.show({
          message: `Problem ${gerund}. The error said: “${errMsg}”`,
          intent: 'danger',
          icon: 'error',
          timeout: 0,
          onDismiss: () => {
            setOperationKey(undefined);
          },
        });
        throw e;
      }
    }
  }

  const [state, dispatch, stateLoaded] = usePaneronPersistentStateReducer(
    'main-window',
    undefined,
    undefined,
    reducer,
    initialState,
    null,
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
