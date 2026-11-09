/**
 * Waitlist admin, run on the VM inside the API container:
 *
 *   docker exec macro-api bun src/admin/waitlist.ts list            # CSV to stdout
 *   docker exec macro-api bun src/admin/waitlist.ts remove <email>  # a deletion request
 *
 * Reads DATA_DIR (default /var/lib/macro), the same database the API uses. SQLite runs in
 * WAL mode, so this is safe while the API is running.
 */
import { normaliseEmail } from '../server.ts';
import { Store } from '../store/db.ts';

const [command, arg] = process.argv.slice(2);
const store = Store.open(process.env['DATA_DIR'] ?? '/var/lib/macro');

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

switch (command) {
  case 'list': {
    const rows = store.listWaitlist();
    console.log('email,signed_up_utc');
    for (const r of rows) console.log(`${csvCell(r.email)},${new Date(r.createdAt).toISOString()}`);
    console.error(`${rows.length} address(es).`);
    break;
  }
  case 'remove': {
    const email = arg === undefined ? null : normaliseEmail(arg);
    if (email === null) {
      console.error('Usage: bun src/admin/waitlist.ts remove <email>');
      process.exit(2);
    }
    console.log(store.removeWaitlistEmail(email) ? `Removed ${email}.` : `${email} was not on the list.`);
    break;
  }
  default:
    console.error('Usage: bun src/admin/waitlist.ts list | remove <email>');
    process.exit(2);
}
