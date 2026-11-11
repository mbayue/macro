import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { InferenceClient } from '../src/agents/inference.ts';
import {
  MAX_EXPLANATION_CHARS,
  MAX_SUGGESTIONS,
  MAX_SUGGESTION_CHARS,
  NOTE_UNAVAILABLE,
  NOTE_WITHHELD,
  REPORTER_SYSTEM_PROMPT,
  reportToPromptText,
  templateExplanation,
  writeReport,
} from '../src/agents/reporter.ts';
import { buildReport } from '../src/report/build.ts';
import type { AiSection, CapacityReport } from '../src/report/build.ts';
import { allowedNumbers, guardText } from '../src/report/number-guard.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, chatResponse, metricsOf, reportInputOf, stageMetricsOf, testConfig, toolCallOf } from './arb-agents.ts';

// A report with measured Stages: 10 VUs pass, 20 VUs pass, 30 VUs fail on p95.
const REPORT: CapacityReport = buildReport(
  reportInputOf([
    { index: 0, vus: 10, durationSec: 30, status: 'done', metrics: stageMetricsOf(metricsOf(200, 0.5), { store_home: metricsOf(180) }) },
    { index: 1, vus: 20, durationSec: 30, status: 'done', metrics: stageMetricsOf(metricsOf(900, 1.2)) },
    { index: 2, vus: 30, durationSec: 30, status: 'done', metrics: stageMetricsOf(metricsOf(2400, 3.1), { catalog_list: metricsOf(2600) }) },
  ]),
);
const ALLOWED = allowedNumbers(REPORT);
const ALLOWED_LIST = [...ALLOWED].filter((n) => Number.isInteger(n) && n >= 0);

function reporterFor(respond: () => Response | Promise<Response>): { client: InferenceClient; calls: () => number; store: Store } {
  let n = 0;
  const store = new Store(':memory:');
  const fetchImpl = asFetch(async () => {
    n += 1;
    return respond();
  });
  return { client: new InferenceClient({ config: testConfig().inference, fetchImpl, store }), calls: () => n, store };
}

async function writeWith(args: unknown, report: CapacityReport = REPORT): Promise<AiSection> {
  const { client } = reporterFor(() => chatResponse([toolCallOf('write_report', args)]));
  return writeReport({ client }, report, { runId: 'run-fixture' });
}

// ---- generators ---------------------------------------------------------------

const arbWord = fc.stringMatching(/^[a-z]{1,9}$/);
const arbAllowedNumber = fc.constantFrom(...ALLOWED_LIST).map(String);
// 7-digit values never appear among the Run's allowed numbers.
const arbForeignNumber = fc.integer({ min: 1_000_000, max: 9_999_999 }).map(String);

/** Text of `words` words with numbers sprinkled in; `foreign` controls how often a bad number appears. */
function arbText(foreignWeight: number): fc.Arbitrary<string> {
  return fc
    .array(
      fc.oneof(
        { weight: 6, arbitrary: arbWord },
        { weight: 2, arbitrary: arbAllowedNumber },
        { weight: foreignWeight, arbitrary: arbForeignNumber },
      ),
      { minLength: 1, maxLength: 60 },
    )
    .map((parts) => parts.join(' '));
}

/** Lengths straddling the caps. */
const arbLongText: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(1, 50, 299, 300, 301, 1499, 1500, 1501, 2200), fc.constantFrom('a', 'é', '😀', 'ab '))
  .map(([n, unit]) => unit.repeat(n));

const arbSuggestion = fc.oneof({ weight: 5, arbitrary: arbText(1) }, { weight: 1, arbitrary: arbLongText });
const arbExplanation = fc.oneof({ weight: 5, arbitrary: arbText(1) }, { weight: 2, arbitrary: arbLongText });

const len = (s: string): number => Array.from(s).length;

