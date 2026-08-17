/**
 * lib/state.ts
 *
 * CSRF protection for the OAuth round-trip.
 *
 * We sign a random nonce + the website user id with an HMAC and store it in a
 * short-lived httpOnly cookie. On callback we verify the `state` query param
 * matches the cookie AND the signature. Without this, an attacker can trick a
 * logged-in user into linking the ATTACKER'S Discord account to the victim's
 * website account (or vice versa).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TTL_MS = 10 * 60 * 1000; // 10 minutes

function secret(): string {
  const s = process.env.DISCORD_STATE_SECRET;
  if (!s || s.length < 32) {
    throw new Error('DISCORD_STATE_SECRET must be set to at least 32 chars');
  }
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export interface StatePayload {
  userId: string;
  nonce: string;
  issuedAt: number;
  /** where to send the user after a successful link */
  returnTo: string;
}

export function createState(userId: string, returnTo = '/account'): string {
  const payload: StatePayload = {
    userId,
    nonce: randomBytes(16).toString('base64url'),
    issuedAt: Date.now(),
    returnTo,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyState(state: string): StatePayload | null {
  const dot = state.lastIndexOf('.');
  if (dot < 1) return null;

  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload.issuedAt || Date.now() - payload.issuedAt > TTL_MS) return null;
  // Only allow same-origin relative redirects.
  if (!payload.returnTo?.startsWith('/')) payload.returnTo = '/account';
  return payload;
}

export const STATE_COOKIE = 'discord_oauth_state';
