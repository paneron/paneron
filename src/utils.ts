import crypto from 'crypto';


export function forceSlug(val: string): string {
  return val.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');
}


export function stripLeadingSlash(aPath: string): string {
  return aPath.replace(/^\//, '');
}


export function stripTrailingSlash(aPath: string): string {
  return aPath.replace(/\/$/, '');
}


export function hash(val: string): string {
  return crypto.createHash('sha1').update(val).digest('hex');
}


export function toJSONPreservingUndefined(data: any) {
  return (JSON.
    stringify(
      data || {},
      (_, v) => (v === undefined) ? '__undefined' : v).
    replace(/\"__undefined\"/g, 'undefined'));
}
