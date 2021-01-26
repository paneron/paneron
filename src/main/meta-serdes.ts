import yaml from 'js-yaml';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');


export function deserializeMeta<T = Record<string, any>>(data: Uint8Array): T {
  return yaml.load(decoder.decode(data));
}


export function serializeMeta(data: Record<string, any>) {
  return encoder.encode(yaml.dump(data, { noRefs: true }));
}
