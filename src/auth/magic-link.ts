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

export function createResendMailer(opts: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): ResendMailer {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    async sendMagicLink(input) {
      try {
        const res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: opts.from,
            to: [input.to],
            subject: 'Sign in to Macro',
            text: `Sign in to Macro with this link (expires in 15 minutes):\n\n${input.url}\n\nIf you did not ask for this, ignore the email.`,
          }),
        });
        return res.ok ? { ok: true } : { ok: false };
      } catch {
        return { ok: false };
      }
    },
  };
}
