import log from 'electron-log';
import { MenuItemConstructorOptions } from 'electron';
import { makeEndpoint, _ } from './ipc';
import * as window from './main/window';


export interface WindowOptions {
  title: string

  dimensions?: {
    minHeight?: number
    minWidth?: number
    height?: number
    width?: number
    maxHeight?: number
    maxWidth?: number
  }
  frameless?: boolean
  winParams?: any
  menuTemplate?: MenuItemConstructorOptions[]
  ignoreCache?: boolean
  showWhileLoading?: boolean
  forceDebug?: boolean
}
export interface ComponentWindowSource {
  component: string
  componentParams?: string
}
export interface ExternalWindowSource {
  url: string
}
export type WindowSource = ComponentWindowSource | ExternalWindowSource
export type WindowOpenerParams = WindowSource & WindowOptions

export function isComponentWindowSource(source: WindowSource): source is ComponentWindowSource {
  return source.hasOwnProperty('component');
}
export function isExternalWindowSource(source: WindowSource): source is ExternalWindowSource {
  return source.hasOwnProperty('url');
}


//export const openWindow = makeEndpoint('open-window', 'main', <WindowOpenerParams>_, <{}>_);

type DefaultImporter<T> = () => Promise<{ default: T | Promise<T> }>;

export interface WindowComponentProps {
  query: URLSearchParams
}

type WindowComponentImporter = DefaultImporter<React.FC<WindowComponentProps>>;

let windowComponents: {
  [key: string]: WindowComponentImporter
} = {}


export function getComponent(key: string) {
  log.debug("Getting component", key, windowComponents);
  return windowComponents[key];
}


export function makeWindowForComponent
(componentName: string, importer: WindowComponentImporter, title: string, opts?: Omit<WindowOptions, 'title'>) {

  type AdHocOptions = {
    title?: string
    componentParams?: string
  } & Omit<WindowOptions, 'title'>;

  if (windowComponents[componentName]) {
    log.error("Attempt to register duplicate component", componentName);
    throw new Error("Attempt to register duplicate window component");
  } else {
    windowComponents[componentName] = importer;
  }

  const endpoint = makeEndpoint.main(
    `open-window-${componentName}`,
    <AdHocOptions>_,
    <{ opened: boolean }>_,
  );

  async function open(extraOpts: AdHocOptions) {
    const effectiveParams: WindowOpenerParams = {
      ...opts,
      component: componentName,
      componentParams: extraOpts.componentParams,
      title: `${title} ${extraOpts.title || ''}`,
    };

    await window.open(effectiveParams);
  }

  if (process.type === 'browser') {
    endpoint.main!.handle(async (opts) => {
      await open(opts);
      return { opened: true };
    });
    return {
      main: {
        open: async (opts?: AdHocOptions) => {
          await open(opts || {});
        },
      },
    };

  } else if (process.type === 'renderer') {
    return {
      renderer: {
        open: async (opts?: AdHocOptions) => {
          return await endpoint.renderer!.trigger(opts || {});
        },
      },
    };

  } else {
    throw new Error("Unsupported process type");

  }
};
