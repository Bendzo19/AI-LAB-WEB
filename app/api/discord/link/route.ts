/**
 * GET /api/discord/link
 *
 * Step 1 of the flow. The "Prepojiť Discord" button on the website points here.
 * Requires the user to be logged in on the website — that is what ties the
 * Discord account to the right website account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildAuthorizeUrl } from '@/lib/discord';
import { createState, STATE_COOKIE } from '@/lib/state';
import { getCurrentUserId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();

  if (!userId) {
    const login = new URL('/login', process.env.APP_URL ?? req.nextUrl.origin);
    login.searchParams.set('next', '/api/discord/link');
    return NextResponse.redirect(login);
  }

  const returnTo = req.nextUrl.searchParams.get('returnTo') ?? '/account';
  const state = createState(userId, returnTo);

  const res = NextResponse.redirect(buildAuthorizeUrl(state));

  // The cookie is the other half of the CSRF check.
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',       // must be lax, not strict — Discord redirects back cross-site
    path: '/',
    maxAge: 600,           // 10 min
  });

  return res;
}
