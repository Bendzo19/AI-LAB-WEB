/**
 * POST /api/webhooks/generation/<poskytovatel>?job=<id>&t=<token>
 *
 * Poskytovateľ sem zavolá, keď je výsledok hotový. Toto je to, vďaka čomu
 * nikto nemusí nič dopytovať dokola — a teda aj to, prečo sto súbežných
 * generovaní nerobí sto bežiacich spojení.
 *
 * Bezpečnosť: adresa obsahuje id úlohy a jej jednorazový token. Bez
 * zhodného tokenu sa payload zahodí — inak by ktokoľvek vedel podstrčiť
 * „hotovo" na cudziu úlohu a nechať si ju zaúčtovať.
 *
 * Odpoveď je 200 aj pri neznámej úlohe: opakovanie by nič nezmenilo.
 * 500 vraciame len pri našej chybe, aby to poskytovateľ skúsil znova.
 */

import { NextRequest, NextResponse } from 'next/server';
import { spracujCallback } from '@/lib/generation/jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const jobId = req.nextUrl.searchParams.get('job');
  const token = req.nextUrl.searchParams.get('t');

  if (!jobId || !token) {
    return NextResponse.json({ ok: false, preco: 'chybajuce_parametre' }, { status: 400 });
  }

  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    // Niektorí poskytovatelia posielajú prázdne telo a stav si máme dotiahnuť.
    payload = null;
  }

  try {
    const vysledok = await spracujCallback(provider, jobId, token, payload);
    return NextResponse.json({ ok: vysledok.spracovane, preco: vysledok.preco ?? null });
  } catch (err) {
    console.error('[webhook/generation]', err);
    return NextResponse.json({ ok: false, preco: 'chyba_servera' }, { status: 500 });
  }
}

/** Niektorí poskytovatelia si adresu najprv overia GET-om. */
export async function GET() {
  return NextResponse.json({ ok: true });
}
