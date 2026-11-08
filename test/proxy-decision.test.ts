import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { decideConnect, isBlockedIp, parseConnectTarget } from '../proxy/ip.ts';

// ---------------------------------------------------------------------------
// Independent reference model (written from the design/requirements, not from proxy/ip.ts).
// Addresses are modelled as numbers: IPv4 = 32-bit integer, IPv6 = 128-bit BigInt.
// ---------------------------------------------------------------------------

type Addr = { v: 4; n: number } | { v: 6; n: bigint };

// Requirement 6.15 + design "isBlockedIp" list + IANA special-purpose ranges.
const REF_V4_BLOCKED: readonly string[] = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

function v4ToInt(a: number, b: number, c: number, d: number): number {
  return ((a * 256 + b) * 256 + c) * 256 + d;
}

function cidr4(text: string): { base: number; size: number } {
  const [ip = '', len = ''] = text.split('/');
  const [a = 0, b = 0, c = 0, d = 0] = ip.split('.').map(Number);
  return { base: v4ToInt(a, b, c, d), size: 2 ** (32 - Number(len)) };
}

const REF_V4_RANGES = REF_V4_BLOCKED.map(cidr4);

function refV4Blocked(n: number): boolean {
  return REF_V4_RANGES.some((r) => n >= r.base && n < r.base + r.size);
}

function groupsToBig(groups: readonly number[]): bigint {
  let v = 0n;
  for (const g of groups) v = (v << 16n) | BigInt(g);
  return v;
}

function bigToGroups(v: bigint): number[] {
  const out: number[] = [];
  for (let i = 7; i >= 0; i--) out.push(Number((v >> BigInt(i * 16)) & 0xffffn));
  return out;
}

/** True when the top `prefix` bits of `v` equal the top `prefix` bits of `base`. */
function inPrefix6(v: bigint, base: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return v >> shift === base >> shift;
}

const MAPPED_BASE = 0xffffn << 32n; // ::ffff:0:0/96
const NAT64_BASE = groupsToBig([0x64, 0xff9b, 0, 0, 0, 0, 0, 0]); // 64:ff9b::/96
const LOW32 = 0xffffffffn;

function normalize(a: Addr): { kind: '4' | '6'; n: bigint } {
  if (a.v === 6 && inPrefix6(a.n, MAPPED_BASE, 96)) return { kind: '4', n: a.n & LOW32 };
  return { kind: a.v === 4 ? '4' : '6', n: BigInt(a.n) };
}

function refBlocked(a: Addr, extra: readonly Addr[]): boolean {
  const key = normalize(a);
  if (extra.some((e) => {
    const k = normalize(e);
    return k.kind === key.kind && k.n === key.n;
  })) {
    return true;
  }
  if (a.v === 4) return refV4Blocked(a.n);
  const isMapped = inPrefix6(a.n, MAPPED_BASE, 96);
  const isNat64 = inPrefix6(a.n, NAT64_BASE, 96);
  if (isMapped || isNat64) {
    const embedded = a.n & LOW32;
    const embeddedNum = Number(embedded);
    if (extra.some((e) => e.v === 4 && e.n === embeddedNum)) return true;
    if (extra.some((e) => e.v === 6 && inPrefix6(e.n, MAPPED_BASE, 96) && Number(e.n & LOW32) === embeddedNum)) {
      return true;
    }
    return refV4Blocked(embeddedNum);
  }
  if (inPrefix6(a.n, 0n, 96)) return true; // ::/96 covers :: and ::1
  if (inPrefix6(a.n, groupsToBig([0xfc00, 0, 0, 0, 0, 0, 0, 0]), 7)) return true; // fc00::/7
  if (inPrefix6(a.n, groupsToBig([0xfe80, 0, 0, 0, 0, 0, 0, 0]), 10)) return true; // fe80::/10
  if (inPrefix6(a.n, groupsToBig([0xff00, 0, 0, 0, 0, 0, 0, 0]), 8)) return true; // ff00::/8
  return false;
}

// ---------------------------------------------------------------------------
// Address text formatting and generators
// ---------------------------------------------------------------------------

function fmt4(n: number): string {
  return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');
}

type V6Style = 'full' | 'short' | 'compressed' | 'upper' | 'dotted';

