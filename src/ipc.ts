import { ipcMain, IpcRendererEvent, IpcMainInvokeEvent, ipcRenderer } from 'electron';
import log from 'electron-log';
import { useEffect, useState } from 'react';
import { toJSONPreservingUndefined } from './utils';
import { hash } from './main/utils';
import { notifyAll, notifyWithTitle } from './window/main';


// TODO: No need to segregate them by process type here?
let endpointsRegistered: { [key in Exclude<typeof process.type, 'worker'>]: string[] } = {
  'browser': [],
  'renderer': [],
};


const LOG_PAYLOAD_SLICE: number = 256;


type EndpointMaker = {
  /**
   * Creates a “main endpoint”,
   * which must have one (!) handler in the main thread, and which can be invoked from renderer threads
   * (e.g., in response to user actions or GUI state change).
   */
  main:
    <I extends Payload, O extends Payload>
    (name: string, requestPayload: I, responsePayload: O) =>
    MainEndpoint<I, O>

  /**
   * Creates a “renderer endpoint”,
   * which can have many handlers across renderers, and which can be invoked the from main thread
   * (e.g., to notify the GUI about some change in data).
   */
  renderer: <I extends Payload>(name: string, payload: I) => RendererEndpoint<I>
}

export type EmptyPayload = Record<never, never>;

type Payload = Record<string, any>;

type BoundHandler = {
  /**
   * Make sure to call this to avoid runaway listener accumulation,
   * unless you know that this handler will persist until application quits.
   */
  destroy: () => void
}


/** Main endpoint handler is expected to return something to the renderer which triggered it. */
export type MainHandler<I extends Payload, O extends Payload> = (params: I) => Promise<O>;

export type MainEndpointResponse<O extends Payload> = {
  result: O
  payloadHash: string
}

/** A wrapper for Electron IPC endpoint with handler in the main thread. */
type MainEndpoint<I extends Payload, O extends Payload> = {
  /** Guaranteed to be available in main thread, so you can use the `!` assertion. Never use in renderer. */
  main: {
    /**
     * Associates an asynchronous function as the main-thread handler for this endpoint.
     * Define only one handler per endpoint.
     *
     * NOTE: Always clean up the handler by calling `handler.destroy()`.
     */
    handle: (handler: MainHandler<I, O>) => BoundHandler
  }
  renderer?: never
} | {
  /**
   * Guaranteed to be available in renderer thread, so you can use the `!` assertion. Never use in main.
   */
  renderer: {
    /**
     * Calls endpoint handler on the main side. Use for data-modifying calls, or one-off data queries.
     */
    trigger: (payload: I) => Promise<MainEndpointResponse<O>>

    /**
     * A hook that takes a payload and provides the result supplied by main handler.
     * Used for idempotent requests, like querying data.
     * Calls main thread again whenever payload changes.
     * 
     * NOTE: Don’t use this method if the function can modify data.
     */
    useValue: (payload: I, initialValue: O) => {
      value: O
      errors: string[]
      isUpdating: boolean
      refresh: () => void
      _reqCounter: number
    }
  }
  main?: never
}


/** Renderer endpoint handler function. Not expected to return anything back to main thread. */
export type RendererHandler<I extends Payload> = (params: I) => Promise<void> | void;

/** A wrapper for Electron IPC endpoint with handler in the renderer thread. */
type RendererEndpoint<I extends Payload> = {
  /** Guaranteed to be available in main thread, so you can use the `!` assertion. Never use in renderer. */
  main: {
    /**
     * Notifies any handlers subscribed to this endpoint on the renderer side.
     * Optionally allows to only notify windows with specified title
     * (however, this may be deprecated in future).
     */
    trigger: (payload: I, forWindowWithTitle?: string) => Promise<void>
  }
  renderer?: never
} | {
  /** Guaranteed to be available in renderer thread, so you can use the `!` assertion. Never use in main. */
  renderer: {
    /**
     * React hook that allows to subscribe to notifications from main.
     * If component is destroyed, or if any of `memoizedArgs` changes, listener is removed,
     * so you don’t have to do this manually.
     */
    useEvent: (handler: RendererHandler<I>, memoizedArgs: any[]) => void

    /**
     * Defines an async handler function, which will fire any time main thread invokes this endpoint.
     *
     * NOTE: Always clean up the handler by calling `handler.destroy()`.
     */
    handle: (handler: RendererHandler<I>) => BoundHandler
  }
  main?: never
}


