/**
 * Waitlist invite decisions (design "Sending"). Pure over the Store and an
 * InviteMailer: who gets an email, what is recorded, and what a re-run retries.
 * The CLI (src/admin/waitlist.ts) is the only caller in production; there is no
 * HTTP endpoint.
 */
import type { InviteMailer } from '../auth/magic-link.ts';
import type { Store } from '../store/db.ts';

export type InviteOutcome = 'not_on_list' | 'already_invited' | 'sent' | 'failed';

/**
 * Invites one address. `force` re-sends an already-invited address and moves
 * its invited_at; a failed send records nothing, so a re-run retries it.
 */
export async function inviteAddress(
  store: Store,
  mailer: InviteMailer,
  email: string,
  opts: { force: boolean; now: number },
): Promise<InviteOutcome> {
  const row = store.getWaitlist(email);
  if (row === null) return 'not_on_list';
  if (row.invitedAt !== null && !opts.force) return 'already_invited';
  const sent = (await mailer.sendInvite({ to: email })).ok;
  if (!sent) return 'failed';
  store.markWaitlistInvited(email, opts.now);
  return 'sent';
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Invites every address with no invited_at, oldest first, one email per
 * address, `gapMs` apart (0 in tests). Never re-sends: an already-invited or
 * failed address keeps its state, so re-running retries exactly the failures.
 */
export async function inviteAll(
  store: Store,
  mailer: InviteMailer,
  opts: { now: number; gapMs?: number },
): Promise<{ email: string; outcome: InviteOutcome }[]> {
  const targets = store.listWaitlist().filter((r) => r.invitedAt === null);
  const out: { email: string; outcome: InviteOutcome }[] = [];
  for (const [i, row] of targets.entries()) {
    if (i > 0) await sleep(opts.gapMs ?? 200);
    out.push({ email: row.email, outcome: await inviteAddress(store, mailer, row.email, { force: false, now: opts.now }) });
  }
  return out;
}
