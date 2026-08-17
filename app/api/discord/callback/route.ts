/**
 * GET /api/discord/callback
 *
 * Step 2. Discord sends the user back here with ?code & ?state.
 * We:
 *   1. verify state (CSRF)
 *   2. exchange code -> tokens
 *   3. read their Discord identity
 *   4. store the link
 *   5. add them to the AI LAB server if needed and sync the Předplatné role
 *
 * This route is the ONLY place a Discord id enters the system, so all the
 * validation lives here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, fetchCurrentUser, OAUTH_SCOPES } from '@/lib/discord';
import { verifyState, STATE_COOKIE } from '@/lib/state';
import { getCurrentUserId } from '@/lib/auth';
import { upsertLink, syncDiscordRole } from '@/lib/db';

export const dynamic = 'force-dynamic';

function back(req: NextRequest, path: string, params: Record<string, string>) {
  const url = new URL(path, process.env.APP_URL ?? req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // User pressed "Cancel" on Discord's consent screen.
  if (sp.get('error')) {
    return back(req, '/account', { discord: 'cancelled' });
  }

  const code = sp.get('code');
  const state = sp.get('state');
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !cookieState || state !== cookieState) {
    return back(req, '/account', { discord: 'error', reason: 'bad_state' });
  }

  const payload = verifyState(state);
  if (!payload) {
    return back(req, '/account', { discord: 'error', reason: 'expired_state' });
  }

  // The session must still belong to the same user who started the flow.
  const sessionUserId = await getCurrentUserId();
  if (!sessionUserId || sessionUserId !== payload.userId) {
    return back(req, '/account', { discord: 'error', reason: 'session_mismatch' });
  }

  try {
    const tokens = await exchangeCode(code);

    // Discord can return fewer scopes than requested if the user edits consent.
    const granted = new Set(tokens.scope.split(' '));
    const missing = OAUTH_SCOPES.filter((s) => !granted.has(s));
    if (missing.includes('identify')) {
      return back(req, payload.returnTo, { discord: 'error', reason: 'missing_scope' });
    }

    const me = await fetchCurrentUser(tokens.access_token);

    await upsertLink({
      userId: payload.userId,
      discordId: me.id,
      username: me.global_name ?? me.username,
      avatar: me.avatar,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSeconds: tokens.expires_in,
    });

    // Add to guild (if guilds.join was granted) + grant/revoke the role.
    const result = await syncDiscordRole(payload.userId, {
      accessToken: granted.has('guilds.join') ? tokens.access_token : undefined,
      reason: 'Discord linked from website',
    });

    return back(req, payload.returnTo, {
      discord: 'linked',
      role: result.action,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg === 'DISCORD_ALREADY_LINKED') {
      return back(req, payload.returnTo, { discord: 'error', reason: 'already_linked' });
    }

    console.error('[discord/callback]', msg);
    return back(req, payload.returnTo, { discord: 'error', reason: 'server_error' });
  }
}
