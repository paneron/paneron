import { Settings } from '@riboseinc/paneron-extension-kit/settings';
import { loadState, storeState } from 'state/ipc';

export function useSettings<T extends Settings>(scope: string, initial: T) {
  const state = loadState.renderer!.useValue({
    key: `settings-${scope}`,
  }, { state: initial });
  const settings: T =
    state.value.state as (T | undefined)
    ?? initial;
  return {
    ...state,
    value: { settings },
  };
};

export async function updateSetting(scope: string, { key, value }: { key: string, value: any }) {
  // Fetch all settings firtst
  const settings = (await loadState.renderer!.trigger({
    key: `settings-${scope}`,
  })).result?.state as (Settings | undefined) ?? {};

  // Refresh given setting
  await storeState.renderer!.trigger({
    key: `settings-${scope}`,
    newState: { ...settings, [key]: value },
  });

  return { success: true as const };
};