function fmt6(v: bigint, style: V6Style): string {
  const g = bigToGroups(v);
  const hex = (x: number): string => (style === 'full' ? x.toString(16).padStart(4, '0') : x.toString(16));
  const dotted = style === 'dotted' ? fmt4(Number(v & LOW32)) : undefined;
  const head = dotted !== undefined ? g.slice(0, 6) : g;
  const parts = head.map(hex);
  let text: string;
  if (style === 'compressed' || style === 'upper' || style === 'dotted') {
    // Replace the longest run (>= 2) of zero groups with '::'.
    let bestStart = -1;
    let bestLen = 0;
    for (let i = 0; i < head.length; ) {
      if (head[i] !== 0) {
        i++;
        continue;
      }
      let j = i;
      while (j < head.length && head[j] === 0) j++;
      if (j - i > bestLen) {
        bestStart = i;
        bestLen = j - i;
      }
      i = j;
    }
    if (bestLen >= 2) {
      const left = parts.slice(0, bestStart).join(':');
      const right = parts.slice(bestStart + bestLen).join(':');
      text = `${left}::${right}`;
    } else {
      text = parts.join(':');
    }
  } else {
    text = parts.join(':');
  }
  if (dotted !== undefined) text = text.endsWith('::') ? `${text}${dotted}` : text.length === 0 ? dotted : `${text}:${dotted}`;
  return style === 'upper' ? text.toUpperCase() : text;
}

const arbStyle: fc.Arbitrary<V6Style> = fc.constantFrom('full', 'short', 'compressed', 'upper', 'dotted');

/** IPv4 integer biased towards the edges of every blocked range. */
const arbV4Int: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 0, max: 0xffffffff }),
  fc
    .tuple(fc.constantFrom(...REF_V4_RANGES), fc.constantFrom(-2, -1, 0, 1, 2, 'last-1', 'last', 'end', 'end+1'))
    .map(([r, off]) => {
      if (off === 'last') return r.base + r.size - 1;
      if (off === 'last-1') return r.base + r.size - 2;
      if (off === 'end') return r.base + r.size;
      if (off === 'end+1') return r.base + r.size + 1;
      return r.base + Number(off);
    })
    .map((n) => Math.min(Math.max(n, 0), 0xffffffff)),
  fc.constantFrom(v4ToInt(169, 254, 169, 254), v4ToInt(127, 0, 0, 1), v4ToInt(45, 77, 37, 116), v4ToInt(8, 8, 8, 8)),
);

const arbGroup: fc.Arbitrary<number> = fc.integer({ min: 0, max: 0xffff });

/** 128-bit value biased towards the interesting prefixes (mapped, NAT64, ULA, link-local, multicast, loopback). */
const arbV6Big: fc.Arbitrary<bigint> = fc.oneof(
  fc.array(arbGroup, { minLength: 8, maxLength: 8 }).map(groupsToBig),
  // global unicast 2000::/3 (never blocked)
  fc.tuple(fc.integer({ min: 0x2000, max: 0x3fff }), fc.array(arbGroup, { minLength: 7, maxLength: 7 })).map(([a, rest]) => groupsToBig([a, ...rest])),
  fc.tuple(fc.integer({ min: 0xfc00, max: 0xfdff }), fc.array(arbGroup, { minLength: 7, maxLength: 7 })).map(([a, rest]) => groupsToBig([a, ...rest])),
  fc.tuple(fc.integer({ min: 0xfe80, max: 0xfebf }), fc.array(arbGroup, { minLength: 7, maxLength: 7 })).map(([a, rest]) => groupsToBig([a, ...rest])),
  fc.tuple(fc.integer({ min: 0xfec0, max: 0xfeff }), fc.array(arbGroup, { minLength: 7, maxLength: 7 })).map(([a, rest]) => groupsToBig([a, ...rest])),
  fc.tuple(fc.integer({ min: 0xff00, max: 0xffff }), fc.array(arbGroup, { minLength: 7, maxLength: 7 })).map(([a, rest]) => groupsToBig([a, ...rest])),
  fc.oneof(fc.constantFrom(0n, 1n, 2n), arbGroup.map((g) => BigInt(g))), // :: , ::1 and the rest of the low ::/96 area
  arbV4Int.map((n) => MAPPED_BASE | BigInt(n)), // ::ffff:a.b.c.d
  arbV4Int.map((n) => NAT64_BASE | BigInt(n)), // 64:ff9b::a.b.c.d
  arbV4Int.map((n) => BigInt(n)), // ::a.b.c.d (deprecated IPv4-compatible)
  fc.array(arbGroup, { minLength: 3, maxLength: 3 }).map(([a, b, c]) => groupsToBig([0x2001, 0x0db8, a ?? 0, b ?? 0, c ?? 0, 0, 0, 1])),
);

