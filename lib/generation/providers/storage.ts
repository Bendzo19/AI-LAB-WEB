/**
 * lib/generation/providers/storage.ts
 *
 * Kam uložiť výsledok, keď ho poskytovateľ pošle ako bajty a nie ako
 * adresu. Týka sa to priamych integrácií (Google, OpenAI) — kie.ai vracia
 * hotové odkazy a toto nepotrebuje.
 *
 * Bez nastaveného úložiska sa priame integrácie nespustia. Je to zámer:
 * tichý fallback na `data:` URL by nafúkol databázu o megabajty na každý
 * obrázok a prišlo by sa na to až keď je neskoro.
 */

import { ChybaPoskytovatela } from './types';

export type DruhUloziska = 'supabase' | 'data' | 'none';

export function typUloziska(): DruhUloziska {
  const v = (process.env.GEN_STORAGE ?? '').trim().toLowerCase();
  if (v === 'supabase' || v === 'data' || v === 'none') return v;
  // Keď sú vyplnené supabase premenné, netreba to nikde duplikovať.
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return 'supabase';
  return 'none';
}

export function uloziskoNastavene(): boolean {
  return typUloziska() !== 'none';
}

export function coChybaUlozisku(): string {
  return 'GEN_STORAGE=supabase + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + GEN_STORAGE_BUCKET';
}

const MAX_DATA_URL = 4 * 1024 * 1024; // 4 MB

/**
 * Uloží bajty a vráti verejnú adresu.
 *
 * @param cesta relatívna cesta v bucket-e, napr. `jobs/<jobId>/0.png`
 */
export async function ulozVystup(
  bajty: Uint8Array,
  contentType: string,
  cesta: string,
): Promise<string> {
  const kam = typUloziska();

  if (kam === 'none') {
    throw new ChybaPoskytovatela(
      'bez_uloziska',
      'Priami poskytovatelia (Google, OpenAI) vracajú súbor v tele odpovede a ' +
        `potrebujú úložisko. Nastav ${coChybaUlozisku()}.`,
      false,
    );
  }

  if (kam === 'data') {
    if (bajty.byteLength > MAX_DATA_URL) {
      throw new ChybaPoskytovatela(
        'prilis_velke',
        `Výsledok má ${(bajty.byteLength / 1e6).toFixed(1)} MB a GEN_STORAGE=data zvládne do 4 MB. ` +
          'Na produkciu nastav skutočné úložisko.',
        false,
      );
    }
    return `data:${contentType};base64,${Buffer.from(bajty).toString('base64')}`;
  }

  const base = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const kluc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.GEN_STORAGE_BUCKET ?? 'generations';
  if (!base || !kluc) {
    throw new ChybaPoskytovatela('bez_uloziska', `Chýba ${coChybaUlozisku()}.`, false);
  }

  const cielova = `${base}/storage/v1/object/${bucket}/${cesta}`;
  const res = await fetch(cielova, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kluc}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: Buffer.from(bajty),
  });

  if (!res.ok) {
    const telo = await res.text();
    throw new ChybaPoskytovatela(
      'ulozisko_zlyhalo',
      `Nahranie výsledku do Supabase zlyhalo (${res.status}): ${telo.slice(0, 300)}`,
      res.status >= 500,
      res.status,
    );
  }

  return `${base}/storage/v1/object/public/${bucket}/${cesta}`;
}

/** Stiahne vstupný súbor (referenčný obrázok) pre poskytovateľov, ktorí berú bajty. */
export async function stiahniVstup(url: string, maxBajtov = 20 * 1024 * 1024): Promise<{ bajty: Uint8Array; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ChybaPoskytovatela('vstup_nedostupny', `Vstupný súbor sa nedá stiahnuť (${res.status}): ${url}`, false, res.status);
  }
  const dlzka = Number(res.headers.get('content-length') ?? 0);
  if (dlzka > maxBajtov) {
    throw new ChybaPoskytovatela('vstup_velky', `Vstupný súbor má viac než ${Math.round(maxBajtov / 1e6)} MB.`, false);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBajtov) {
    throw new ChybaPoskytovatela('vstup_velky', `Vstupný súbor má viac než ${Math.round(maxBajtov / 1e6)} MB.`, false);
  }
  return { bajty: buf, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
}
