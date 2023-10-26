import type { DiffStatus } from '@riboseinc/paneron-extension-kit/types/changes';
import { objectsHaveSameShape } from '@riboseinc/paneron-extension-kit/util';
import type { Hooks } from '@riboseinc/paneron-extension-kit/types/renderer';
import { API as Datasets } from './types';
import { diffDatasets } from '../repositories/util';


/**
 * Yields paths to buffers that differ between dataset1 and dataset2,
 * and ChangeStatus for each path.
 *
 * Behavior mimics `listDescendantPathsAtVersion()`
 * with `diffOpts.onlyChanged` set to true,
 * i.e. unchanged paths will not be returned.
 *
 * Intended to check for conflicts before committing changes.
 */
export async function* diffObjectDatasets(
  objectPaths: AsyncGenerator<string>,
  readObjects:
    (objectPath: string) =>
      Promise<[
        object1: Record<string, any> | null,
        object2: Record<string, any> | null,
      ]>,
): AsyncGenerator<[ path: string, changeStatus: DiffStatus ]> {
  return diffDatasets<Record<string, any>>(
    objectPaths,
    readObjects,
    objectsHaveSameShape,
  );
}


export function parsePredicateFunction(func: string): Datasets.Util.PredicateFunction {
  return new Function('key', 'value', func) as Datasets.Util.PredicateFunction;
}

export function parseMapReduceChain(
  chainID: string,
  chain: Hooks.Data.MapReduceChain,
): Datasets.Util.MapReduceChain<unknown> {
  let map: Datasets.Util.MapFunction;
  let reduce: Datasets.Util.ReduceFunction | undefined;
  let predicate: Datasets.Util.PredicateFunction | undefined;
  try {
    map = new Function('key', 'value', 'emit', chain.mapFunc) as Datasets.Util.MapFunction;
  } catch (e) {
    //log.error("Unable to parse submitted map function in map-reduce chain", chainID, chain.mapFunc, e);
    throw new Error("Unable to parse submitted map function");
  }
  if (chain.reduceFunc) {
    try {
      reduce = new Function('accumulator', 'value', chain.reduceFunc) as Datasets.Util.ReduceFunction;
    } catch (e) {
      //log.error("Unable to parse submitted reducer function in map-reduce chain", chainID, chain.reduceFunc, e);
      throw new Error("Unable to parse submitted reducer function");
    }
  }
  if (chain.predicateFunc) {
    try {
      predicate = parsePredicateFunction(chain.predicateFunc);
    } catch (e) {
      //log.error("Unable to parse submitted predicate function in map-reduce chain", chainID, chain.predicateFunc, e);
      throw new Error("Unable to parse submitted predicate function");
    }
  }
  return {
    id: chainID,
    map,
    reduce,
    predicate,
  };
}


// /**
//  * Returns `true` if both given objects have identical shape,
//  * disregarding key ordering.
//  *
//  * Only does a shallow check.
//  */
// function objectsAreSame(
//   obj1: Record<string, any>,
//   obj2: Record<string, any>,
// ): boolean {
//   return JSON.stringify(normalizeObject(obj1)) === JSON.stringify(normalizeObject(obj2));
// }
