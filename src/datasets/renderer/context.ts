import path from 'path';
import log from 'electron-log';
import { DatasetContext, RendererPlugin } from '@riboseinc/paneron-extension-kit/types';
import { INITIAL_INDEX_STATUS } from '@riboseinc/paneron-extension-kit/types/indexes';
import { DatasetInfo } from 'datasets/types';

import {
  makeRandomID,
  chooseFileFromFilesystem,
} from 'common';

import {
  copyObjects,
  requestCopiedObjects,
} from '../../clipboard';

import {
  describeIndex,
  getFilteredObject,
  getObjectDataset,
  getOrCreateFilteredIndex,
  indexStatusChanged,
  updateObjects,
} from 'datasets';


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
      }, { indexID: undefined });
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
