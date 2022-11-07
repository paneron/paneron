import type { Menu } from 'electron';


export interface WindowComponentProps {
  query: URLSearchParams;
}

export interface WindowOptions {
  title: string;

  dimensions?: {
    minHeight?: number;
    minWidth?: number;
    height?: number;
    width?: number;
    maxHeight?: number;
    maxWidth?: number;
  };
  frameless?: boolean;
  winParams?: any;
  menu?: Menu;
  ignoreCache?: boolean;
  showWhileLoading?: boolean;
  forceDebug?: boolean;

  /** Used for main window. */
  quitAppOnClose?: true;
}
export interface ComponentWindowSource {
  component: string;
  componentParams?: string;
}
export interface ExternalWindowSource {
  url: string;
}
export type WindowSource = ComponentWindowSource | ExternalWindowSource;
export type WindowOpenerParams = WindowSource & WindowOptions;

export function isComponentWindowSource(source: WindowSource): source is ComponentWindowSource {
  return source.hasOwnProperty('component');
}
export function isExternalWindowSource(source: WindowSource): source is ExternalWindowSource {
  return source.hasOwnProperty('url');
}
