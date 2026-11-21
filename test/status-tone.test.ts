import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge, statusTone } from '../web/landing/src/app/components/ui.tsx';
import { statusBadgeKind } from '../web/landing/src/app/lib/report-view.ts';

describe('Run status tone', () => {
  test('a run halted by the Supervisor reads as neutral, not as a warning', () => {
    expect(statusTone('halted')).toBe('neutral');
    expect(statusBadgeKind('halted')).toBe('neutral');
  });

  test('the halted badge keeps the word "halted"', () => {
    const html = renderToStaticMarkup(createElement(StatusBadge, { status: 'halted' }));
    expect(html).toContain('>halted<');
  });

  test('failed and interrupted runs stay destructive; completed stays ok', () => {
    expect(statusTone('failed')).toBe('bad');
    expect(statusTone('interrupted')).toBe('bad');
    expect(statusBadgeKind('failed')).toBe('bad');
    expect(statusTone('completed')).toBe('ok');
    expect(statusBadgeKind('completed')).toBe('ok');
  });
});
