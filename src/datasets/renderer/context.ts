import path from 'path';
import log from 'electron-log';
import { useEffect, useState } from 'react';
import { DatasetContext, RendererPlugin } from '@riboseinc/paneron-extension-kit/types';
import { IndexStatus, INITIAL_INDEX_STATUS } from '@riboseinc/paneron-extension-kit/types/indexes';
import { BaseAction, PersistentStateReducerHook } from '@riboseinc/paneron-extension-kit/usePersistentStateReducer';

import { makeRandomID, chooseFileFromFilesystem } from 'common';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import { copyObjects, requestCopiedObjects } from 'clipboard/ipc';

import { DatasetInfo } from '../types';

import {
  describeIndex,
  getFilteredObject,
  getObjectDataset,
  getOrCreateFilteredIndex,
  indexStatusChanged,
  locateFilteredIndexPosition,
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

  return {
    title: datasetInfo.title,

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

    useDecodedBlob: ({ blob }) => {
      return {
        asString: decoder.decode(blob),
      };
    },

    useObjectData: function _useObjectData (opts) {
      const result = getObjectDataset.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { data: {} });
      return result;
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
      return getOrCreateFilteredIndex.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { indexID: undefined });
    },

    useObjectPathFromFilteredIndex: function _useObjectPathFromFilteredIndex (opts) {
      return getFilteredObject.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { objectPath: '' });
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

    usePersistentDatasetStateReducer: function _usePersistentDatasetStateReducer<S, A extends BaseAction>
    (...opts: Parameters<PersistentStateReducerHook<S, A>>) {
      const effectiveOpts: Parameters<PersistentStateReducerHook<S, A>> = [
        opts[0], opts[1], opts[2],

        // opts[3] is the storage key in the list of positional parameters.
        // Extension can specify locally scoped key,
        // and this takes care of additionally scoping it by repository and dataset.
        `${workingCopyPath}/${datasetPath}/${opts[3]}`,

        opts[4],
      ];
      return usePaneronPersistentStateReducer(...effectiveOpts);
    },

    getObjectView,

    getRuntimeNodeModulePath: moduleName =>
      path.join(nodeModulesPath, moduleName),

    makeAbsolutePath: relativeDatasetPath =>
      path.join(workingCopyPath, datasetPath || '', relativeDatasetPath),

    requestFileFromFilesystem: writeAccess
      ? async function  _requestFileFromFilesystem (opts) {
          const result = await chooseFileFromFilesystem.renderer!.trigger(opts);
          if (result.result) {
            return result.result;
          } else {
            log.error("Unable to request file from filesystem", result.errors);
            throw new Error("Unable to request file from filesystem");
          }
        }
      : undefined,

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
