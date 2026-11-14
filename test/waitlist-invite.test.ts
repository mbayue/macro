// Waitlist activation: the invite email (Resend) and the sending decisions.
// The mailer posts to Resend; inviteAddress/inviteAll decide who is invited,
// what is recorded, and what a re-run retries.
import { describe, expect, test } from 'bun:test';
import { createResendMailer, INVITE_BODY, INVITE_SUBJECT } from '../src/auth/magic-link.ts';
import type { InviteMailer } from '../src/auth/magic-link.ts';
import { inviteAddress, inviteAll } from '../src/admin/invite.ts';
import { Store } from '../src/store/db.ts';
import { asFetch } from './arb-agents.ts';

const FROM = 'Macro <hello@macro.my.id>';
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeResend(respond?: (init: RequestInit) => Response): { mailer: InviteMailer; seen: Seen[] } {
  const seen: Seen[] = [];
  const mailer = createResendMailer({
    apiKey: 'test-resend-key',
    from: FROM,
    fetchImpl: asFetch(async (url, init) => {
      seen.push({ url: String(url), init });
      return respond?.(init) ?? new Response('{}', { status: 200 });
    }),
  });
  return { mailer, seen };
}

function countingMailer(): { mailer: InviteMailer; sent: string[]; failNext: { value: boolean } } {
  const sent: string[] = [];
  const failNext = { value: false };
  const mailer: InviteMailer = {
    async sendInvite(input) {
      if (failNext.value) return { ok: false };
      sent.push(input.to);
      return { ok: true };
    },
  };
  return { mailer, sent, failNext };
}

function seededStore(emails: readonly string[]): Store {
  const store = new Store(':memory:');
  emails.forEach((email, i) => store.addWaitlistEmail(email, NOW + i));
  return store;
}

describe('sendInvite', () => {
  test('posts the from, to, subject and body to Resend', async () => {
    const { mailer, seen } = fakeResend();
    expect(await mailer.sendInvite({ to: 'ana@shop.example.com' })).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(seen[0]!.init.body as string) as Record<string, unknown>;
    expect(body['from']).toBe(FROM);
    expect(body['to']).toEqual(['ana@shop.example.com']);
    expect(body['subject']).toBe(INVITE_SUBJECT);
    expect(body['text']).toBe(INVITE_BODY);
    expect(INVITE_SUBJECT).toBe("You're in: Macro early access");
    expect(INVITE_BODY).toContain('https://macro.my.id/app/');
  });

  test('a non-ok Resend answer and a transport error are ok:false, never thrown', async () => {
    const failing = fakeResend(() => new Response('no', { status: 429 }));
    expect(await failing.mailer.sendInvite({ to: 'a@shop.example.com' })).toEqual({ ok: false });
    const throwing = createResendMailer({
      apiKey: 'k',
      from: FROM,
      fetchImpl: asFetch(() => Promise.reject(new TypeError('fetch failed'))),
    });
    expect(await throwing.sendInvite({ to: 'a@shop.example.com' })).toEqual({ ok: false });
  });
});

describe('inviteAddress', () => {
  test('an address that is not on the list is refused without sending', async () => {
    const store = seededStore([]);
    const { mailer, sent } = countingMailer();
    expect(await inviteAddress(store, mailer, 'ghost@shop.example.com', { force: false, now: NOW })).toBe('not_on_list');
    expect(sent).toEqual([]);
    expect(store.getWaitlist('ghost@shop.example.com')).toBeNull();
  });

  test('a send marks invited_at; a failure records nothing and stays retryable', async () => {
    const store = seededStore(['ana@shop.example.com']);
    const ok = countingMailer();
    expect(await inviteAddress(store, ok.mailer, 'ana@shop.example.com', { force: false, now: NOW })).toBe('sent');
    expect(ok.sent).toEqual(['ana@shop.example.com']);
    expect(store.getWaitlist('ana@shop.example.com')?.invitedAt).toBe(NOW);

    const bad = countingMailer();
    bad.failNext.value = true;
    expect(await inviteAddress(store, bad.mailer, 'ana@shop.example.com', { force: true, now: NOW + 1 })).toBe('failed');
    expect(store.getWaitlist('ana@shop.example.com')?.invitedAt).toBe(NOW); // unchanged
  });

  test('an invited address is skipped unless forced', async () => {
    const store = seededStore(['ana@shop.example.com']);
    const { mailer, sent } = countingMailer();
    await inviteAddress(store, mailer, 'ana@shop.example.com', { force: false, now: NOW });
    expect(await inviteAddress(store, mailer, 'ana@shop.example.com', { force: false, now: NOW + 1 })).toBe(
      'already_invited',
    );
    expect(sent).toHaveLength(1); // no second send
    expect(await inviteAddress(store, mailer, 'ana@shop.example.com', { force: true, now: NOW + 2 })).toBe('sent');
    expect(sent).toHaveLength(2);
    expect(store.getWaitlist('ana@shop.example.com')?.invitedAt).toBe(NOW + 2);
  });
});

describe('inviteAll', () => {
  test('invites the uninvited oldest first and stops the list from re-sending', async () => {
    const store = seededStore(['b@shop.example.com', 'a@shop.example.com', 'c@shop.example.com']);
    store.markWaitlistInvited('c@shop.example.com', NOW - 5);
    const { mailer, sent } = countingMailer();
    const results = await inviteAll(store, mailer, { now: NOW, gapMs: 0 });
    expect(results.map((r) => [r.email, r.outcome])).toEqual([
      ['b@shop.example.com', 'sent'],
      ['a@shop.example.com', 'sent'],
    ]);
    expect(sent).toEqual(['b@shop.example.com', 'a@shop.example.com']);
    expect(store.getWaitlist('c@shop.example.com')?.invitedAt).toBe(NOW - 5);
  });

  test('a failed address keeps invited_at null, so a re-run retries exactly it', async () => {
    const store = seededStore(['a@shop.example.com', 'b@shop.example.com']);
    const { mailer, sent, failNext } = countingMailer();
    failNext.value = true;
    const first = await inviteAll(store, mailer, { now: NOW, gapMs: 0 });
    expect(first.map((r) => r.outcome)).toEqual(['failed', 'failed']);
    expect(store.getWaitlist('a@shop.example.com')?.invitedAt).toBeNull();
    failNext.value = false;
    const second = await inviteAll(store, mailer, { now: NOW + 1, gapMs: 0 });
    expect(second.map((r) => r.outcome)).toEqual(['sent', 'sent']);
    expect(sent).toEqual(['a@shop.example.com', 'b@shop.example.com']); // failures never reached the mailer
  });
});