/**
 * Placeholder for inferred generic type arguments.
 * See `makeEndpoint`’s docs for example usage.
 * Approach suggested by https://medium.com/@nandiinbao/partial-type-argument-inference-in-typescript-and-workarounds-for-it-d7c772788b2e
 */
export const _ = <unknown>null;


/**
 * Factory functions for creating _endpoints_
 * that attempt to make interactions with Electron IPC across threads in a type-safe manner
 * and provide convenience React-compatible hooks.
 *
 * The code that creates these endpoints should be separated into a shared module
 * (i.e., it’ll be imported and called in both renderer and main thread).
 * 
 * The code that calls methods on these endpoints
 * to set up listeners (handlers) or to trigger them,
 * however, must be split into thread-specific files.
 * 
 * ### Example of creating & using a main-side endpoint:
 * 
 * (For a renderer-side endpoint, it’s more or less the reverse.)
 *
 * Defining endpoint (will be imported in both threads later):
 * 
 * ```typescript
 *   // shared-ipc.ts
 *   import { _, makeEndpoint } from 'ipc'
 *   export const doSomething = makeEndpoint.main(
 *     'do-something',
 *     <{ foo: string }>_,
 *     <{ bar: number }>_)
 * ```
 * 
 * Defining the handler:
 *
 * ```typescript
 *   // main/some-file.ts
 *   import { doSomething } from 'shared-ipc'
 *   doSomething.main!.handle(async (payload) => {
 *     // Here, type of `payload` is known to be `{ foo: string }`,
 *     // and TS will warn you if you don’t return `{ bar: number }`
 *     return { bar: 123 };
 *   })
 * ```
 *
 * Triggering in renderer:
 * 
 * ```typescript
 *   // renderer/some-file.ts
 *   import { doSomething } from 'shared-ipc'
 *   async function handleClick() {
 *     // TS will warn you if you don’t pass `{ foo: string }`
 *     const result = await doSomething.renderer!.trigger({ foo: 'hello world' })
 *     // Here, the type of `result` is known to be `{ bar: number }`
 *   }
 * ```
 */