describe('Property 22: AI text shown is bounded and verified', () => {
  test('output is capped, every shown text passes the Number_Guard, and replaced or removed text is marked', async () => {
    // Feature: macro, Property 22: AI text shown is bounded and verified
    await fc.assert(
      fc.asyncProperty(arbExplanation, fc.array(arbSuggestion, { maxLength: 9 }), async (explanation, suggestions) => {
        const out = await writeWith({ explanation, suggestions });

        expect(['ok', 'withheld']).toContain(out.status);
        const shownSuggestions = out.suggestions ?? [];
        expect(shownSuggestions.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
        expect(len(out.explanation ?? '')).toBeLessThanOrEqual(MAX_EXPLANATION_CHARS);
        for (const s of shownSuggestions) expect(len(s)).toBeLessThanOrEqual(MAX_SUGGESTION_CHARS);

        // Every text shown passes the guard against the Run's Allowed_Numbers (template text included).
        expect(guardText(out.explanation ?? '', ALLOWED)).toEqual({ ok: true });
        for (const s of shownSuggestions) expect(guardText(s, ALLOWED)).toEqual({ ok: true });

        // Reference for what must be kept: first 5, cut to 300 / 1,500 code points, then guarded.
        const cut = (text: string, max: number): string => Array.from(text).slice(0, max).join('');
        const explanationCut = cut(explanation, MAX_EXPLANATION_CHARS);
        const explanationBad = !guardText(explanationCut, ALLOWED).ok;
        const keptRef = suggestions.slice(0, MAX_SUGGESTIONS).map((s) => cut(s, MAX_SUGGESTION_CHARS)).filter((s) => guardText(s, ALLOWED).ok);
        const removedRef = Math.min(suggestions.length, MAX_SUGGESTIONS) - keptRef.length;

        expect(out.explanation).toBe(explanationBad ? templateExplanation(REPORT) : explanationCut);
        expect(out.suggestions).toEqual(keptRef);
        expect(out.status).toBe(explanationBad ? 'withheld' : 'ok');
        // Each replaced or removed text is marked.
        expect(out.notes).toEqual(explanationBad || removedRef > 0 ? [NOTE_WITHHELD] : []);
      }),
      { numRuns: 200 },
    );
  });

  test('a Supervisor reason is held to the same rule (see controller.test.ts for the Run_Controller property)', () => {
    // The controller applies guardText over allowedNumbers to a reason; this pins that the same
    // guard rejects a foreign number and accepts every allowed one.
    for (const n of ALLOWED_LIST.slice(0, 20)) expect(guardText(`p95 near ${n} ms`, ALLOWED)).toEqual({ ok: true });
    expect(guardText('p95 near 7654321 ms', ALLOWED)).toEqual({ ok: false, offending: [7654321] });
  });
});

describe('Report_Writer examples', () => {
  test('only the first 5 suggestions are considered; a bad one is removed and noted', async () => {
    const out = await writeWith({
      explanation: 'Capacity held up to 20 VUs.',
      suggestions: ['one', 'two 9999999', 'three', 'four', 'five', 'six'],
    });
    expect(out).toEqual({ status: 'ok', explanation: 'Capacity held up to 20 VUs.', suggestions: ['one', 'three', 'four', 'five'], notes: [NOTE_WITHHELD] });
  });

  test('a failing explanation is replaced by the fixed template and marked withheld', async () => {
    const out = await writeWith({ explanation: 'It broke at 4242424 VUs.', suggestions: [] });
    expect(out.status).toBe('withheld');
    expect(out.explanation).toBe(templateExplanation(REPORT));
    expect(out.explanation).toContain('Safe capacity: 20 virtual users');
    expect(out.explanation).toContain('breaking point: 30 virtual users');
    expect(out.explanation).toContain('catalog_list');
    expect(out.notes).toEqual([NOTE_WITHHELD]);
  });

  test('truncation happens before the guard: a number cut in half is judged as cut', async () => {
    // The cap keeps 1,496 padding characters plus "999", which is not an allowed number.
    const padding = 'a '.repeat(748); // 1,496 characters
    const out = await writeWith({ explanation: `${padding}9999999`, suggestions: [] });
    expect(out.status).toBe('withheld');
    const ok = await writeWith({ explanation: `${padding}1 2 3 4 5 6 7 8 9`, suggestions: [] });
    expect(len(ok.explanation ?? '')).toBe(MAX_EXPLANATION_CHARS);
    expect(ok.status).toBe('ok');
  });

  test('the explanation is cut at 1,500 characters and suggestions at 300 and counted in code points', async () => {
    const out = await writeWith({ explanation: '😀'.repeat(1600), suggestions: ['é'.repeat(400)] });
    expect(len(out.explanation ?? '')).toBe(1500);
    expect(len(out.suggestions?.[0] ?? '')).toBe(300);
    expect(out.notes).toEqual([]);
  });

  test('only the first write_report call is used', async () => {
    const { client } = reporterFor(() =>
      chatResponse([
        toolCallOf('something_else', { explanation: 'ignored' }),
        toolCallOf('write_report', { explanation: 'first', suggestions: ['s1'] }),
        toolCallOf('write_report', { explanation: 'second', suggestions: ['s2'] }),
      ]),
    );
    const out = await writeReport({ client }, REPORT, { runId: 'r' });
    expect(out).toMatchObject({ status: 'ok', explanation: 'first', suggestions: ['s1'] });
  });

  test('no write_report call, malformed arguments, or an empty explanation make the AI section unavailable', async () => {
    const unavailable: AiSection = { status: 'unavailable', notes: [NOTE_UNAVAILABLE] };
    const none = reporterFor(() => chatResponse([toolCallOf('other', {})]));
    expect(await writeReport({ client: none.client }, REPORT, { runId: 'r' })).toEqual(unavailable);
    expect(await writeWith('{not json')).toEqual(unavailable);
    expect(await writeWith([])).toEqual(unavailable);
    expect(await writeWith({ explanation: '   ', suggestions: [] })).toEqual(unavailable);
    expect(await writeWith({ suggestions: ['x'] })).toEqual(unavailable);
  });

  test('both models failing leaves headline data intact and an unavailable note', async () => {
    const failing = reporterFor(() => new Response('down', { status: 503 }));
    const out = await writeReport({ client: failing.client }, REPORT, { runId: 'r' });
    expect(out).toEqual({ status: 'unavailable', notes: [NOTE_UNAVAILABLE] });
    expect(failing.calls()).toBe(2);
    expect(failing.store.listModelCallsForRun('r').map((r) => r.agent)).toEqual(['reporter', 'reporter']);
  });

  test('a Run with no Stage_Metrics makes no request', async () => {
    const empty = buildReport(reportInputOf([{ index: 0, vus: 10, durationSec: 30, status: 'error', errorReason: 'boom' }]));
    const { client, calls } = reporterFor(() => chatResponse([toolCallOf('write_report', { explanation: 'x', suggestions: [] })]));
    expect(await writeReport({ client }, empty, { runId: 'r' })).toEqual({ status: 'unavailable', notes: [] });
    expect(calls()).toBe(0);
  });

  test('the prompt text carries the stored numbers, so they are citable', () => {
    const text = reportToPromptText(REPORT);
    expect(text).toContain('Safe capacity: 20 VUs');
    expect(text).toContain('Breaking point: 30 VUs');
    expect(text).toContain('p95 2400 ms');
    expect(text).toContain('catalog_list');
  });

  test('the template explanation itself passes the guard for any report', () => {
    expect(guardText(templateExplanation(REPORT), ALLOWED)).toEqual({ ok: true });
  });
});

const OWN_ROUTES = [
  { id: 'r1', method: 'GET', path: '/', kind: 'document' },
  { id: 'r2', method: 'GET', path: '/assets/index-DvJJu3n8.js', kind: 'script' },
  { id: 'r3', method: 'GET', path: '/assets/app.12345.css', kind: 'style' },
];

const OWN_REPORT: CapacityReport = buildReport(
  reportInputOf(
    [
      {
        index: 0,
        vus: 25,
        durationSec: 30,
        status: 'done',
        metrics: stageMetricsOf(metricsOf(827, 0), { r2: metricsOf(827), r3: metricsOf(270) }),
      },
    ],
    { routeOrder: ['r1', 'r2', 'r3'] },
  ),
);

describe('Report_Writer route legend', () => {
  test('discovered routes replace the demo catalog', () => {
    const text = reportToPromptText(OWN_REPORT, OWN_ROUTES);
    expect(text).toContain('r2: GET /assets/index-DvJJu3n8.js (script)');
    expect(text).toContain('r3: GET /assets/app.12345.css (style)');
    expect(text).not.toContain('catalog_list');
    expect(text).not.toContain('/api/v1/products');
  });

  test('an empty discovered list does not fall back to the demo catalog', () => {
    const text = reportToPromptText(OWN_REPORT, []);
    expect(text).not.toContain('/api/v1/products');
    expect(text).not.toContain('store_home');
  });

  test('no discovered list still lists the demo catalog', () => {
    const text = reportToPromptText(REPORT);
    expect(text).toContain('catalog_list: GET /api/v1/products (api)');
  });

  test('the system prompt names the site under test, not a shop', () => {
    expect(REPORTER_SYSTEM_PROMPT).not.toContain('shop');
    expect(REPORTER_SYSTEM_PROMPT).toContain('path listed');
  });

  test('a number that appears only in a supplied path stays in the explanation', async () => {
    let user = '';
    const store = new Store(':memory:');
    const fetchImpl = asFetch(async (_input, init) => {
      const raw = typeof init.body === 'string' ? init.body : '';
      const body = JSON.parse(raw) as { messages?: { role?: string; content?: string }[] };
      user = body.messages?.find((m) => m.role === 'user')?.content ?? '';
      return chatResponse([
        toolCallOf('write_report', {
          explanation: 'The slow file is /assets/app.12345.css.',
          suggestions: ['Cache /assets/app.12345.css.'],
        }),
      ]);
    });
    const client = new InferenceClient({ config: testConfig().inference, fetchImpl, store });
    const out = await writeReport({ client }, OWN_REPORT, { runId: 'r', routes: OWN_ROUTES });
    expect(user).toContain('r3: GET /assets/app.12345.css (style)');
    expect(user).not.toContain('/api/v1/products');
    expect(out).toMatchObject({
      status: 'ok',
      explanation: 'The slow file is /assets/app.12345.css.',
      suggestions: ['Cache /assets/app.12345.css.'],
    });
  });

  test('the same path number is withheld when no routes were supplied', async () => {
    const out = await writeWith({
      explanation: 'The slow file is /assets/app.12345.css.',
      suggestions: [],
    });
    expect(out.status).toBe('withheld');
  });
});
