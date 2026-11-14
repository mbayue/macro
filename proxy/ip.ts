// Pure blocked-address classification and CONNECT decision logic for the Egress_Proxy.
// This file runs inside the proxy container image: no imports from src/, no npm packages.

type ParsedIp = { v: 4; n: number } | { v: 6; g: readonly number[] };

// [base address, prefix length]
const BLOCKED_V4: readonly (readonly [number, number])[] = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16 (includes 169.254.169.254)
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xe0000000, 4], // 224.0.0.0/4
  [0xf0000000, 4], // 240.0.0.0/4 (includes 255.255.255.255)
];

function parseIpv4(s: string): number | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) return null;
    for (let i = 0; i < part.length; i++) {
      const c = part.charCodeAt(i);
      if (c < 48 || c > 57) return null;
    }
    // Leading zeros are ambiguous (octal in some resolvers): fail closed.
    if (part.length > 1 && part.startsWith("0")) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n;
}

function parseHexGroup(s: string): number | null {
  if (s.length < 1 || s.length > 4) return null;
  let v = 0;
  for (let i = 0; i < s.length; i++) {
    const d = Number.parseInt(s.charAt(i), 16);
    if (Number.isNaN(d)) return null;
    v = v * 16 + d;
  }
  return v;
}

function parseSide(str: string, allowV4Last: boolean): number[] | null {
  if (str === "") return [];
  const parts = str.split(":");
  const out: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) return null;
    if (part.includes(".")) {
      if (!allowV4Last || i !== parts.length - 1) return null;
      const v4 = parseIpv4(part);
      if (v4 === null) return null;
      out.push(Math.floor(v4 / 65536), v4 % 65536);
    } else {
      const g = parseHexGroup(part);
      if (g === null) return null;
      out.push(g);
    }
  }
  return out;
}

