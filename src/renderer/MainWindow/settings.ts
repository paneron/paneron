import {
  INITIAL_GLOBAL_SETTINGS,
  isValidGlobalSettings,
  type Settings,
} from '@riboseinc/paneron-extension-kit/settings';

import { loadState, storeState } from 'state/ipc';


// TODO: Split functions for operating extension-specific settings and global settings
// Reason: we should be strict about global settings type, but ideally avoid
// a mess of generics.


export const GLOBAL_SCOPE = 'global';


export async function getSettings(scope: string): Promise<unknown> {
  const { result}  = await loadState.renderer!.trigger({ key: `settings-${scope}` });
  // Don’t validate non-global settings, we know nothing about them
  return scope !== GLOBAL_SCOPE || isValidGlobalSettings(result.state)
    ? result.state
    : INITIAL_GLOBAL_SETTINGS;
};


export function useSettings<T extends Settings>(scope: string, initial: T) {
  const state = loadState.renderer!.useValue({
    key: `settings-${scope}`,
  }, { state: initial });
  const settings: T =
    state.value.state as (T | undefined)
    ?? initial;
  return {
    ...state,
    value: {
      settings: scope !== GLOBAL_SCOPE || isValidGlobalSettings(settings)
        ? settings
        : INITIAL_GLOBAL_SETTINGS,
    },
  };
};


export async function updateSetting(scope: string, { key, value }: { key: string, value: any }) {
  // Fetch all settings firtst
  const settings = (await loadState.renderer!.trigger({
    key: `settings-${scope}`,
  })).result?.state as (Settings | undefined) ?? {};

  const newSettings = { ...settings, [key]: value };

  if (scope === GLOBAL_SCOPE && !isValidGlobalSettings(newSettings)) {
    try {
      await storeState.renderer!.trigger({
        key: `settings-${scope}`,
        newState: INITIAL_GLOBAL_SETTINGS,
      });
    } finally {
      throw new Error("Unexpected global settings structure obtained. Reset all settings to defaults just in case.");
    }
  }

  // Refresh given setting
  await storeState.renderer!.trigger({
    key: `settings-${scope}`,
    newState: newSettings,
  });

  return { success: true as const };
};
