/**
 * GET /api/models
 *
 * Katalóg pre formulár na webe. Vracia len modely, ktoré majú nastaveného
 * poskytovateľa — nemá zmysel ponúkať tlačidlo, ktoré skončí chybou.
 *
 * Ceny sa počítajú aj tu na serveri; klientska strana ich len zobrazuje.
 */

import { NextResponse } from 'next/server';
import { katalogPreWeb } from '@/lib/generation/providers';
import { uloziskoNastavene } from '@/lib/generation/providers/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const katalog = katalogPreWeb();

  // UI potrebuje vedieť, či má pri súborových poliach ponúkať nahrávanie,
  // alebo len políčko na adresu.
  return NextResponse.json({ ...katalog, nahravanie: uloziskoNastavene() }, {
    headers: { 'Cache-Control': 'private, max-age=30' },
  });
}
