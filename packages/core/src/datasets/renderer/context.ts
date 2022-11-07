import path from 'path';
import * as R from 'ramda';
import log from 'electron-log';
import { useEffect, useState } from 'react';

import { DatasetContext, RendererPlugin } from '@riboseinc/paneron-extension-kit/types';
import { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { IndexStatus, INITIAL_INDEX_STATUS } from '@riboseinc/paneron-extension-kit/types/indexes';
import { INITIAL_GLOBAL_SETTINGS } from '@riboseinc/paneron-extension-kit/settings';
import { BaseAction, PersistentStateReducerHook } from '@riboseinc/paneron-extension-kit/usePersistentStateReducer';
import useTimeTravelingPersistentStateReducer, { TimeTravelingPersistentStateReducerHook } from '@riboseinc/paneron-extension-kit/useTimeTravelingPersistentStateReducer';

import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import { makeRandomID, chooseFileFromFilesystem, saveFileToFilesystem, openExternalURL } from 'common';
import { copyObjects, requestCopiedObjects } from 'clipboard/ipc';
import { describeBundledExecutable, describeSubprocess, execBundled, subprocessEvent } from 'subprocesses';
import { SOLE_DATASET_ID } from 'repositories/types';
import { describeRepository } from 'repositories/ipc';
import { updateSetting, useSettings } from 'renderer/MainWindow/settings';

import { DatasetInfo } from '../types';

import {
  addFromFilesystem,
  describeIndex,
  filteredIndexUpdated,
  getFilteredObject,
  getObjectDataset,
  getOrCreateFilteredIndex,
  indexStatusChanged,
  locateFilteredIndexPosition,
  objectsChanged,
  updateObjects,
  updateSubtree,
} from '../ipc';


export interface ContextGetterProps {
  nodeModulesPath: string
  writeAccess: boolean
  workingCopyPath: string
  datasetID: string
  datasetInfo: DatasetInfo
  getObjectView: RendererPlugin["getObjectView"]
}


const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();


export function getContext(opts: ContextGetterProps): DatasetContext {
  const {
    nodeModulesPath,
    writeAccess,
    workingCopyPath,
    datasetID,
    datasetInfo,
    getObjectView,
  } = opts;

  const datasetParams = {
    workingCopyPath,
    datasetID,
  };

  function usePersistentDatasetStateReducer<S, A extends BaseAction>
  (...opts: Parameters<PersistentStateReducerHook<S, A>>) {
    const effectiveOpts: Parameters<PersistentStateReducerHook<S, A>> = [
      // opts[0] is the storage key in the list of positional parameters.
      // Extension code should specify locally scoped key,
      // and this takes care of additionally scoping it by repository and dataset.
      `${workingCopyPath}/${datasetID}/${opts[0]}`,

      opts[1], opts[2],

      opts[3], opts[4], opts[5],
    ];
    return usePaneronPersistentStateReducer(...effectiveOpts);
  }

  function useTimeTravelingPersistentDatasetStateReducer<S, A extends BaseAction>
  (...opts: Parameters<TimeTravelingPersistentStateReducerHook<S, A>>) {
    const effectiveOpts: Parameters<TimeTravelingPersistentStateReducerHook<S, A>> = [
      opts[0], opts[1],

      // opts[2] is the storage key in the list of positional parameters.
      // Extension code should specify locally scoped key,
      // and this takes care of additionally scoping it by repository and dataset.
      `${workingCopyPath}/${datasetID}/${opts[2]}`,

      opts[3], opts[4],

      opts[5], opts[6], opts[7],
    ];
    return useTimeTravelingPersistentStateReducer(...effectiveOpts);
  }

  const EXT_SETTINGS_SCOPE = `${workingCopyPath}-${datasetID}`;

  function resolvePath(datasetRelativePath: string) {
    if (datasetID === SOLE_DATASET_ID) {
      return path.join(workingCopyPath, datasetRelativePath);
    } else {
      return path.join(workingCopyPath, datasetID, datasetRelativePath);
    }
  }

  return {
    title: datasetInfo.title,

    logger: log,

    openExternalLink: async ({ uri }) => {
      await openExternalURL.renderer!.trigger({
        url: uri,
      });
    },

    useSettings: () => {
      return useSettings(EXT_SETTINGS_SCOPE, {});
    },

    useGlobalSettings: () => {
      return useSettings('global', INITIAL_GLOBAL_SETTINGS);
    },

    performOperation: <P>() => async () => (void 0) as unknown as P,

    updateSetting: async ({ key, value }) => {
      return await updateSetting(EXT_SETTINGS_SCOPE, { key, value });
    },

    useRemoteUsername: () => {
      const resp = describeRepository.renderer!.useValue(
        { workingCopyPath },
        { info: { gitMeta: { workingCopyPath, mainBranch: '' } }, isLoaded: false },
      );
      const username = resp.value.info.gitMeta.remote?.username;
      const value = username ? { username } : {};
      return {
        ...resp,
        value,
      };
    },

    copyObjects: async (dataset) => {
      await copyObjects.renderer!.trigger({
        workDir: workingCopyPath,
        datasetDir: datasetID,
        objects: dataset,
      });
    },

    requestCopiedObjects: async () => {
      const { result } = await requestCopiedObjects.renderer!.trigger({});
      return result;
    },

    // NOTE: Confusingly named? Not truly a hook
    useDecodedBlob: ({ blob }) => {
      return {
        asString: decoder.decode(blob),
      };
    },

    getBlob: async (val) => encoder.encode(val),

    useObjectData: function _useObjectData (opts) {
      const result = getObjectDataset.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { data: {} });

      objectsChanged.renderer!.useEvent(async ({ workingCopyPath, datasetID, objects }) => {
        if (workingCopyPath === datasetParams.workingCopyPath && datasetID === datasetParams.datasetID && (objects === undefined || R.intersection(Object.keys(objects), opts.objectPaths).length > 0)) {
          result.refresh();
        }
      }, [workingCopyPath, datasetID, JSON.stringify(opts.objectPaths)]);

      return result;
    },

    getObjectData: async function _getObjectData(opts) {
      const resp = await getObjectDataset.renderer!.trigger({
        ...datasetParams,
        ...opts,
      });

      return resp.result;
    },

    useIndexDescription: function _useIndexDescription (opts) {
      const { indexID } = opts;

      const [status, setStatus] = useState<IndexStatus>(INITIAL_INDEX_STATUS);

      const result = describeIndex.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { status: INITIAL_INDEX_STATUS });

      useEffect(() => {
        setStatus(result.value.status);
      }, [result.value.status]);

      indexStatusChanged.renderer!.useEvent(async (evt) => {
        if (
          workingCopyPath === evt.workingCopyPath &&
          datasetID === evt.datasetID &&
          indexID === evt.indexID
        ) {
          setStatus(evt.status);
          //result.refresh();
        }
      }, [workingCopyPath, datasetID, indexID]);

      return {
        ...result,
        value: {
          ...result.value,
          status,
        },
      };
    },

    useFilteredIndex: function _useFilteredIndex (opts) {
      const resp = getOrCreateFilteredIndex.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { indexID: undefined });

      filteredIndexUpdated.renderer!.useEvent(async ({ workingCopyPath, datasetID, indexID }) => {
        if (resp.value.indexID === indexID && workingCopyPath === datasetParams.workingCopyPath && datasetID === datasetParams.datasetID) {
          resp.refresh();
        }
      }, [opts.queryExpression]);

      return resp;
    },

    useObjectPathFromFilteredIndex: function _useObjectPathFromFilteredIndex (opts) {
      const resp = getFilteredObject.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { objectPath: '' });

      filteredIndexUpdated.renderer!.useEvent(async ({ workingCopyPath, datasetID, indexID }) => {
        if (opts.indexID === indexID && workingCopyPath === datasetParams.workingCopyPath && datasetID === datasetParams.datasetID) {
          resp.refresh();
        }
      }, [opts.indexID, opts.position]);

      return resp;
    },

    getObjectPathFromFilteredIndex: async (opts) => {
      const result = (await getFilteredObject.renderer!.trigger({
        ...datasetParams,
        ...opts,
      })).result;
      if (result) {
        return result;
      } else {
        throw new Error("Unable to retrieve object path from filtered index");
      }
    },

    useFilteredIndexPosition: function _useFilteredIndexPosition (opts) {
      return locateFilteredIndexPosition.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { position: null });
    },

    getFilteredIndexPosition: async (opts) => {
      const result = (await locateFilteredIndexPosition.renderer!.trigger({
        ...datasetParams,
        ...opts,
      })).result;
      if (result) {
        return result;
      } else {
        throw new Error("Unable to retrieve index position from given object path");
      }
    },

    usePersistentDatasetStateReducer,
    useTimeTravelingPersistentDatasetStateReducer,

    getObjectView,

    getRuntimeNodeModulePath: moduleName =>
      path.join(nodeModulesPath, moduleName),

    makeAbsolutePath: relativeDatasetPath => {
      return resolvePath(relativeDatasetPath);
    },

    // TODO: Support LFS with absolute paths.
    // useAbsolutePath: async (relativeDatasetPath) => {
    //   const { result } = await getAbsoluteBufferPath.renderer!.trigger({
    //     workingCopyPath,
    //     bufferPath: resolvePath(relativeDatasetPath),
    //   });
    //   if (result) {
    //     return result.absolutePath;
    //   } else {
    //     throw new Error("Unable to resolve absolute path");
    //   }
    // },

    requestFileFromFilesystem:  async function  _requestFileFromFilesystem (opts, callback?: (data: ObjectDataset) => void) {
      const resp = await chooseFileFromFilesystem.renderer!.trigger(opts);
      log.info("Requested file from filesystem", opts, resp);
      if (callback) {
        callback(resp.result);
      }
      return resp.result;
    },

    writeFileToFilesystem: async function _writeFileToFilesystem (opts) {
      const { result } = await saveFileToFilesystem.renderer!.trigger(opts);
      return result;
    },

    addFromFilesystem: async function _addFromFilesystem (dialogOpts, commitMessage, targetPath, opts) {
      const { result } = await addFromFilesystem.renderer!.trigger({
        ...datasetParams,
        dialogOpts,
        commitMessage,
        targetPath,
        opts,
      });
      return result;
    },

    makeRandomID: writeAccess
      ? async function _makeRandomID () {
          const id = (await makeRandomID.renderer!.trigger({})).result?.id;
          if (!id) {
            throw new Error("Unable to obtain a random ID");
          }
          return id;
        }
      : undefined,

    updateObjects: writeAccess
      ? async function _updateObjects (opts) {
          const result = (await updateObjects.renderer!.trigger({
            ...datasetParams,
            ...opts,
          }));
          return result.result;
        }
      : undefined,

    updateTree: writeAccess
      ? async function _updateSubtree (opts) {
          const result = (await updateSubtree.renderer!.trigger({
            ...datasetParams,
            ...opts,
          }));
          return result.result;
        }
      : undefined,

    invokeMetanorma: async function _invokeMetanorma ({ cliArgs }) {
      await describeBundledExecutable.renderer!.trigger({ name: METANORMA_BINARY_NAME });
      const { result: subprocessDescription } = await execBundled.renderer!.trigger({
        id: METANORMA_SUBPROCESS_TRACKING_ID,
        opts: {
          binaryName: METANORMA_BINARY_NAME,
          cliArgs,
        }
      });
      return subprocessDescription;
    },

    useMetanormaInvocationStatus: function _useMetanormaInvocationStatus () {
      //const [desc, updateDesc] = useState<SubprocessDescription | null>(null);
      const desc = describeSubprocess.renderer!.useValue({ id: METANORMA_SUBPROCESS_TRACKING_ID }, {
        pid: -1,
        opts: {
          binaryName: METANORMA_BINARY_NAME,
          cliArgs: [],
        },
        stdout: '',
        stderr: '',
      });

      subprocessEvent.renderer!.useEvent(async (evt) => {
        if (evt.id !== METANORMA_SUBPROCESS_TRACKING_ID) {
          return;
        } else {
          desc.refresh();
        }
      }, [desc.value.pid]);

      return {
        ...desc,
        value: desc.value.pid >= 0 ? desc.value : null,
      }
    },
  }
}

const METANORMA_SUBPROCESS_TRACKING_ID = 'metanorma';
const METANORMA_BINARY_NAME = 'metanorma';
