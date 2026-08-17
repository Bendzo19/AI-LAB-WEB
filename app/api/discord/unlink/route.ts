/**
 * POST /api/discord/unlink
 *
 * Removes the link. Also strips the Předplatné role, otherwise an unlinked
 * account would keep paid access forever.
 */

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { deleteLink } from '@/lib/db';
import { revokeRole, revokeToken, DISCORD } from '@/lib/discord';

export const dynamic = 'force-dynamic';

export async function POST() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const link = await deleteLink(userId);
  if (!link) return NextResponse.json({ ok: true, unlinked: false });

  // Strip the role first — losing access matters more than a clean token revoke.
  await revokeRole(link.discord_id, DISCORD.subscriberRoleId, 'Discord unlinked by user')
    .catch((e) => console.error('[discord/unlink] revokeRole', e));

  if (link.access_token) await revokeToken(link.access_token);

  return NextResponse.json({ ok: true, unlinked: true });
}
