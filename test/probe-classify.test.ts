import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { classifyProbe, parseProbeLogs, PROBE_ACTIONS } from '../src/k6/probe-result.ts';
import type { ProbeActionId, ProbeActionResult, ProbeVerdict } from '../src/k6/probe-result.ts';

type Outcome = 'contained' | 'escaped' | 'missing';

interface Scenario {
  a: Outcome;
  b: Outcome;
  c: Outcome;
  d: Outcome;
  /** Whether the "started" line for action e was printed. */
  eLine: boolean;
  oomKilled: boolean;
  killedByMacro: boolean;
  /** Where each present line is written, and in which format. */
  place: ('stdout' | 'stderr')[];
  logfmt: boolean[];
  noise: string[];
  noiseAt: number[];
}

const ALL_IDS: readonly ProbeActionId[] = ['a', 'b', 'c', 'd', 'e'];

// ---------------------------------------------------------------------------
// Reference model, written from Requirements 12.4, 12.5 and 12.9.
// ---------------------------------------------------------------------------

function refActions(s: Scenario): Record<ProbeActionId, ProbeActionResult> {
  const net = (o: Outcome): ProbeActionResult => (o === 'missing' ? 'no result' : o);
  let e: ProbeActionResult;
  if (s.oomKilled) e = 'contained'; // memory limit exceeded: "memory cap hit"
  else if (!s.eLine) e = 'no result';
  else if (s.killedByMacro) e = 'no result'; // cut off by the time cap, never finished
  else e = 'escaped';
  return { a: net(s.a), b: net(s.b), c: net(s.c), d: net(s.d), e };
}

function refVerdict(actions: Record<ProbeActionId, ProbeActionResult>): { result: ProbeVerdict; escaped: ProbeActionId[] } {
  const escaped = ALL_IDS.filter((id) => actions[id] === 'escaped');
  if (escaped.length > 0) return { result: 'failed', escaped };
  if (ALL_IDS.every((id) => actions[id] === 'contained')) return { result: 'passed', escaped };
  return { result: 'incomplete', escaped };
}

// ---------------------------------------------------------------------------
// Log synthesis
// ---------------------------------------------------------------------------

function payloadFor(id: ProbeActionId, o: Outcome, status: number, names: string[]): object | undefined {
  if (id === 'd') {
    if (o === 'missing') return undefined;
    return { action: 'd', outcome: 'names', names: o === 'escaped' ? names : [] };
  }
  if (o === 'missing') return undefined;
  return o === 'contained' ? { action: id, outcome: 'no_response' } : { action: id, outcome: 'response', status };
}

