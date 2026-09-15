/**
 * GET /api/credits
 *
 * Zostatok + posledné pohyby. Používa to odznak v hlavičke aj stránka účtu.
 */

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { historiaKreditov, stavUctu, zabezpecUcet } from '@/lib/generation/credits';
import { GEN } from '@/lib/generation/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'neprihlaseny' }, { status: 401 });

  await zabezpecUcet(userId);
  const [stav, historia] = await Promise.all([stavUctu(userId), historiaKreditov(userId, 30)]);

  return NextResponse.json({
    zostatok: stav.balance,
    drzane: stav.reserved,
    spolu_nabite: stav.lifetime_topup,
    spolu_minute: stav.lifetime_spent,
    kredit_usd: GEN.creditUsd,
    historia,
  });
}
