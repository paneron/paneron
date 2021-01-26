import path from 'path';
import log from 'electron-log';
import { DatasetContext, RendererPlugin } from '@riboseinc/paneron-extension-kit/types';
import { INITIAL_INDEX_STATUS } from '@riboseinc/paneron-extension-kit/context';
import { DatasetInfo } from 'datasets/types';

import { makeRandomID, chooseFileFromFilesystem } from 'common';

import {
  describeIndex,
  getFilteredObject,
  getObjectDataset,
  getOrCreateFilteredIndex,
  indexStatusChanged,
  updateObjects,
} from 'datasets';


export interface ContextGetterProps {
  writeAccess: boolean
  nodeModulesPath: string
  workingCopyPath: string
  datasetPath: string
  datasetInfo: DatasetInfo
  getObjectView: RendererPlugin["getObjectView"]
}


const decoder = new TextDecoder('utf-8');


export function getContext(opts: ContextGetterProps): DatasetContext {
  const {
    writeAccess,
    workingCopyPath,
    nodeModulesPath,
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
      const result = describeIndex.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { status: INITIAL_INDEX_STATUS });

      indexStatusChanged.renderer!.useEvent(async (evt) => {
        if (
          workingCopyPath === evt.workingCopyPath &&
          datasetPath === evt.datasetPath &&
          indexID === evt.indexID
        ) {
          result.refresh();
        }
      }, []);

      return result;
    },

    useFilteredIndex: function _useFilteredIndex (opts) {
      return getOrCreateFilteredIndex.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { indexID: '' });
    },

    useObjectPathFromFilteredIndex: function _useObjectPathFromFilteredIndex (opts) {
      return getFilteredObject.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { objectPath: '' });
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
