import { describe, expect, test } from 'bun:test';
import { journeyGroups } from '../src/plan/journey-edit.ts';

describe('journeyGroups', () => {
  test('locks the homepage, splits defaults, and flags overflow only for pages that should have started on', () => {
    const rows = [
      { id: 'r1', path: '/', kind: 'document', defaultOn: true },
      { id: 'r2', path: '/about', kind: 'page', defaultOn: true },
      { id: 'r3', path: '/logo.webp', kind: 'asset', defaultOn: false },
      { id: 'r4', path: '/account/logout', kind: 'page', defaultOn: false },
    ];
    const groups = journeyGroups(rows);
    expect(groups.locked.map((row) => row.path)).toEqual(['/']);
    expect(groups.on.map((row) => row.path)).toEqual(['/about']);
    expect(groups.off.map((row) => row.path)).toEqual(['/logo.webp', '/account/logout']);
    expect(groups.overflow).toBe(false);

    const overflow = journeyGroups([
      ...rows,
      { id: 'r5', path: '/late', kind: 'page', defaultOn: false },
      { id: 'r6', path: '/app.css', kind: 'style', defaultOn: false },
    ]);
    expect(overflow.overflow).toBe(true);
  });
});
