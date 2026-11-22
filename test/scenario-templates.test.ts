import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseActiveAnnouncement,
  parseFeaturedRuns,
  parseQaPrompts,
  parseScenarioTemplates,
  type FeaturedRunItem,
  type ScenarioTemplate,
} from '../web/landing/src/app/lib/scenario-templates.ts';

const FALLBACK: readonly ScenarioTemplate[] = [
  { label: 'Campaign spike', text: 'A marketing campaign brings 300 visitors to the home page over ten minutes.' },
];

describe('parseScenarioTemplates', () => {
  test('returns sorted active templates and drops invalid, inactive, or duplicate entries', () => {
    const parsed = parseScenarioTemplates(
      [
        { label: 'Flash drop', text: 'Ramp from 50 to 400 shoppers over 6 minutes hitting the home page.', order: 2, active: true },
        { label: 'Disabled', text: 'Should not appear because active is false in Firestore.', order: 1, active: false },
        { label: 'Too short', text: 'short', order: 0, active: true },
        { label: 'Campaign spike', text: 'A marketing campaign brings 300 visitors to the home page over ten minutes.', order: 1, active: true },
        { label: 'Flash drop', text: 'Duplicate label should be ignored cleanly by the parser.', order: 3, active: true },
      ],
      FALLBACK,
    );

    expect(parsed).toEqual([
      { label: 'Campaign spike', text: 'A marketing campaign brings 300 visitors to the home page over ten minutes.' },
      { label: 'Flash drop', text: 'Ramp from 50 to 400 shoppers over 6 minutes hitting the home page.' },
    ]);
  });

  test('falls back to built-in examples when no valid Firestore templates exist', () => {
    expect(parseScenarioTemplates([], FALLBACK)).toEqual(FALLBACK);
    expect(
      parseScenarioTemplates([{ label: 'Inactive', text: 'Valid length text here.', order: 1, active: false }], FALLBACK),
    ).toEqual(FALLBACK);
  });
});

describe('parseQaPrompts', () => {
  const DEFAULT_QA = ['Why did this run pass or fail?'] as const;

  test('returns sorted active Report Q&A questions and falls back when empty', () => {
    const parsed = parseQaPrompts(
      [
        { question: 'Did any stage hit HTTP 429 rate limits?', order: 2, active: true },
        { question: 'Hidden draft question', order: 0, active: false },
        { question: 'Why?', order: 0, active: true },
        { question: 'Which route was slowest and by how much?', order: 1, active: true },
        { question: 'Did any stage hit HTTP 429 rate limits?', order: 3, active: true },
      ],
      DEFAULT_QA,
    );
    expect(parsed).toEqual([
      'Which route was slowest and by how much?',
      'Did any stage hit HTTP 429 rate limits?',
    ]);
    expect(parseQaPrompts([], DEFAULT_QA)).toEqual(DEFAULT_QA);
  });
});

describe('parseFeaturedRuns', () => {
  const FALLBACK_RUNS: readonly FeaturedRunItem[] = [
    { runId: 'c520df16-b31f-4cbc-81fc-14d8ee822d04', label: 'View sample report', summary: 'Completed demo run.' },
  ];

  test('returns sorted active featured runs with safe IDs and falls back when empty', () => {
    const parsed = parseFeaturedRuns(
      [
        { runId: 'c520df16-b31f-4cbc-81fc-14d8ee822d04', label: '200 VU spike', summary: 'Safe at 200 VUs.', order: 2, active: true },
        { runId: '../bad/path', label: 'Bad ID', summary: 'Should be rejected.', order: 0, active: true },
        { runId: 'd28cacd6-0000-4000-8000-000000000000', label: '100 VU baseline', summary: 'Passed all stages.', order: 1, active: true },
        { runId: 'aaaaaaaa-0000-4000-8000-000000000000', label: 'Inactive', summary: 'Hidden run.', order: 0, active: false },
      ],
      FALLBACK_RUNS,
    );
    expect(parsed).toEqual([
      { runId: 'd28cacd6-0000-4000-8000-000000000000', label: '100 VU baseline', summary: 'Passed all stages.' },
      { runId: 'c520df16-b31f-4cbc-81fc-14d8ee822d04', label: '200 VU spike', summary: 'Safe at 200 VUs.' },
    ]);
    expect(parseFeaturedRuns([], FALLBACK_RUNS)).toEqual(FALLBACK_RUNS);
  });
});

describe('parseActiveAnnouncement', () => {
  test('returns the highest-priority active announcement or null when none are active', () => {
    expect(parseActiveAnnouncement([])).toBeNull();
    expect(
      parseActiveAnnouncement([{ message: 'Maintenance soon.', tone: 'warn', order: 1, active: false }]),
    ).toBeNull();
    expect(
      parseActiveAnnouncement([
        { message: 'Lower priority info.', tone: 'info', order: 2, active: true },
        { message: 'Generator maintenance in 5 min.', tone: 'warn', order: 1, active: true },
        { message: 'Invalid tone ignored.', tone: 'danger', order: 0, active: true },
      ]),
    ).toEqual({
      message: 'Generator maintenance in 5 min.',
      tone: 'warn',
    });
  });
});

describe('firestore.rules & firebase.json', () => {
  test('wires firestore.rules with default-deny, bounded list limit, and no open client writes', () => {
    const root = join(import.meta.dir, '..');
    const firebaseJson = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8')) as {
      firestore?: { rules?: string };
    };
    expect(firebaseJson.firestore?.rules).toBe('firestore.rules');

    const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');
    expect(rules).toContain('match /scenario_templates/{templateId}');
    expect(rules).toContain('match /qa_prompts/{promptId}');
    expect(rules).toContain('match /featured_runs/{docId}');
    expect(rules).toContain('match /announcements/{announcementId}');
    expect(rules).toContain('allow read, write: if false;');
    expect(rules).toContain('request.query.limit');
    expect(rules).not.toMatch(/allow\s+(write|create|update|delete)\s*:\s*if\s+true\b/);
  });
});
