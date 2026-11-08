import { isIP } from 'node:net';

export const UNKNOWN_IP = 'unknown';

/**
 * Client IP from the `CF-Connecting-IP` header only (requirement 9.10). The macro VM's firewall
 * accepts only Cloudflare ranges, so the header can be trusted. Never falls back to
 * `X-Forwarded-For` or the socket address; a missing or invalid header yields `'unknown'`
 * (callers treat that as one shared bucket). `socketAddress` is accepted and deliberately ignored.
 */
export function clientIp(req: Request, _socketAddress?: string): string {
  const value = req.headers.get('cf-connecting-ip')?.trim();
  if (value === undefined || value === '' || isIP(value) === 0) return UNKNOWN_IP;
  return value;
}
