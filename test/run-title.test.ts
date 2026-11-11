import { describe, expect, test } from 'bun:test';
import { LOAD_TEST_TITLE, normalizeRunTitle } from '../src/run/title.ts';

describe('normalizeRunTitle', () => {
  test('collapses whitespace and falls back when empty', () => {
    expect(normalizeRunTitle('  Uma   Banner \n Launch  ')).toBe('Uma Banner Launch');
    expect(normalizeRunTitle('   ')).toBe(LOAD_TEST_TITLE);
    expect(normalizeRunTitle(null)).toBe(LOAD_TEST_TITLE);
  });

  test('caps at 80 characters', () => {
    const long = 'A'.repeat(90);
    expect(normalizeRunTitle(long)).toBe('A'.repeat(80));
  });
});
