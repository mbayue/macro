import { lookup } from 'node:dns/promises';
import { isBlockedIp } from '../../proxy/ip.ts';

export type LookupAllFn = (hostname: string) => Promise<readonly { address: string }[]>;

const defaultLookup: LookupAllFn = (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Resolve `hostname` and return true only when every returned address is a public
 * IP (not private, loopback, link-local, metadata, or special-use per `isBlockedIp`).
 */
export async function isPublicHost(hostname: string, lookupFn?: LookupAllFn): Promise<boolean> {
  const resolve = lookupFn ?? defaultLookup;
  let addrs: readonly { address: string }[];
  try {
    addrs = await Promise.race([
      resolve(hostname),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DNS_TIMEOUT')), 1500)),
    ]);
  } catch {
    return false;
  }
  if (!Array.isArray(addrs) || addrs.length === 0) return false;
  return addrs.every((a) => typeof a.address === 'string' && !isBlockedIp(a.address));
}