export const makeEndpoint: EndpointMaker = {

  main: <I extends Payload, O extends Payload>(name: string, _: I, __: O): MainEndpoint<I, O> => {

    if (process.type === 'worker') {
      throw new Error("Unsupported process type");
    } else if (endpointsRegistered[process.type].indexOf(name) >= 0) {
      log.error("Attempt to register duplicate endpoint with name", name, process.type);
      throw new Error("Attempt to register duplicate endpoint");
    } else {
      endpointsRegistered[process.type].push(name);
    }

    if (process.type === 'browser') {
      return {
        main: {
          handle: (handler): BoundHandler => {
            // NOTE: only one handler on main thread side is supported per endpoint.
            // Calling someEndpoint.main.handle(...) again will silently replace existing handler, if any.

            async function _handler(_: IpcMainInvokeEvent, payload: I):
            Promise<MainEndpointResponse<O>> {
              let result: O | undefined;

              result = await handler(payload);

              const payloadSnapshot = toJSONPreservingUndefined(payload);

              return { result, payloadHash: hash(payloadSnapshot) };
            }

            ipcMain.removeHandler(name);
            ipcMain.handle(name, _handler);

            return {
              destroy: () => {
                // NOTE: Electron does not allow to remove a specific handler,
                // only clearing all handlers for given endpoint
                ipcMain.removeHandler(name);
              },
            };
          },
        },
      };

    } else if (process.type === 'renderer') {
      return {
        renderer: {
          trigger: async (payload: I): Promise<MainEndpointResponse<O>> => {
            const result: MainEndpointResponse<O> = await ipcRenderer.invoke(name, payload);
            return result;
          },
          useValue: (payload: I, initialValue: O) => {
            const [value, updateValue] = useState(initialValue);
            const [errors, updateErrors] = useState<string[]>([]);
            const [isUpdating, setUpdating] = useState(true);

            const [reqCounter, updateReqCounter] = useState(0);

            const payloadSnapshot = toJSONPreservingUndefined(payload);
            const payloadHash = hash(payloadSnapshot);
            const payloadSliceToLog = payloadSnapshot.slice(0, LOG_PAYLOAD_SLICE);

            useEffect(() => {
              let cancelled = false;

              async function doQuery() {
                setUpdating(true);

                try {
                  //log.debug("IPC: Invoking", name, payloadSliceToLog);
                  const maybeResp = await ipcRenderer.invoke(name, payload);

                  if (cancelled) { return; }

                  if (maybeResp.result) {
                    const resp = maybeResp as MainEndpointResponse<O>;

                    if (resp.payloadHash !== payloadHash) {
                      log.warn("IPC: Received payload hash differs from original",
                        name,
                        payloadSliceToLog,
                        payloadHash,
                        resp.payloadHash);
                    }

                    updateErrors([]);
                    updateValue(resp.result);
                    //log.debug("IPC: Got result", name, resp.result);
                  } else {
                    log.error("IPC: Improperly structured main IPC response; returning the entire value", maybeResp);
                    updateErrors(["Invalid IPC response"]);
                    // Consider updateErrors()?
                    //updateValue(maybeResp as O);
                  }
                } catch (e) {
                  if (cancelled) { return; }
                  log.error("IPC: Failed to invoke method", name, payloadSliceToLog, e);
                  updateErrors([(e as any).toString?.() ?? `${e}`]);
                  updateValue(initialValue);
                } finally {
                  if (cancelled) { return; }
                  setUpdating(false);
                }
              };

              //log.debug("IPC: Querying", name, payloadSliceToLog);
              doQuery();

              return function cleanUp() { cancelled = true; };

            }, [name, reqCounter, payloadHash]);

            return {
              value,
              errors,
              isUpdating,
              refresh: () => updateReqCounter(counter => { return counter += 1 }),
              _reqCounter: reqCounter,
            };
          },
        },
      };

    } else {
      throw new Error("Unsupported process type");
    }
  },

  renderer: <I extends Payload>(name: string, _: I): RendererEndpoint<I> => {

    if (process.type === 'worker') {
      throw new Error("Unsupported process type");
    } else if (endpointsRegistered[process.type].indexOf(name) >= 0) {
      log.error("Attempt to register duplicate endpoint with name", name, process.type);
      throw new Error("Attempt to register duplicate endpoint");
    } else {
      endpointsRegistered[process.type].push(name);
    }

    if (process.type === 'renderer') {
      return {
        renderer: {
          handle: (handler) => {
            async function _handler(_: IpcRendererEvent, payload: I): Promise<void> {
              await handler(payload);
            }

            ipcRenderer.on(name, _handler);

            return {
              destroy: () => {
                ipcRenderer.removeListener(name, _handler);
              },
            };
          },
          useEvent: (handler, memoizedArgs) => {
            function handleEvent(_: IpcRendererEvent, payload: I) {
              //log.silly("C/ipc/useIPCEvent: Handling IPC event", name, payload);
              handler(payload);
            }

            useEffect(() => {
              ipcRenderer.on(name, handleEvent);

              return function cleanup() {
                ipcRenderer.removeListener(name, handleEvent);
              }
            }, memoizedArgs);
          }
        },
      };

    } else if (process.type === 'browser') {
      return {
        main: {
          trigger: async (payload, forWindowWithTitle) => {
            if (forWindowWithTitle) {
              await notifyWithTitle(forWindowWithTitle, name, payload);
            } else {
              await notifyAll(name, payload);
            }
          },
        },
      };

    } else {
      throw new Error("Unsupported process type");
    }
  },
};