interface GenAddr {
  text: string;
  addr: Addr;
}

const arbV4Addr: fc.Arbitrary<GenAddr> = arbV4Int.map((n) => ({ text: fmt4(n), addr: { v: 4 as const, n } }));
const arbV6Addr: fc.Arbitrary<GenAddr> = fc
  .tuple(arbV6Big, arbStyle)
  .map(([v, style]) => {
    // 'dotted' output only makes sense for values; every value can be written with a dotted tail.
    return { text: fmt6(v, style), addr: { v: 6 as const, n: v } };
  });
const arbAddr: fc.Arbitrary<GenAddr> = fc.oneof(arbV4Addr, arbV6Addr);
/** Addresses that no range rule blocks (BLOCK_IPS may still block them). */
const arbPublicAddr: fc.Arbitrary<GenAddr> = arbAddr.filter((a) => !refBlocked(a.addr, []));
/** Mostly all-public lists so the allow branch is exercised often, plus unrestricted lists. */
const arbAddrList: fc.Arbitrary<GenAddr[]> = fc.oneof(
  { weight: 3, arbitrary: fc.array(arbPublicAddr, { minLength: 1, maxLength: 3 }) },
  { weight: 1, arbitrary: fc.array(arbAddr, { minLength: 0, maxLength: 4 }) },
);

// ---------------------------------------------------------------------------
// Property 10 helpers
// ---------------------------------------------------------------------------

const HOST_LABELS = ['yue', 'api', 'macro', 'my', 'id', 'shop', 'example', 'com', 'a1', 'x-y'];
const arbLabel = fc.constantFrom(...HOST_LABELS);
const arbAllowHost: fc.Arbitrary<string> = fc.array(arbLabel, { minLength: 2, maxLength: 4 }).map((l) => l.join('.'));

function randomCase(s: string, mask: readonly boolean[]): string {
  return [...s].map((ch, i) => (mask[i % Math.max(mask.length, 1)] === true ? ch.toUpperCase() : ch)).join('');
}

const arbMask = fc.array(fc.boolean(), { minLength: 1, maxLength: 40 });

type HostKind = 'allowed' | 'allowed-case' | 'allowed-dot' | 'other' | 'suffix-trick' | 'prefix-trick' | 'padded' | 'double-dot';

const MACRO_VM_IP = '45.77.37.116';