function parseIpv6(s: string): number[] | null {
  if (s.length < 2) return null;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    const ok = c === ":" || c === "." || (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
    if (!ok) return null; // includes zone ids (%eth0), brackets, whitespace
  }
  const dbl = s.indexOf("::");
  if (dbl !== s.lastIndexOf("::")) return null;
  if (dbl < 0) {
    const groups = parseSide(s, true);
    return groups !== null && groups.length === 8 ? groups : null;
  }
  const head = parseSide(s.slice(0, dbl), false);
  const tail = parseSide(s.slice(dbl + 2), true);
  if (head === null || tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function parseIp(address: string): ParsedIp | null {
  if (address.includes(":")) {
    const g = parseIpv6(address);
    return g === null ? null : { v: 6, g };
  }
  const n = parseIpv4(address);
  return n === null ? null : { v: 4, n };
}

function isBlockedV4(n: number): boolean {
  for (const [base, prefix] of BLOCKED_V4) {
    const size = 2 ** (32 - prefix);
    if (n >= base && n < base + size) return true;
  }
  return false;
}

function g(groups: readonly number[], i: number): number {
  return groups[i] ?? 0;
}

/** IPv4 address embedded in an IPv4-mapped (::ffff:0:0/96) or NAT64 (64:ff9b::/96) address. */
function embeddedV4(groups: readonly number[]): number | null {
  const tailV4 = g(groups, 6) * 65536 + g(groups, 7);
  const zeros = (from: number, to: number): boolean => {
    for (let i = from; i <= to; i++) if (g(groups, i) !== 0) return false;
    return true;
  };
  if (zeros(0, 4) && g(groups, 5) === 0xffff) return tailV4;
  if (g(groups, 0) === 0x64 && g(groups, 1) === 0xff9b && zeros(2, 5)) return tailV4;
  return null;
}

function keyOf(p: ParsedIp): string {
  if (p.v === 4) return `4:${p.n}`;
  const mapped = isMapped(p.g) ? g(p.g, 6) * 65536 + g(p.g, 7) : null;
  return mapped !== null ? `4:${mapped}` : `6:${p.g.join(":")}`;
}

function isMapped(groups: readonly number[]): boolean {
  for (let i = 0; i <= 4; i++) if (g(groups, i) !== 0) return false;
  return g(groups, 5) === 0xffff;
}

/**
 * True for every non-public or special address, for any address in `extraBlocked`
 * (exact IPs, compared after normalization), and for any string that is not a valid
 * IP literal (fail closed).
 */
export function isBlockedIp(address: string, extraBlocked: readonly string[] = []): boolean {
  const p = parseIp(address);
  if (p === null) return true;

  const extraKeys = new Set<string>();
  for (const e of extraBlocked) {
    const ep = parseIp(e.trim());
    if (ep !== null) extraKeys.add(keyOf(ep));
  }
  if (extraKeys.has(keyOf(p))) return true;

  if (p.v === 4) return isBlockedV4(p.n);

  const groups = p.g;
  const v4 = embeddedV4(groups);
  if (v4 !== null) {
    if (extraKeys.has(`4:${v4}`)) return true;
    return isBlockedV4(v4);
  }
  // ::/96 covers "::" and "::1" (and the deprecated IPv4-compatible form).
  let zeroPrefix = true;
  for (let i = 0; i <= 5; i++) if (g(groups, i) !== 0) zeroPrefix = false;
  if (zeroPrefix) return true;
  const first = g(groups, 0);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8
  if (first === 0x2002) return true; // 2002::/16 (6to4)
  if (first === 0x0064 && g(groups, 1) === 0xff9b && g(groups, 2) === 0x0001) return true; // 64:ff9b:1::/48 (local NAT64)
  if (first === 0x0100 && g(groups, 1) === 0 && g(groups, 2) === 0 && g(groups, 3) === 0) return true; // 100::/64 (discard)
  return false;
}

function normalizeHost(host: string): string {
  let h = host.toLowerCase();
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

function looksLikeIpLiteral(host: string): boolean {
  if (host.includes(":") || host.startsWith("[")) return true;
  return parseIp(host) !== null;
}

export type ConnectDecision = { allow: true; address: string } | { allow: false; reason: string };

/**
 * Decide a CONNECT request. Allow only port 443, an exactly allowlisted non-IP host, and
 * a resolved address list in which no address is blocked (DNS-rebinding defense).
 */
export function decideConnect(
  host: string,
  port: number,
  addresses: readonly string[],
  allowHosts: readonly string[],
  blockIps: readonly string[],
): ConnectDecision {
  if (port !== 443) return { allow: false, reason: "port_not_allowed" };
  const h = normalizeHost(host);
  if (h === "" || looksLikeIpLiteral(h)) return { allow: false, reason: "host_not_allowed" };
  const allowed = allowHosts.some((a) => normalizeHost(a.trim()) === h);
  if (!allowed) return { allow: false, reason: "host_not_allowed" };
  if (addresses.length === 0) return { allow: false, reason: "no_addresses" };
  let chosen: string | undefined;
  for (const a of addresses) {
    if (isBlockedIp(a, blockIps)) return { allow: false, reason: "blocked_address" };
    if (chosen === undefined) chosen = a;
  }
  if (chosen === undefined) return { allow: false, reason: "no_addresses" };
  return { allow: true, address: chosen };
}

/**
 * Parse a CONNECT request-line target: `host:port` or `[ipv6]:port`.
 * Returns null for a missing/invalid port, empty or over-long host, or any
 * whitespace, control, or non-ASCII character.
 */
export function parseConnectTarget(authority: string): { host: string; port: number } | null {
  if (authority.length === 0 || authority.length > 253 + 8) return null;
  for (let i = 0; i < authority.length; i++) {
    const c = authority.charCodeAt(i);
    if (c <= 0x20 || c >= 0x7f) return null;
  }
  let host: string;
  let portStr: string;
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close < 0 || authority.charAt(close + 1) !== ":") return null;
    host = authority.slice(1, close);
    portStr = authority.slice(close + 2);
    if (host.includes("[") || host.includes("]")) return null;
  } else {
    const colon = authority.lastIndexOf(":");
    if (colon < 0) return null;
    host = authority.slice(0, colon);
    portStr = authority.slice(colon + 1);
    if (host.includes(":") || host.includes("[") || host.includes("]")) return null;
  }
  if (host.length === 0 || host.length > 253) return null;
  if (portStr.length === 0 || portStr.length > 5) return null;
  for (let i = 0; i < portStr.length; i++) {
    const c = portStr.charCodeAt(i);
    if (c < 48 || c > 57) return null;
  }
  const port = Number(portStr);
  if (port < 1 || port > 65535) return null;
  return { host, port };
}
