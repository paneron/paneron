import path from 'path';
import { app } from 'electron';
import levelup from 'levelup';
import leveldown from 'leveldown';
import encode from 'encoding-down';
import {
  loadState as ipcLoadState,
  storeState as ipcStoreState,
  resetState as ipcResetState,
  resetStateGlobal as ipcResetStateGlobal,
} from './common';


const STATE_STORAGE_PATH = path.join(app.getPath('userData'), 'state');
const stateStorage = levelup(encode(leveldown(STATE_STORAGE_PATH), {
  keyEncoding: 'string',
  valueEncoding: 'json',
}));


export async function loadState<S extends Record<string, any>>
(key: string): Promise<S | undefined> {
  try {
    return await stateStorage.get(key);
  } catch (e) {
    if (e.type === 'NotFoundError') {
      return undefined;
    } else {
      throw e;
    }
  }
}


export async function storeState<S extends Record<string, any>>
(key: string, newState: S) {
  await stateStorage.put(key, newState);
}


export async function resetState(key: string) {
  await stateStorage.del(key);
}


export async function resetStateGlobal() {
  await stateStorage.clear();
}


ipcLoadState.main!.handle(async ({ key }) => {
  return { state: await loadState(key) };
});


ipcStoreState.main!.handle(async ({ key, newState }) => {
  await storeState(key, newState);
  return { success: true };
});


ipcResetState.main!.handle(async ({ key }) => {
  await resetState(key);
  return { success: true };
});


ipcResetStateGlobal.main!.handle(async () => {
  await resetStateGlobal();
  return { success: true };
});