describe('Property 10: egress decision (decideConnect)', () => {
  test('allows exactly allowlisted host + port 443 + only public addresses; chosen address is a non-blocked one', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    fc.assert(
      fc.property(
        fc.array(arbAllowHost, { minLength: 1, maxLength: 3 }),
        arbAllowHost,
        fc.oneof(
          { weight: 6, arbitrary: fc.constantFrom<HostKind>('allowed', 'allowed-case', 'allowed-dot') },
          { weight: 2, arbitrary: fc.constantFrom<HostKind>('other', 'suffix-trick', 'prefix-trick', 'padded', 'double-dot') },
        ),
        arbMask,
        fc.oneof(
          { weight: 8, arbitrary: fc.constant(443) },
          { weight: 1, arbitrary: fc.constantFrom(0, 1, 80, 442, 444, 8443, 65535) },
          { weight: 1, arbitrary: fc.integer({ min: 0, max: 65535 }) },
        ),
        arbAddrList,
        fc.oneof({ weight: 3, arbitrary: fc.constant([]) }, { weight: 1, arbitrary: fc.array(arbAddr, { maxLength: 2 }) }),
        fc.boolean(),
        (allow, otherHost, kind, mask, port, addrs, blockExtra, includeVmIp) => {
          const allowHosts = allow;
          const first = allowHosts[0] ?? 'yue.macro.my.id';
          let host: string;
          switch (kind) {
            case 'allowed':
              host = first;
              break;
            case 'allowed-case':
              host = randomCase(first, mask);
              break;
            case 'allowed-dot':
              host = `${randomCase(first, mask)}.`;
              break;
            case 'suffix-trick':
              host = `${first}.evil.example`;
              break;
            case 'prefix-trick':
              host = `x${first}`;
              break;
            case 'padded':
              host = ` ${first}`;
              break;
            case 'double-dot':
              host = `${first}..`;
              break;
            default:
              host = otherHost;
          }
          const blockIps = [
            ...(includeVmIp ? [MACRO_VM_IP] : []),
            ...blockExtra.map((b) => b.text),
          ];
          const extra: Addr[] = [
            ...(includeVmIp ? [{ v: 4 as const, n: v4ToInt(45, 77, 37, 116) }] : []),
            ...blockExtra.map((b) => b.addr),
          ];
          const addresses = addrs.map((a) => a.text);

          const hostOk = (() => {
            const lowered = host.toLowerCase();
            const h = lowered.endsWith('.') ? lowered.slice(0, -1) : lowered;
            return allowHosts.some((a) => a.toLowerCase() === h);
          })();
          const anyBlocked = addrs.some((a) => refBlocked(a.addr, extra));
          const expectAllow = hostOk && port === 443 && addrs.length > 0 && !anyBlocked;

          const d = decideConnect(host, port, addresses, allowHosts, blockIps);
          expect(d.allow).toBe(expectAllow);
          if (d.allow) {
            expect(addresses).toContain(d.address);
            const chosen = addrs.find((a) => a.text === d.address);
            expect(chosen).toBeDefined();
            expect(chosen === undefined ? true : refBlocked(chosen.addr, extra)).toBe(false);
            expect(isBlockedIp(d.address, blockIps)).toBe(false);
          } else {
            const expectedReason =
              port !== 443
                ? 'port_not_allowed'
                : !hostOk
                  ? 'host_not_allowed'
                  : addrs.length === 0
                    ? 'no_addresses'
                    : 'blocked_address';
            expect(d.reason).toBe(expectedReason);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  test('isBlockedIp agrees with the reference model for IPv4, IPv6, mapped, NAT64, compressed/upper/dotted forms and BLOCK_IPS', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    fc.assert(
      fc.property(arbAddr, fc.array(arbAddr, { maxLength: 3 }), (a, extra) => {
        const extraAddrs = extra.map((e) => e.addr);
        const expected = refBlocked(a.addr, extraAddrs);
        expect(isBlockedIp(a.text, extra.map((e) => e.text))).toBe(expected);
        // Without BLOCK_IPS the range rules alone apply.
        expect(isBlockedIp(a.text)).toBe(refBlocked(a.addr, []));
      }),
      { numRuns: 1500 },
    );
  });

  test('an address listed in BLOCK_IPS is blocked in every spelling (mapped, NAT64, compressed, upper case)', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    const publicV4 = arbV4Int.filter((n) => !refV4Blocked(n));
    fc.assert(
      fc.property(publicV4, arbStyle, (n, style) => {
        const dotted = fmt4(n);
        expect(isBlockedIp(dotted)).toBe(false);
        expect(isBlockedIp(dotted, [dotted])).toBe(true);
        expect(isBlockedIp(fmt6(MAPPED_BASE | BigInt(n), style), [dotted])).toBe(true);
        expect(isBlockedIp(fmt6(NAT64_BASE | BigInt(n), style), [dotted])).toBe(true);
        expect(isBlockedIp(dotted, [`  ${dotted} `])).toBe(true);
        // A mapped address in BLOCK_IPS blocks the plain IPv4 address too.
        expect(isBlockedIp(dotted, [fmt6(MAPPED_BASE | BigInt(n), style)])).toBe(true);
        // A different public address is unaffected by an unrelated entry.
        const other = n === 0x2d000000 ? n + 1 : 0x2d000000;
        if (!refV4Blocked(other)) expect(isBlockedIp(fmt4(other), [dotted])).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  test('requirement 6.15 named destinations are denied for an allowlisted host', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    const allow = ['yue.macro.my.id', 'api.yue.macro.my.id'];
    for (const ip of [
      '169.254.169.254',
      '169.254.0.1',
      '127.0.0.1',
      '127.255.255.255',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '0.0.0.0',
      '100.64.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      '::ffff:169.254.169.254',
      '::ffff:7f00:1',
      '::ffff:a00:1',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b::10.0.0.1',
      MACRO_VM_IP,
      `::ffff:${MACRO_VM_IP}`,
    ]) {
      const d = decideConnect('yue.macro.my.id', 443, [ip], allow, [MACRO_VM_IP]);
      expect(d.allow).toBe(false);
    }
  });

  test('public addresses are allowed for allowlisted hosts, with the first address chosen', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    const allow = ['yue.macro.my.id', 'api.yue.macro.my.id'];
    expect(decideConnect('yue.macro.my.id', 443, ['45.32.113.74'], allow, [MACRO_VM_IP])).toEqual({
      allow: true,
      address: '45.32.113.74',
    });
    expect(decideConnect('api.yue.macro.my.id', 443, ['2606:4700::1111', '45.32.113.74'], allow, [MACRO_VM_IP])).toEqual({
      allow: true,
      address: '2606:4700::1111',
    });
    expect(decideConnect('YUE.Macro.My.ID.', 443, ['::ffff:45.32.113.74'], allow, [MACRO_VM_IP])).toEqual({
      allow: true,
      address: '::ffff:45.32.113.74',
    });
  });

  test('DNS rebinding: a mixed public + private answer is denied whatever the order', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    const allow = ['yue.macro.my.id'];
    const publicAddr = '45.32.113.74';
    for (const priv of ['169.254.169.254', '10.0.0.5', '127.0.0.1', '::1', '::ffff:10.0.0.5', MACRO_VM_IP, 'fe80::1']) {
      for (const list of [[publicAddr, priv], [priv, publicAddr], [publicAddr, priv, publicAddr], [priv, publicAddr, priv]]) {
        const d = decideConnect('yue.macro.my.id', 443, list, allow, [MACRO_VM_IP]);
        expect(d).toEqual({ allow: false, reason: 'blocked_address' });
      }
    }
  });

  test('host handling: case, one trailing dot, IP literals, ports and lookalikes', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    const allow = ['yue.macro.my.id', ' API.yue.macro.my.id. '];
    const pub = ['45.32.113.74'];
    const ok = (host: string, port = 443): boolean => decideConnect(host, port, pub, allow, []).allow;
    expect(ok('yue.macro.my.id')).toBe(true);
    expect(ok('YUE.MACRO.MY.ID')).toBe(true);
    expect(ok('yue.macro.my.id.')).toBe(true);
    expect(ok('api.yue.macro.my.id')).toBe(true); // allowlist entries are trimmed and normalised too
    expect(ok('yue.macro.my.id..')).toBe(false);
    expect(ok('.yue.macro.my.id')).toBe(false);
    expect(ok(' yue.macro.my.id')).toBe(false);
    expect(ok('yue.macro.my.id ')).toBe(false);
    expect(ok('yue.macro.my.id\n')).toBe(false);
    expect(ok('macro.my.id')).toBe(false);
    expect(ok('evil.yue.macro.my.id')).toBe(false);
    expect(ok('yue.macro.my.id.evil.com')).toBe(false);
    expect(ok('yue.macro.my.id:443')).toBe(false);
    expect(ok('')).toBe(false);
    expect(ok('.')).toBe(false);
    expect(ok('yue.macro.my.id', 80)).toBe(false);
    expect(ok('yue.macro.my.id', 8443)).toBe(false);
    expect(ok('yue.macro.my.id', 0)).toBe(false);
    // Port is checked before the host.
    expect(decideConnect('evil.example', 80, pub, allow, [])).toEqual({ allow: false, reason: 'port_not_allowed' });
    expect(decideConnect('evil.example', 443, pub, allow, [])).toEqual({ allow: false, reason: 'host_not_allowed' });
    expect(decideConnect('yue.macro.my.id', 443, [], allow, [])).toEqual({ allow: false, reason: 'no_addresses' });
    // An IP literal is never a valid CONNECT host, even when someone puts it in the allowlist.
    for (const literal of ['45.32.113.74', '::1', '[::1]', '2606:4700::1111', '169.254.169.254']) {
      expect(decideConnect(literal, 443, pub, [literal, ...allow], []).allow).toBe(false);
    }
  });

  test('zone ids, brackets, leading zeros, and malformed literals fail closed', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    for (const bad of [
      'fe80::1%eth0',
      'fe80::1%25eth0',
      '2606:4700::1111%eth0', // a public address with a zone id is still not a plain literal
      '2606:4700::1111%1',
      '[::1]',
      '[2606:4700::1111]',
      '010.0.0.1',
      '1.2.3',
      '1.2.3.4.5',
      '256.1.1.1',
      '1.2.3.-4',
      '1.2.3.4 ',
      ' 1.2.3.4',
      '1.2.3.4\n',
      '0x7f.0.0.1',
      '2130706433',
      '',
      ' ',
      'localhost',
      'yue.macro.my.id',
      ':::',
      '1::2::3',
      '1:2:3:4:5:6:7:8:9',
      '1:2:3:4:5:6:7',
      'g::1',
      '12345::1',
      '::ffff:1.2.3',
      '::ffff:256.1.1.1',
      '::1.2.3.4:5',
      '1.2.3.4::',
    ]) {
      expect(isBlockedIp(bad)).toBe(true);
      expect(decideConnect('yue.macro.my.id', 443, ['45.32.113.74', bad], ['yue.macro.my.id'], [])).toEqual({
        allow: false,
        reason: 'blocked_address',
      });
    }
  });

  test('invalid BLOCK_IPS entries are ignored and do not unblock or block anything else', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    expect(isBlockedIp('45.32.113.74', ['', 'not-an-ip', '45.32.113', 'fe80::1%eth0'])).toBe(false);
    expect(isBlockedIp('45.32.113.74', ['45.32.113.74'])).toBe(true);
    expect(isBlockedIp('10.0.0.1', [])).toBe(true);
  });

  test('range edges for every blocked IPv4 CIDR', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    for (const r of REF_V4_RANGES) {
      expect(isBlockedIp(fmt4(r.base))).toBe(true);
      expect(isBlockedIp(fmt4(r.base + r.size - 1))).toBe(true);
      // The neighbour just past the range is blocked only if another range covers it.
      const after = r.base + r.size;
      if (after <= 0xffffffff) expect(isBlockedIp(fmt4(after))).toBe(refV4Blocked(after));
      const before = r.base - 1;
      if (before >= 0) expect(isBlockedIp(fmt4(before))).toBe(refV4Blocked(before));
    }
    for (const publicIp of ['1.1.1.1', '8.8.8.8', '45.32.113.74', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '192.0.1.1', '198.17.255.255', '198.20.0.0', '223.255.255.255']) {
      expect(isBlockedIp(publicIp)).toBe(false);
    }
    for (const publicIp6 of ['2606:4700::1111', '2001:db8::1', '2a00:1450:4001:81b::200e', 'fbff::1', 'fe00::1', 'fec0::1', '64:ff9b::808:808', '::ffff:8.8.8.8']) {
      expect(isBlockedIp(publicIp6)).toBe(false);
    }
  });
});

describe('Property 10: CONNECT target parsing feeds the decision', () => {
  test('parseConnectTarget accepts host:port and [v6]:port and rejects malformed authorities', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    expect(parseConnectTarget('yue.macro.my.id:443')).toEqual({ host: 'yue.macro.my.id', port: 443 });
    expect(parseConnectTarget('[2606:4700::1111]:443')).toEqual({ host: '2606:4700::1111', port: 443 });
    for (const bad of [
      '',
      'yue.macro.my.id',
      'yue.macro.my.id:',
      'yue.macro.my.id:0',
      'yue.macro.my.id:65536',
      'yue.macro.my.id:44a',
      'yue.macro.my.id:-1',
      ':443',
      'a b:443',
      'yue.macro.my.id\t:443',
      'yue.macro.my.id\r\n:443',
      'yüe.example:443',
      '[::1:443',
      '::1:443',
      '[::1]443',
      'a:b:443',
      `${'a'.repeat(254)}:443`,
    ]) {
      expect(parseConnectTarget(bad)).toBeNull();
    }
  });

  test('a zone-id target parses but is always denied by the decision', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    const t = parseConnectTarget('[fe80::1%25eth0]:443');
    if (t !== null) {
      expect(decideConnect(t.host, t.port, ['45.32.113.74'], ['yue.macro.my.id'], []).allow).toBe(false);
    }
  });

  test('random authorities never produce an allow unless they name an allowlisted host', () => {
    // Feature: macro, Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (s) => {
        const t = parseConnectTarget(s);
        if (t === null) return;
        const d = decideConnect(t.host, t.port, ['45.32.113.74'], ['yue.macro.my.id'], []);
        if (d.allow) {
          expect(t.port).toBe(443);
          expect(t.host.toLowerCase().replace(/\.$/, '')).toBe('yue.macro.my.id');
        }
      }),
      { numRuns: 500 },
    );
  });
});

