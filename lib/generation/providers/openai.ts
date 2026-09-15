/**
 * lib/generation/providers/openai.ts
 *
 * OpenAI Images priamo (gpt-image-*). Rovnaká úvaha ako pri Google:
 * bez prostredníka, ale s vlastným úložiskom a vlastnou moderáciou.
 *
 * Limity sú na projekt (RPM/TPM podľa tieru) — sto ľudí naraz zvládne
 * vyšší tier bez problémov, nižší začne vracať 429. Fronta to ustojí:
 * 429 je označené ako opakovateľné, úloha sa vráti do frontu a skúsi znova
 * s odstupom namiesto toho, aby padla užívateľovi pod rukami.
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

const BASE = (process.env.OPENAI_API_BASE ?? 'https://api.openai.com').replace(/\/+$/, '');
const CAS_MS = Number(process.env.GEN_INLINE_TIMEOUT_MS ?? 180_000);

function kluc(): string {
  const k = process.env.OPENAI_API_KEY?.trim();
  if (!k) throw new ChybaPoskytovatela('nenastavene', 'OPENAI_API_KEY nie je nastavený', false);
  return k;
}

/** Pomer strán z katalógu na veľkosti, ktoré OpenAI pozná. */
function velkost(vstup: Record<string, unknown>): string {
  const pomer = String(vstup.aspect_ratio ?? '1:1');
  if (pomer === '16:9' || pomer === '3:2' || pomer === '21:9') return '1536x1024';
  if (pomer === '9:16' || pomer === '2:3') return '1024x1536';
  if (pomer === 'auto') return 'auto';
  return '1024x1024';
}

function obrazkyNaUpravu(vstup: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ['image_urls', 'image_input', 'image_url']) {
    const v = vstup[k];
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === 'string'));
  }
  return out;
}

export const openai: Poskytovatel = {
  id: 'openai',
  rezim: 'inline',

  nastaveny: () => Boolean(process.env.OPENAI_API_KEY?.trim()) && uloziskoNastavene(),
  coChyba: () => `OPENAI_API_KEY a úložisko (${coChybaUlozisku()})`,

  async odosli(z: ZadanieVstup): Promise<Zadanie> {
    const prompt = String(z.vstup.prompt ?? '');
    const upravy = obrazkyNaUpravu(z.vstup);
    const jeUprava = upravy.length > 0;

    let res: Response;

    if (jeUprava) {
      // Úprava ide ako multipart — súbory sa posielajú v tele, nie odkazom.
      const form = new FormData();
      form.append('model', z.providerModel);
      form.append('prompt', prompt);
      form.append('size', velkost(z.vstup));
      for (const adresa of upravy) {
        const { bajty, contentType } = await stiahniVstup(adresa);
        form.append('image[]', new Blob([new Uint8Array(bajty)], { type: contentType }), 'vstup.png');
      }
      res = await fetchSCasovymStropom(
        `${BASE}/v1/images/edits`,
        { method: 'POST', headers: { Authorization: `Bearer ${kluc()}` }, body: form },
        CAS_MS,
      );
    } else {
      const telo: Record<string, unknown> = {
        model: z.providerModel,
        prompt,
        n: 1,
        size: velkost(z.vstup),
      };
      if (z.vstup.background) telo.background = String(z.vstup.background);
      if (z.vstup.output_format) telo.output_format = String(z.vstup.output_format);

      res = await fetchSCasovymStropom(
        `${BASE}/v1/images/generations`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${kluc()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(telo),
        },
        CAS_MS,
      );
    }

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 400 && /moderation|safety|content_policy/i.test(text)) {
        throw new ChybaPoskytovatela('moderacia', `OpenAI zadanie odmietol: ${text.slice(0, 300)}`, false, 400);
      }
      throw zHttpStavu(res.status, text);
    }

    const json = JSON.parse(text) as { data?: { b64_json?: string; url?: string }[] };
    const subory: Subor[] = [];

    for (const [i, polozka] of (json.data ?? []).entries()) {
      if (polozka.b64_json) {
        const adresa = await ulozVystup(
          new Uint8Array(Buffer.from(polozka.b64_json, 'base64')),
          'image/png',
          `jobs/${z.jobId}/${i}.png`,
        );
        subory.push({ url: adresa, typ: 'obrazok', nazov: `${i}.png` });
      } else if (polozka.url) {
        subory.push({ url: polozka.url, typ: 'obrazok' });
      }
    }

    if (subory.length === 0) {
      throw new ChybaPoskytovatela('prazdny_vysledok', 'OpenAI nevrátil žiadny obrázok.', false);
    }

    return { druh: 'hotovo', vysledok: { subory, jednotiek: subory.length } };
  },

  async zisti(): Promise<StavUlohy> {
    return { stav: 'bezi' };
  },
};
