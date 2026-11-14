// Report_Export CSV: the flat measured-rows table the browser downloads. Pure
// functions over CapacityReport; no AI text is consulted and no DOM is touched.
import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { buildReport } from '../src/report/build.ts';
import type { CapacityReport } from '../src/report/build.ts';
import { csvField, reportCsvFilename, reportCsvRows, reportToCsv } from '../src/report/export.ts';
import { REPORT_PLAN, arbStageRows, metricsOf, reportInputOf, stageMetricsOf } from './arb-agents.ts';

/** Two measured stages with overall and per-route metrics (catalog routes, thresholds 1500/2). */
function twoStageReport(planName?: string): CapacityReport {
  const stages = [0, 1].map((i) => ({
    index: i,
    vus: (i + 1) * 10,
    durationSec: 30,
    status: 'done' as const,
    metrics: stageMetricsOf(metricsOf(1400 + i * 100, 1), {
      store_home: metricsOf(1600, 0), // p95 over the 1500 ms limit -> exceeded
      catalog_list: metricsOf(900, 1), // within both limits
    }),
    verdict: 'pass' as const,
  }));
  const plan = planName === undefined ? REPORT_PLAN : { ...REPORT_PLAN, name: planName };
  return buildReport(reportInputOf(stages, { plan }));
}

/** Minimal RFC 4180 reader for the round-trip properties (CRLF, quoted fields, doubled quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\r' && text[i + 1] === '\n') {
      i++;
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

describe('report CSV header and file shape', () => {
  const report = twoStageReport();

  test('the header is CSV_COLUMNS and the file starts with the BOM', () => {
    const text = reportToCsv(report);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1, text.indexOf('\r\n'))).toBe(
      'run_id,plan_name,plan_hash,target,run_status,sandbox_runtime,safe_capacity_vus,breaking_point_vus,first_degraded_route,p95_limit_ms,error_rate_limit_pct,stage,vus,duration_sec,scope,route,requests,requests_per_sec,error_rate_pct,http_429,p50_ms,p95_ms,p99_ms,verdict,note',
    );
    expect(text.endsWith('\r\n')).toBe(true);
  });

  test('data rows: one overall plus one per route, in stage then catalog order', () => {
    const rows = reportCsvRows(report);
    expect(rows).toHaveLength(1 + 6); // header + 2 stages x (1 overall + 2 routes)
    const scopes = rows.slice(1).map((r) => r[14]);
    expect(scopes).toEqual(['overall', 'route', 'route', 'overall', 'route', 'route']);
    const routes = rows.slice(1).filter((r) => r[14] === 'route').map((r) => r[15]);
    expect(routes).toEqual(['store_home', 'catalog_list', 'store_home', 'catalog_list']);
  });

  test('overall rows repeat the run and headline values, with raw numbers', () => {
    const rows = reportCsvRows(report);
    const first = rows[1]!;
    expect(first[0]).toBe('run-fixture');
    expect(first[1]).toBe('Sample plan');
    expect(first[3]).toBe('https://yue.macro.my.id');
    expect(first[4]).toBe('completed');
    expect(first[5]).toBe('runsc');
    expect(first[9]).toBe('1500');
    expect(first[10]).toBe('2');
    expect(first[11]).toBe('1'); // display index
    expect(first[12]).toBe('10'); // VUs
    expect(first[13]).toBe('30'); // duration
    expect(first[16]).toBe('1000'); // requests, raw
    expect(first[20]).toBe('700'); // p50 raw
    expect(first[22]).toBe('1410'); // p99 raw (p95 + 10 in the fixture)
    expect(first[23]).toBe('pass');
    expect(first[24]).toBe('');
  });

  test('route rows carry the route id and exceeded/within from the thresholds', () => {
    const rows = reportCsvRows(report);
    const routeRows = rows.slice(1).filter((r) => r[14] === 'route');
    expect(routeRows[0]![15]).toBe('store_home');
    expect(routeRows[0]![23]).toBe('exceeded'); // p95 1600 over 1500
    expect(routeRows[1]![23]).toBe('within'); // p95 900, error 1% under both
  });

  test('a safe capacity of 20 and empty breaking point land as raw values', () => {
    const rows = reportCsvRows(report);
    expect(rows[1]![6]).toBe('20'); // both stages pass, so the highest VU count is safe
    expect(rows[1]![7]).toBe(''); // breaking point not reached
    expect(rows[1]![8]).toBe('store_home'); // first route over the p95 limit, at stage 1
  });

  test('an error stage produces one overall row with empty metrics and the reason', () => {
    const report = buildReport(
      reportInputOf([
        { index: 0, vus: 10, durationSec: 30, status: 'error', errorReason: 'Sandbox reported an error.' },
      ]),
    );
    const rows = reportCsvRows(report);
    expect(rows).toHaveLength(2);
    const row = rows[1]!;
    expect(row[11]).toBe('1');
    expect(row[14]).toBe('overall');
    expect(row.slice(16, 23)).toEqual(['', '', '', '', '', '', '']);
    expect(row[23]).toBe('error');
    expect(row[24]).toBe('Sandbox reported an error.');
  });

  test('the filename carries the run id', () => {
    expect(reportCsvFilename('d28cacd6')).toBe('macro-report-d28cacd6.csv');
  });
});

describe('report CSV escaping', () => {
  test.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['a"b', '"a""b"'],
    ['a\nb', '"a\nb"'],
    ['a\rb', '"a\rb"'],
    ['', ''],
  ])('csvField(%p) is %p', (input, expected) => {
    expect(csvField(input)).toBe(expected);
  });

  test('a plan name with any characters round-trips through the file', () => {
    const arbName = fc.string({ minLength: 0, maxLength: 80 });
    fc.assert(
      fc.property(arbName, (name) => {
        const rows = parseCsv(reportToCsv(twoStageReport(name)));
        expect(rows[1]![1]).toBe(name);
      }),
    );
  });

  test('every row of an arbitrary report has exactly the header count of cells', () => {
    fc.assert(
      fc.property(arbStageRows, (stageRows) => {
        const rows = reportCsvRows(buildReport(reportInputOf(stageRows)));
        for (const row of rows) expect(row).toHaveLength(25);
      }),
    );
  });
});
