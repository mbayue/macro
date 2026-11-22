import { describe, expect, test } from 'bun:test';
import {
  parseScenarioTemplates,
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
