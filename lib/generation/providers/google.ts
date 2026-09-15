/**
 * lib/generation/providers/google.ts
 *
 * Google priamo — Gemini (obrázkové modely, „nano banana") aj Imagen.
 *
 * Kedy to má zmysel oproti kie.ai:
 *   + platíš Google priamo, bez marže prostredníka
 *   + limity si dvíhaš sám v Google Cloud (kvóta na projekt, nie na cudzí účet)
 *   − moderáciu Googlu nevypneš a robíš si vlastné účtovanie za neúspechy
 *   − výsledok chodí v tele odpovede, takže potrebuješ úložisko
 *
 * Toto je „inline" poskytovateľ: jedno volanie trvá celé generovanie.
 * Fronta ho preto spúšťa na pozadí — request užívateľa naň nečaká.
 */

import {
  ChybaPoskytovatela,
  fetchSCasovymStropom,
  zHttpStavu,
  type Poskytovatel,
  type StavUlohy,
  type Subor,
  type Zadanie,
  type ZadanieVstup,
} from './types';
import { stiahniVstup, ulozVystup, uloziskoNastavene, coChybaUlozisku } from './storage';

const BASE = (process.env.GOOGLE_API_BASE ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
const CAS_MS = Number(process.env.GEN_INLINE_TIMEOUT_MS ?? 180_000);

function kluc(): string {
  const k = process.env.GOOGLE_API_KEY?.trim() ?? process.env.GEMINI_API_KEY?.trim();
  if (!k) throw new ChybaPoskytovatela('nenastavene', 'GOOGLE_API_KEY nie je nastavený', false);
  return k;
}

function vstupneObrazky(vstup: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const kluc of ['image_urls', 'image_input', 'image_url', 'first_frame_url', 'reference_image_urls']) {
    const v = vstup[kluc];
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === 'string'));
  }
  return out;
}

interface GeminiCast {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

export const google: Poskytovatel = {
  id: 'google',
  rezim: 'inline',

  nastaveny: () =>
    Boolean((process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY)?.trim()) && uloziskoNastavene(),
  coChyba: () => `GOOGLE_API_KEY a úložisko (${coChybaUlozisku()})`,

  async odosli(z: ZadanieVstup): Promise<Zadanie> {
    const prompt = String(z.vstup.prompt ?? '');
    const jeImagen = /imagen/i.test(z.providerModel);

    const url = jeImagen
      ? `${BASE}/v1beta/models/${encodeURIComponent(z.providerModel)}:predict`
      : `${BASE}/v1beta/models/${encodeURIComponent(z.providerModel)}:generateContent`;

    let telo: Record<string, unknown>;

    if (jeImagen) {
      telo = {
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          ...(z.vstup.aspect_ratio ? { aspectRatio: String(z.vstup.aspect_ratio) } : {}),
        },
      };
    } else {
      const casti: GeminiCast[] = [{ text: prompt }];
      for (const adresa of vstupneObrazky(z.vstup)) {
        const { bajty, contentType } = await stiahniVstup(adresa);
        casti.push({
          inlineData: { mimeType: contentType, data: Buffer.from(bajty).toString('base64') },
        });
      }
      telo = {
        contents: [{ role: 'user', parts: casti }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      };
    }

    const res = await fetchSCasovymStropom(
      url,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': kluc(), 'Content-Type': 'application/json' },
        body: JSON.stringify(telo),
      },
      CAS_MS,
    );

    const text = await res.text();
    if (!res.ok) {
      // 400 s blokovaním je moderácia — opakovanie by nepomohlo.
      if (res.status === 400 && /safety|blocked|prohibited/i.test(text)) {
        throw new ChybaPoskytovatela('moderacia', `Google zadanie odmietol: ${text.slice(0, 300)}`, false, 400);
      }
      throw zHttpStavu(res.status, text);
    }

    const json = JSON.parse(text) as {
      candidates?: { content?: { parts?: GeminiCast[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
    };

    if (json.promptFeedback?.blockReason) {
      throw new ChybaPoskytovatela(
        'moderacia',
        `Google zadanie zablokoval: ${json.promptFeedback.blockReason}`,
        false,
      );
    }

    const subory: Subor[] = [];
    let index = 0;

    const uloz = async (b64: string, mime: string) => {
      const pripona = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const adresa = await ulozVystup(
        new Uint8Array(Buffer.from(b64, 'base64')),
        mime,
        `jobs/${z.jobId}/${index}.${pripona}`,
      );
      subory.push({ url: adresa, typ: 'obrazok', nazov: `${index}.${pripona}` });
      index += 1;
    };

    for (const p of json.predictions ?? []) {
      if (p.bytesBase64Encoded) await uloz(p.bytesBase64Encoded, p.mimeType ?? 'image/png');
    }
    for (const c of json.candidates ?? []) {
      for (const cast of c.content?.parts ?? []) {
        const data = cast.inlineData?.data ?? cast.inline_data?.data;
        const mime = cast.inlineData?.mimeType ?? cast.inline_data?.mime_type ?? 'image/png';
        if (data) await uloz(data, mime);
      }
    }

    if (subory.length === 0) {
      throw new ChybaPoskytovatela(
        'prazdny_vysledok',
        'Google odpovedal, ale bez obrázka (často to znamená tichú moderáciu).',
        false,
      );
    }

    return { druh: 'hotovo', vysledok: { subory, jednotiek: subory.length } };
  },

  async zisti(): Promise<StavUlohy> {
    // Inline poskytovateľ nemá čo dopytovať — výsledok je hotový hneď.
    return { stav: 'bezi' };
  },
};
