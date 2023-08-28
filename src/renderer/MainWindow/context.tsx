/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/react';
import React from 'react';
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


export const Context = React.createContext<ContextSpec>({
  state: initialState,
  dispatch: () => void 0,
  stateLoaded: false,
  showMessage: (opts) => toaster.show(opts),
  //isBusy: true,
  //performOperation: (_, f) => f,
});


const ContextProvider: React.FC<Record<never, never>> = function ({ children }) {
  // const [_operationKey, setOperationKey] = useState<string | undefined>(undefined);
  // const [_opKeys, setOpKeys] = useState<Map<string, number>>(new Map());

  // function performOperation<P extends any[], R>(gerund: string, func: (...args: P) => Promise<R>) {
  //   return async (...args: P) => {
  //     const opKey = gerund;

  //     setOpKeys(map => map.set(opKey, (map.get(opKey) ?? 0) + 1));

  //     const opCount = _opKeys.get(opKey) ?? 0;

  //     toaster.show({
  //       message: <div css={css`display: flex; flex-flow: row nowrap; white-space: nowrap; align-items: center;`}>
  //         <ProgressBar intent="primary" css={css`width: 50px;`} />
  //         &emsp;
  //         {gerund}{opCount > 1 ? <>&nbsp;({opCount})</> : null}…
  //       </div>,
  //       intent: 'primary',
  //       timeout: 0,
  //     }, gerund);

  //     setOperationKey(opKey);

  //     try {
  //       const result: R = await func(...args);
  //       toaster.dismiss(opKey);
  //       toaster.show({ message: `Done ${gerund}`, intent: 'success', icon: 'tick-circle' });
  //       setOperationKey(undefined);
  //       return result;
  //     } catch (e) {
  //       let errMsg: string;
  //       const rawErrMsg = (e as any).toString?.();
  //       if (rawErrMsg.indexOf('Error:')) {
  //         const msgParts = rawErrMsg.split('Error:');
  //         errMsg = msgParts[msgParts.length - 1].trim();
  //       } else {
  //         errMsg = rawErrMsg;
  //       }
  //       toaster.dismiss(opKey);
  //       toaster.show({
  //         message: `Problem ${gerund}. The error said: “${errMsg}”`,
  //         intent: 'danger',
  //         icon: 'error',
  //         timeout: 0,
  //         onDismiss: () => {
  //           setOperationKey(undefined);
  //         },
  //       });
  //       throw e;
  //     }
  //   }
  // }

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
        //isBusy: _operationKey !== undefined,
        //performOperation,
      }}>
      <OperationQueueContextProvider toaster={toaster}>
        {children}
      </OperationQueueContextProvider>
    </Context.Provider>
  );
};

export default ContextProvider;
