import {
  loadState as ipcLoadState,
  storeState as ipcStoreState,
  resetState as ipcResetState,
  resetStateGlobal as ipcResetStateGlobal,
} from './ipc';
import { loadState, storeState, resetState, resetStateGlobal } from './manage';


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