/** The line as the probe prints it (`raw`) or as k6 wraps console output (`logfmt`). */
function renderLine(payload: object, logfmt: boolean): string {
  const json = JSON.stringify(payload);
  if (!logfmt) return `MACRO_PROBE ${json}`;
  const quoted = `MACRO_PROBE ${json}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `time="2026-11-08T10:00:00Z" level=info msg="${quoted}" source=console`;
}

const arbOutcome: fc.Arbitrary<Outcome> = fc.constantFrom('contained', 'escaped', 'missing');

const NOISE: readonly string[] = [
  'MACRO_PROBE {not json}',
  'MACRO_PROBE',
  'MACRO_PROBE {"action":"z","outcome":"no_response"}',
  'MACRO_PROBE {"action":"a","outcome":"response","status":0}',
  'MACRO_PROBE {"action":"a","outcome":"response","status":600}',
  'MACRO_PROBE {"action":"a","outcome":"response"}',
  'MACRO_PROBE {"action":"d","outcome":"names","names":"KEY"}',
  'MACRO_PROBE {"action":"d","outcome":"no_response"}',
  'MACRO_PROBE {"action":"e","outcome":"no_response"}',
  'MACRO_PROBE []',
  'MACRO_PROBE null',
  'INFO[0000] some k6 banner',
  'running (00m01.0s), 1/1 VUs, 0 complete and 0 interrupted iterations',
  '',
  'MACRO_PROBE_OTHER {"action":"a","outcome":"response","status":200}',
];

const arbScenario: fc.Arbitrary<Scenario> = fc.record({
  a: arbOutcome,
  b: arbOutcome,
  c: arbOutcome,
  d: arbOutcome,
  eLine: fc.boolean(),
  oomKilled: fc.boolean(),
  killedByMacro: fc.boolean(),
  place: fc.array(fc.constantFrom('stdout' as const, 'stderr' as const), { minLength: 5, maxLength: 5 }),
  logfmt: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
  noise: fc.array(fc.constantFrom(...NOISE), { maxLength: 6 }),
  noiseAt: fc.array(fc.nat(10), { minLength: 6, maxLength: 6 }),
});

function buildLogs(
  s: Scenario,
  status: number,
  names: string[],
): { stdout: string; stderr: string } {
  const lines: { text: string; stream: 'stdout' | 'stderr' }[] = [];
  ALL_IDS.forEach((id, i) => {
    let payload: object | undefined;
    if (id === 'e') payload = s.eLine ? { action: 'e', outcome: 'started' } : undefined;
    else payload = payloadFor(id, s[id], status, names);
    if (payload !== undefined) {
      lines.push({ text: renderLine(payload, s.logfmt[i] ?? false), stream: s.place[i] ?? 'stdout' });
    }
  });
  s.noise.forEach((text, i) => {
    const at = Math.min(s.noiseAt[i] ?? 0, lines.length);
    lines.splice(at, 0, { text, stream: i % 2 === 0 ? 'stdout' : 'stderr' });
  });
  return {
    stdout: lines.filter((l) => l.stream === 'stdout').map((l) => l.text).join('\n'),
    stderr: lines.filter((l) => l.stream === 'stderr').map((l) => l.text).join('\n'),
  };
}

describe('Property 24: Containment_Probe classification', () => {
  test('log lines plus Docker memory state classify to the reference result, escaped set, and verdict', () => {
    // Feature: macro, Property 24: Containment_Probe classification
    fc.assert(
      fc.property(
        arbScenario,
        fc.integer({ min: 1, max: 599 }),
        fc.array(fc.stringMatching(/^[A-Z_]{1,12}$/), { minLength: 1, maxLength: 3 }),
        (s, status, names) => {
          const { stdout, stderr } = buildLogs(s, status, names);
          const got = classifyProbe(parseProbeLogs(stdout, stderr), { oomKilled: s.oomKilled, killedByMacro: s.killedByMacro });
          const actions = refActions(s);
          const expected = refVerdict(actions);

          expect(got.actions).toEqual(actions);
          expect(got.escaped).toEqual(expected.escaped);
          expect(got.result).toBe(expected.result);

          // Properties stated by Requirements 12.4, 12.5, 12.9 directly.
          for (const id of ['a', 'b', 'c', 'd'] as const) {
            if (s[id] === 'missing') expect(got.actions[id]).toBe('no result');
          }
          if (got.escaped.length > 0) expect(got.result).toBe('failed');
          expect(got.result === 'passed').toBe(ALL_IDS.every((id) => got.actions[id] === 'contained'));
          if (got.result === 'incomplete') {
            expect(got.escaped).toEqual([]);
            expect(ALL_IDS.some((id) => got.actions[id] === 'no result')).toBe(true);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  test('failed names exactly the escaped actions, in order, whatever else happened', () => {
    // Feature: macro, Property 24: Containment_Probe classification
    fc.assert(
      fc.property(arbScenario, (s) => {
        const { stdout, stderr } = buildLogs(s, 200, ['MY_SECRET']);
        const got = classifyProbe(parseProbeLogs(stdout, stderr), { oomKilled: s.oomKilled, killedByMacro: s.killedByMacro });
        const escapedByInput = ALL_IDS.filter((id) => (id === 'e' ? !s.oomKilled && s.eLine && !s.killedByMacro : s[id] === 'escaped'));
        expect(got.escaped).toEqual(escapedByInput);
        expect(got.result === 'failed').toBe(escapedByInput.length > 0);
      }),
      { numRuns: 300 },
    );
  });

  test('all five contained is passed (clean probe: no response, no matching names, OOM kill)', () => {
    // Feature: macro, Property 24: Containment_Probe classification
    const stdout = [
      'MACRO_PROBE {"action":"a","outcome":"no_response"}',
      'MACRO_PROBE {"action":"b","outcome":"no_response"}',
      'MACRO_PROBE {"action":"c","outcome":"no_response"}',
      'MACRO_PROBE {"action":"d","outcome":"names","names":[]}',
      'MACRO_PROBE {"action":"e","outcome":"started"}',
    ].join('\n');
    const got = classifyProbe(parseProbeLogs(stdout, ''), { oomKilled: true });
    expect(got).toEqual({
      actions: { a: 'contained', b: 'contained', c: 'contained', d: 'contained', e: 'contained' },
      result: 'passed',
      escaped: [],
    });
  });

  test('no logs and no OOM is incomplete with five `no result` actions', () => {
    // Feature: macro, Property 24: Containment_Probe classification
    const got = classifyProbe(parseProbeLogs('', ''), { oomKilled: false });
    expect(got.actions).toEqual({ a: 'no result', b: 'no result', c: 'no result', d: 'no result', e: 'no result' });
    expect(got.result).toBe('incomplete');
    expect(got.escaped).toEqual([]);
  });

  test('an escaped network action wins over missing lines', () => {
    // Feature: macro, Property 24: Containment_Probe classification
    const got = classifyProbe(
      parseProbeLogs('MACRO_PROBE {"action":"b","outcome":"response","status":200}', ''),
      { oomKilled: false },
    );
    expect(got.result).toBe('failed');
    expect(got.escaped).toEqual(['b']);
    expect(got.actions.a).toBe('no result');
  });

  test('environment names that match mean action d escaped, even when the probe reports them in k6 logfmt', () => {
    // Feature: macro, Property 24: Containment_Probe classification
    const line = renderLine({ action: 'd', outcome: 'names', names: ['VULTR_API_KEY', 'TURNSTILE_SECRET_KEY'] }, true);
    const got = classifyProbe(parseProbeLogs('', line), { oomKilled: true });
    expect(got.actions.d).toBe('escaped');
    expect(got.escaped).toEqual(['d']);
    expect(got.result).toBe('failed');
  });

  test('action e: cut off by Macro (time cap) is `no result`, not escaped; OOM always means contained', () => {
    // Feature: macro, Property 24: Containment_Probe classification
    const started = parseProbeLogs('MACRO_PROBE {"action":"e","outcome":"started"}', '');
    expect(classifyProbe(started, { oomKilled: false, killedByMacro: true }).actions.e).toBe('no result');
    expect(classifyProbe(started, { oomKilled: false }).actions.e).toBe('escaped');
    expect(classifyProbe(started, { oomKilled: true, killedByMacro: false }).actions.e).toBe('contained');
    expect(classifyProbe({}, { oomKilled: true }).actions.e).toBe('contained');
    expect(classifyProbe({}, { oomKilled: false }).actions.e).toBe('no result');
  });

  test('the first valid line per action wins and malformed lines never count', () => {
    // Feature: macro, Property 24: Containment_Probe classification
    const parsed = parseProbeLogs(
      [
        'MACRO_PROBE {"action":"a","outcome":"response","status":0}',
        'MACRO_PROBE {"action":"a","outcome":"no_response"}',
        'MACRO_PROBE {"action":"a","outcome":"response","status":200}',
      ].join('\n'),
      '',
    );
    expect(classifyProbe(parsed, { oomKilled: true }).actions.a).toBe('contained');
  });

  test('actions are listed in the a to e order of Requirement 12.3', () => {
    // Feature: macro, Property 24: Containment_Probe classification
    expect(PROBE_ACTIONS.map((a) => a.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
