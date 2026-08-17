/**
 * lib/auth.ts
 *
 * ADAPTER — replace the body of getCurrentUserId() with your real session
 * lookup. Everything else in this integration goes through this one function,
 * so this is the only file you need to touch to wire it into your auth.
 *
 * It MUST return the id of the logged-in website user, or null.
 * If this ever returns the wrong user, someone links the wrong Discord account.
 */

import { cookies } from 'next/headers';

export async function getCurrentUserId(): Promise<string | null> {
  /* ---- Example A: NextAuth / Auth.js -------------------------------
  import { auth } from '@/auth';
  const session = await auth();
  return session?.user?.id ?? null;
  ------------------------------------------------------------------- */

  /* ---- Example B: Supabase ----------------------------------------
  import { createServerClient } from '@supabase/ssr';
  const supabase = createServerClient(...);
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
  ------------------------------------------------------------------- */

  /* ---- Example C: Clerk -------------------------------------------
  import { auth } from '@clerk/nextjs/server';
  const { userId } = await auth();
  return userId;
  ------------------------------------------------------------------- */

  // ---- Placeholder: signed session cookie -------------------------
  // Remove this once you plug in the real thing.
  const jar = await cookies();
  const raw = jar.get('session_user_id')?.value;
  return raw ?? null;
}

/** Throwing variant for route handlers. */
export async function requireUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) throw new Response('Unauthorized', { status: 401 });
  return id;
}
