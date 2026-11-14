/**
 * Waitlist admin, run on the VM inside the API container:
 *
 *   docker exec macro-api bun src/admin/waitlist.ts list              # CSV: email, signed up, invited, joined
 *   docker exec macro-api bun src/admin/waitlist.ts invite <email>    # one invite (--force re-sends)
 *   docker exec macro-api bun src/admin/waitlist.ts invite --all      # every not-yet-invited address
 *   docker exec macro-api bun src/admin/waitlist.ts remove <email>    # a deletion request
 *
 * Reads DATA_DIR (default /var/lib/macro), the same database the API uses. SQLite runs in
 * WAL mode, so this is safe while the API is running. Sending needs RESEND_API_KEY and
 * RESEND_FROM in the environment (the API container has them when accounts are on).
 */
import { createResendMailer } from '../auth/magic-link.ts';
import { inviteAddress, inviteAll } from './invite.ts';
import { normaliseEmail } from '../server.ts';
import { Store } from '../store/db.ts';

const args = process.argv.slice(2);
const [command, ...rest] = args;
const store = Store.open(process.env['DATA_DIR'] ?? '/var/lib/macro');

function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function inviteMailer(): ReturnType<typeof createResendMailer> {
  const apiKey = process.env['RESEND_API_KEY'];
  const from = process.env['RESEND_FROM'];
  if (apiKey === undefined || apiKey === '' || from === undefined || from === '') {
    console.error('Invite needs RESEND_API_KEY and RESEND_FROM in the environment; nothing was sent.');
    process.exit(2);
  }
  return createResendMailer({ apiKey, from });
}

function usage(): never {
  console.error('Usage: bun src/admin/waitlist.ts list | invite <email> [--force] | invite --all | remove <email>');
  process.exit(2);
}

switch (command) {
  case 'list': {
    const rows = store.listWaitlist();
    console.log('email,signed_up_utc,invited_utc,joined_utc');
    for (const r of rows) {
      const t = (v: number | null): string => (v === null ? '' : new Date(v).toISOString());
      console.log(`${csvCell(r.email)},${t(r.createdAt)},${t(r.invitedAt)},${t(r.joinedAt)}`);
    }
    console.error(`${rows.length} address(es).`);
    break;
  }
  case 'invite': {
    const force = rest.includes('--force');
    const all = rest.includes('--all');
    const emailArg = rest.find((a) => !a.startsWith('--'));
    if (all && (emailArg !== undefined || force)) usage();
    if (!all && emailArg === undefined) usage();
    const mailer = inviteMailer();
    if (all) {
      const results = await inviteAll(store, mailer, { now: Date.now() });
      for (const r of results) console.log(`${r.email}: ${r.outcome}`);
      console.error(`${results.length} invite attempt(s).`);
      break;
    }
    const email = normaliseEmail(emailArg!);
    if (email === null) usage();
    const outcome = await inviteAddress(store, mailer, email, { force, now: Date.now() });
    const hint =
      outcome === 'already_invited'
        ? ' (use --force to re-send)'
        : outcome === 'failed'
          ? ' (nothing was recorded; re-run to retry)'
          : '';
    console.log(`${email}: ${outcome}${hint}`);
    break;
  }
  case 'remove': {
    const email = rest[0] === undefined ? null : normaliseEmail(rest[0]);
    if (email === null) usage();
    console.log(store.removeWaitlistEmail(email) ? `Removed ${email}.` : `${email} was not on the list.`);
    break;
  }
  default:
    usage();
}
