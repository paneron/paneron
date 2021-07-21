import path from 'path';
import * as R from 'ramda';
import log from 'electron-log';
import { useEffect, useState } from 'react';
import { DatasetContext, RendererPlugin } from '@riboseinc/paneron-extension-kit/types';
import { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { IndexStatus, INITIAL_INDEX_STATUS } from '@riboseinc/paneron-extension-kit/types/indexes';
import { BaseAction, PersistentStateReducerHook } from '@riboseinc/paneron-extension-kit/usePersistentStateReducer';

import useTimeTravelingPersistentStateReducer, { TimeTravelingPersistentStateReducerHook } from '@riboseinc/paneron-extension-kit/useTimeTravelingPersistentStateReducer';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';

import { makeRandomID, chooseFileFromFilesystem, saveFileToFilesystem } from 'common';
import { copyObjects, requestCopiedObjects } from 'clipboard/ipc';

import { DatasetInfo } from '../types';

import {
  describeIndex,
  filteredIndexUpdated,
  getFilteredObject,
  getObjectDataset,
  getOrCreateFilteredIndex,
  indexStatusChanged,
  locateFilteredIndexPosition,
  objectsChanged,
  updateObjects,
} from '../ipc';


export interface ContextGetterProps {
  nodeModulesPath: string
  writeAccess: boolean
  workingCopyPath: string
  datasetPath: string
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
    datasetPath,
    datasetInfo,
    getObjectView,
  } = opts;

  const datasetParams = {
    workingCopyPath,
    datasetPath,
  };

  function usePersistentDatasetStateReducer<S, A extends BaseAction>
  (...opts: Parameters<PersistentStateReducerHook<S, A>>) {
    const effectiveOpts: Parameters<PersistentStateReducerHook<S, A>> = [
      // opts[0] is the storage key in the list of positional parameters.
      // Extension code should specify locally scoped key,
      // and this takes care of additionally scoping it by repository and dataset.
      `${workingCopyPath}/${datasetPath}/${opts[0]}`,

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
      `${workingCopyPath}/${datasetPath}/${opts[2]}`,

      opts[3], opts[4],

      opts[5], opts[6], opts[7],
    ];
    return useTimeTravelingPersistentStateReducer(...effectiveOpts);
  }

  return {
    title: datasetInfo.title,

    logger: {
      log: log.log,
    },

    copyObjects: async (dataset) => {
      await copyObjects.renderer!.trigger({
        workDir: workingCopyPath,
        datasetDir: datasetPath,
        objects: dataset,
      });
    },

    requestCopiedObjects: async () => {
      const { result, errors } = await requestCopiedObjects.renderer!.trigger({});
      if (result) {
        return result;
      } else {
        log.error("Failed to request copied objects, errors were:", errors.join('; '));
        throw new Error("Failed to request copied objects");
      }
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

      objectsChanged.renderer!.handle(async ({ workingCopyPath, datasetPath, objects }) => {
        if (workingCopyPath === datasetParams.workingCopyPath && datasetPath === datasetParams.datasetPath && (objects === undefined || R.intersection(Object.keys(objects), opts.objectPaths).length > 0)) {
          result.refresh();
        }
      });

      return result;
    },

    getObjectData: async function _getObjectData(opts) {
      const resp = await getObjectDataset.renderer!.trigger({
        ...datasetParams,
        ...opts,
      });

      if (resp.result) {
        return resp.result;
      } else {
        log.error("Unable to get object data", opts, resp.result, resp.errors);
        throw new Error("Unable to get object data");
      }
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
          datasetPath === evt.datasetPath &&
          indexID === evt.indexID
        ) {
          setStatus(evt.status);
          //result.refresh();
        }
      }, [workingCopyPath, datasetPath, indexID]);

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

      filteredIndexUpdated.renderer!.useEvent(async ({ workingCopyPath, datasetPath, indexID }) => {
        if (resp.value.indexID === indexID && workingCopyPath === datasetParams.workingCopyPath && datasetPath === datasetParams.datasetPath) {
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

      filteredIndexUpdated.renderer!.useEvent(async ({ workingCopyPath, datasetPath, indexID }) => {
        if (opts.indexID === indexID && workingCopyPath === datasetParams.workingCopyPath && datasetPath === datasetParams.datasetPath) {
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

    makeAbsolutePath: relativeDatasetPath =>
      path.join(workingCopyPath, datasetPath || '', relativeDatasetPath),

    requestFileFromFilesystem:  async function  _requestFileFromFilesystem (opts, callback?: (data: BufferDataset) => void) {
      const result = await chooseFileFromFilesystem.renderer!.trigger(opts);
      if (result.result) {
        log.info("Requested file from filesystem", opts, result);
        if (callback) {
          callback(result.result);
        }
        return result.result;
      } else {
        log.error("Unable to request file from filesystem", opts, result.errors);
        throw new Error("Unable to request file from filesystem");
      }
    },

    writeFileToFilesystem: async function _writeFileToFilesystem (opts) {
      const result = await saveFileToFilesystem.renderer!.trigger(opts);
      if (result.result) {
        return result.result;
      } else {
        log.error("Unable to save file to filesystem", opts.dialogOpts, result.errors);
        throw new Error("Unable to save file to filesystem");
      }
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
          if (result.result) {
            return result.result;
          } else {
            log.error("Unable to change objects", result.errors)
            throw new Error("Unable to change objects");
          }
        }
      : undefined,
  }
}
