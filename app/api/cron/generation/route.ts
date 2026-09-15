/**
 * GET|POST /api/cron/generation
 *
 * Údržba fronty. Nie je to „worker", ktorý by generovanie poháňal — bežná
 * cesta ide cez request a callback. Toto je poistka, ktorá dorieši to,
 * čo mohlo vypadnúť:
 *
 *   1. úlohy uviaznuté v odosielaní (spadol proces uprostred)
 *   2. úlohy čakajúce na uvoľnenie stropu
 *   3. bežiace úlohy, na ktoré nedorazil callback
 *   4. úlohy po časovom strope -> zavrieť a vrátiť kredity
 *   5. mesačné kredity predplatiteľov
 *
 * Nasadenie (netlify.toml / vercel.json): každú minútu. Aj keby cron
 * nebežal vôbec, systém funguje — len sa výsledky dotiahnu neskôr, pri
 * pohľade klienta na stav úlohy.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  dotiahniBeziace,
  odosliCakajuce,
  prehladFronty,
  zachranUviaznute,
} from '@/lib/generation/jobs';
import { pridelMesacneKredity } from '@/lib/generation/granty';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function povoleny(req: NextRequest): boolean {
  const tajne = process.env.CRON_SECRET;
  if (!tajne) return process.env.NODE_ENV !== 'production';

  const hlavicka = req.headers.get('authorization');
  if (hlavicka === `Bearer ${tajne}`) return true;
  return req.nextUrl.searchParams.get('secret') === tajne;
}

async function spusti(req: NextRequest) {
  if (!povoleny(req)) {
    return NextResponse.json({ error: 'neopravnene' }, { status: 401 });
  }

  const zaciatok = Date.now();

  const uviaznute = await zachranUviaznute();
  const pustene = await odosliCakajuce();
  const dotiahnute = await dotiahniBeziace();

  // Granty sú lacné (ich idempotencia je jeden INSERT), ale nemá zmysel
  // skúšať ich každú minútu — stačí raz za hodinu.
  const hodina = new Date().getUTCMinutes() < 2;
  const granty = hodina ? await pridelMesacneKredity() : { pridelene: 0, preskocene: 0 };

  return NextResponse.json({
    ok: true,
    trvanie_ms: Date.now() - zaciatok,
    uviaznute_opravene: uviaznute,
    pustene: pustene.pustene,
    caka: pustene.caka,
    dotiahnute: dotiahnute.dotiahnute,
    vyprsane: dotiahnute.vyprsane,
    granty,
    fronta: await prehladFronty(),
  });
}

export const GET = spusti;
export const POST = spusti;
