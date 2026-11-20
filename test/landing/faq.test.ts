import { describe, expect, test } from 'bun:test';
import { home, select } from './helpers.ts';

describe('home page FAQ', () => {
  const QUESTIONS = [
    'Can Macro test my own site today?',
    'What stops someone using it as a DDoS tool?',
    'What does the AI decide, and what does code decide?',
    'Can the AI make up numbers in the report?',
    'Is Macro free?',
    'What runs inside the sandbox?',
    'Where does the traffic come from?',
  ];

  test('asks every existing question under "Before you ask"', async () => {
    expect((await select(home, 'h2')).map((h) => h.text)).toContain('Before you ask');
    expect((await select(home, 'details summary')).map((s) => s.text)).toEqual(QUESTIONS);
  });

  test('opens one answer at a time: native details sharing one name, the first open on load', async () => {
    const cards = await select(home, 'details');
    expect(cards.length).toBe(QUESTIONS.length);
    expect(new Set(cards.map((d) => d.attrs.get('name'))).size).toBe(1);
    expect(cards[0]?.attrs.get('name')).toBeTruthy();
    expect(cards.map((d) => d.attrs.has('open'))).toEqual(QUESTIONS.map((_, i) => i === 0));
    expect(cards[0]?.text).toContain('DNS TXT record');
  });
});
