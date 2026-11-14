import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type LookupAllFn = (hostname: string) => Promise<readonly { address: string }[]>;

const defaultLookup: LookupAllFn = (hostname) => lookup(hostname, { all: true, verbatim: true });

const BLOCKED_V4: readonly (readonly [number, number])[] = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xe0000000, 4], // 224.0.0.0/4
  [0xf0000000, 4], // 240.0.0.0/4
];

function ipv4ToInt(addr: string): number | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const oct = Number(p);
    if (oct > 255) return null;
    n = n * 256 + oct;
  }
  return n;
}

function isBlockedV4(addr: string): boolean {
  const n = ipv4ToInt(addr);
  if (n === null) return true;
  for (const [base, prefix] of BLOCKED_V4) {
    const size = 2 ** (32 - prefix);
    if (n >= base && n < base + size) return true;
  }
  return false;
}

function expandV6Groups(addr: string): number[] | null {
  const clean = addr.split('%')[0] ?? '';
  const dbl = clean.indexOf('::');
  if (dbl !== clean.lastIndexOf('::')) return null;
  const parseSide = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    const parts = s.split(':');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? '';
      if (part.includes('.')) {
        if (i !== parts.length - 1) return null;
        const v4 = ipv4ToInt(part);
        if (v4 === null) return null;
        out.push(Math.floor(v4 / 65536), v4 % 65536);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
        out.push(Number.parseInt(part, 16));
      }
    }
    return out;
  };
  if (dbl < 0) {
    const g = parseSide(clean);
    return g !== null && g.length === 8 ? g : null;
  }
  const head = parseSide(clean.slice(0, dbl));
  const tail = parseSide(clean.slice(dbl + 2));
  if (head === null || tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function isBlockedIpAddress(raw: string): boolean {
  const addr = raw.trim();
  const kind = isIP(addr);
  if (kind === 4) return isBlockedV4(addr);
  if (kind !== 6) return true;
  const g = expandV6Groups(addr);
  if (g === null) return true;
  const zeros = (from: number, to: number): boolean => {
    for (let i = from; i <= to; i++) if (g[i] !== 0) return false;
    return true;
  };
  const v4Tail = `${Math.floor((g[6] ?? 0) / 256)}.${(g[6] ?? 0) % 256}.${Math.floor((g[7] ?? 0) / 256)}.${(g[7] ?? 0) % 256}`;
  if (zeros(0, 4) && g[5] === 0xffff) return isBlockedV4(v4Tail); // ::ffff:0:0/96
  if (g[0] === 0x0064 && g[1] === 0xff9b && zeros(2, 5)) return isBlockedV4(v4Tail); // 64:ff9b::/96
  if (zeros(0, 5)) return true; // ::/96
  const first = g[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8
  if (first === 0x2002) return true; // 2002::/16
  if (first === 0x0064 && g[1] === 0xff9b && g[2] === 0x0001) return true; // 64:ff9b:1::/48
  if (first === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64
  return false;
}

/**
 * Resolve `hostname` and return true only when every returned address is a public IP.
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
  return addrs.every((a) => typeof a.address === 'string' && !isBlockedIpAddress(a.address));
}
