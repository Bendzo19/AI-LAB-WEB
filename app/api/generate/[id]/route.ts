/**
 * GET /api/generate/<id>
 *
 * Stav jednej úlohy. Klient sa sem pýta, kým beží.
 *
 * Keď callback od poskytovateľa nedorazil (localhost, výpadok webhooku),
 * dotiahneme stav priamo tu. Vďaka tomu funguje generovanie aj bez verejnej
 * adresy — len o niečo pomalšie, lebo sa čaká na najbližší dopyt klienta.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { dotiahniUlohu, ulohaUzivatela } from '@/lib/generation/jobs';
import { verejnaUloha } from '@/lib/generation/verejne';
import { callbacksReachable } from '@/lib/generation/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Ako dlho po odoslaní má zmysel dopytovať sa pri každom pohľade klienta. */
const DOPYT_PO_MS = 3_000;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'neprihlaseny' }, { status: 401 });

  const { id } = await ctx.params;
  let uloha = await ulohaUzivatela(id, userId);
  if (!uloha) return NextResponse.json({ error: 'nenajdene' }, { status: 404 });

  const dostatocneStara =
    uloha.dispatched_at !== null && Date.now() - new Date(uloha.dispatched_at).getTime() > DOPYT_PO_MS;

  if (uloha.status === 'running' && dostatocneStara && !callbacksReachable()) {
    const zmenene = await dotiahniUlohu(uloha);
    if (zmenene) uloha = (await ulohaUzivatela(id, userId)) ?? uloha;
  }

  return NextResponse.json({ uloha: verejnaUloha(uloha) });
}
