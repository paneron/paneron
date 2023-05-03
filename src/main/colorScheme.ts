import { nativeTheme } from 'electron';
import { INITIAL_GLOBAL_SETTINGS } from '@riboseinc/paneron-extension-kit/settings';
import { loadState } from '../state/manage';


export async function getEffectiveColorSchemeName(): Promise<string> {
  const settings = await loadState('settings-global');
  return settings?.defaultTheme === null
    ? nativeTheme.shouldUseDarkColors
      ? 'dark'
      : 'light'
    : (settings?.defaultTheme || INITIAL_GLOBAL_SETTINGS.defaultTheme);
}
