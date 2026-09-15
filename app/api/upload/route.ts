/**
 * POST /api/upload   (multipart/form-data, pole `file`)
 *
 * Nahranie vstupného súboru pre modely, ktoré pracujú s referenciou
 * (úprava fotky, rozhýbanie obrázka, lipsync).
 *
 * Vracia verejnú adresu — tú potom formulár pošle do `polia`. Poskytovateľ
 * si súbor stiahne sám, takže adresa musí byť dostupná zvonku; preto to
 * ide do toho istého úložiska ako výstupy (GEN_STORAGE).
 *
 * Bez nastaveného úložiska vracia 503 s návodom namiesto tichého zlyhania.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getCurrentUserId } from '@/lib/auth';
import { coChybaUlozisku, ulozVystup, uloziskoNastavene } from '@/lib/generation/providers/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BAJTOV = Number(process.env.GEN_UPLOAD_MAX_MB ?? 25) * 1024 * 1024;

const POVOLENE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
};

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'neprihlaseny' }, { status: 401 });

  if (!uloziskoNastavene()) {
    return NextResponse.json(
      {
        error: 'bez_uloziska',
        sprava: `Nahrávanie súborov potrebuje úložisko. Nastav ${coChybaUlozisku()}.`,
      },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'zle_telo', sprava: 'Očakávam multipart/form-data.' }, { status: 400 });
  }

  const subor = form.get('file');
  if (!(subor instanceof File)) {
    return NextResponse.json({ error: 'chyba_subor', sprava: 'Chýba pole "file".' }, { status: 400 });
  }

  const pripona = POVOLENE[subor.type];
  if (!pripona) {
    return NextResponse.json(
      {
        error: 'zly_typ',
        sprava: `Typ "${subor.type || 'neznámy'}" nepodporujeme. Povolené: ${[...new Set(Object.values(POVOLENE))].join(', ')}.`,
      },
      { status: 415 },
    );
  }

  if (subor.size > MAX_BAJTOV) {
    return NextResponse.json(
      {
        error: 'prilis_velke',
        sprava: `Súbor má ${(subor.size / 1e6).toFixed(1)} MB, maximum je ${Math.round(MAX_BAJTOV / 1e6)} MB.`,
      },
      { status: 413 },
    );
  }

  try {
    const bajty = new Uint8Array(await subor.arrayBuffer());
    const url = await ulozVystup(bajty, subor.type, `uploads/${userId}/${randomUUID()}.${pripona}`);
    return NextResponse.json({ url, typ: subor.type, velkost: subor.size });
  } catch (err) {
    const sprava = err instanceof Error ? err.message : String(err);
    console.error('[upload]', sprava);
    return NextResponse.json({ error: 'nahranie_zlyhalo', sprava }, { status: 502 });
  }
}
