/** Magic-link token hashing and Resend mailer (injectable). */

import { createHash } from 'node:crypto';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export function hashMagicToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateMagicToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

export interface ResendMailer {
  sendMagicLink(input: { to: string; url: string }): Promise<{ ok: true } | { ok: false }>;
}

/** The waitlist invite. Same account and sender identity as the magic link. */
export interface InviteMailer {
  sendInvite(input: { to: string }): Promise<{ ok: true } | { ok: false }>;
}

export const INVITE_SUBJECT = "You're in: Macro early access";

export const INVITE_BODY = [
  'Hi,',
  '',
  'You asked to hear when Macro could take you, and that time is now.',
  '',
  'Macro turns the traffic you expect into a staged load test. You describe the event in plain words, an AI drafts the plan, a fixed gate checks it, and k6 runs it in a sandbox that can reach only your target. The report gives you safe capacity, the breaking point, and the first route that slowed down.',
  '',
  'Start here: https://macro.my.id/app/',
  '',
  'The demo shop is open to everyone. Testing your own site needs sign-in and a one-time check that you control the domain.',
  '',
  'If something breaks or looks wrong, reply to this email.',
  '',
  'Macro',
].join('\n');

export function createResendMailer(opts: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): ResendMailer & InviteMailer {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const send = async (message: { from: string; to: string; subject: string; text: string }): Promise<{ ok: true } | { ok: false }> => {
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...message, to: [message.to] }),
      });
      return res.ok ? { ok: true } : { ok: false };
    } catch {
      return { ok: false };
    }
  };
  return {
    async sendMagicLink(input) {
      return send({
        from: opts.from,
        to: input.to,
        subject: 'Sign in to Macro',
        text: `Sign in to Macro with this link (expires in 15 minutes):\n\n${input.url}\n\nIf you did not ask for this, ignore the email.`,
      });
    },
    async sendInvite(input) {
      return send({ from: opts.from, to: input.to, subject: INVITE_SUBJECT, text: INVITE_BODY });
    },
  };
}
