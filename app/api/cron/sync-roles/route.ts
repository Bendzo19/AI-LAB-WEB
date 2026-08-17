/**
 * GET/POST /api/cron/sync-roles
 *
 * Reconciliation job. Webhooks get lost, subscriptions lapse silently at
 * period end, and people leave and rejoin the server. This walks every linked
 * account and makes Discord match the database.
 *
 * Run it hourly.
 *
 * Vercel — vercel.json:
 *   { "crons": [{ "path": "/api/cron/sync-roles", "schedule": "0 * * * *" }] }
 *   (Vercel sends `Authorization: Bearer $CRON_SECRET` automatically)
 *
 * Anywhere else:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://tvojadomena.sk/api/cron/sync-roles
 */

import { NextRequest, NextResponse } from 'next/server';
import { listLinksWithEntitlement } from '@/lib/db';
import {
  DISCORD,
  fetchGuildMember,
  grantRole,
  revokeRole,
} from '@/lib/discord';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // seconds, if your host supports it

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const roleId = DISCORD.subscriberRoleId;
  const links = await listLinksWithEntitlement();

  const stats = {
    checked: 0,
    granted: 0,
    revoked: 0,
    notInGuild: 0,
    unchanged: 0,
    errors: [] as { discordId: string; error: string }[],
  };

  for (const link of links) {
    stats.checked += 1;
    try {
      const member = await fetchGuildMember(link.discordId);
      if (!member) {
        stats.notInGuild += 1;
        continue;
      }

      const hasRole = member.roles.includes(roleId);

      if (link.shouldHaveRole && !hasRole) {
        await grantRole(link.discordId, roleId, 'cron sync: subscription active');
        stats.granted += 1;
      } else if (!link.shouldHaveRole && hasRole) {
        await revokeRole(link.discordId, roleId, 'cron sync: subscription inactive');
        stats.revoked += 1;
      } else {
        stats.unchanged += 1;
      }
    } catch (err) {
      stats.errors.push({
        discordId: link.discordId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Stay well inside Discord's per-route rate limit.
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log('[cron/sync-roles]', JSON.stringify(stats));
  return NextResponse.json(stats);
}

export const POST = GET;
