/**
 * lib/generation/providers/index.ts
 *
 * Register poskytovateľov + presmerovanie modelov.
 *
 * Presmerovanie je odpoveď na otázku „ako pustiť Gemini alebo OpenAI
 * priamo": v katalógu zostane ten istý model a tá istá cena, len sa
 * premennou prostredia povie, kto ho má počítať. Žiadna zmena kódu:
 *
 *   GEN_MODEL_ROUTING={"gpt-image-2":"openai:gpt-image-1",
 *                      "nano-banana-pro":"google:gemini-3-pro-image"}
 *
 * A pri vývoji alebo záťažovom teste:
 *
 *   GEN_MOCK=1     všetko ide na mock, nič nestojí a nič sa neodosiela von
 */

import { verejnyKatalog, type Model } from '../catalog';
import type { Poskytovatel } from './types';
import { kie } from './kie';
import { google } from './google';
import { openai } from './openai';
import { mock } from './mock';

const VSETCI: Poskytovatel[] = [kie, google, openai, mock];

export function mockZapnuty(): boolean {
  return process.env.GEN_MOCK === '1';
}

export function poskytovatel(id: string): Poskytovatel | null {
  return VSETCI.find((p) => p.id === id) ?? null;
}

/** Poskytovatelia, ktorí majú kľúče a dajú sa reálne použiť. */
export function nastaveniPoskytovatelia(): Set<string> {
  if (mockZapnuty()) return new Set(['mock']);
  const out = new Set<string>();
  for (const p of VSETCI) {
    if (p.id !== 'mock' && p.nastaveny()) out.add(p.id);
  }
  return out;
}

interface Smerovanie {
  poskytovatel: string;
  providerModel: string;
}

let smerovaniaCache: Record<string, Smerovanie> | null = null;

function smerovania(): Record<string, Smerovanie> {
  if (smerovaniaCache) return smerovaniaCache;

  const surove = process.env.GEN_MODEL_ROUTING?.trim();
  const out: Record<string, Smerovanie> = {};

  if (surove) {
    try {
      const json = JSON.parse(surove) as Record<string, string>;
      for (const [modelId, ciel] of Object.entries(json)) {
        const [pid, ...zvysok] = String(ciel).split(':');
        if (!pid || zvysok.length === 0) {
          console.warn(`[generation] GEN_MODEL_ROUTING["${modelId}"]="${ciel}" — očakávam "poskytovatel:model"`);
          continue;
        }
        if (!poskytovatel(pid)) {
          console.warn(`[generation] GEN_MODEL_ROUTING["${modelId}"] — neznámy poskytovateľ "${pid}"`);
          continue;
        }
        out[modelId] = { poskytovatel: pid, providerModel: zvysok.join(':') };
      }
    } catch (err) {
      console.warn('[generation] GEN_MODEL_ROUTING nie je platný JSON — ignorujem ho.', err);
    }
  }

  smerovaniaCache = out;
  return out;
}

/** Kto a pod akým menom má tento model reálne spustiť. */
export function kamSModelom(m: Model): Smerovanie {
  if (mockZapnuty()) return { poskytovatel: 'mock', providerModel: m.provider_model };
  return smerovania()[m.id] ?? { poskytovatel: m.poskytovatel, providerModel: m.provider_model };
}

/**
 * Katalóg pre web — už s ohľadom na presmerovanie modelov.
 *
 * Toto je jediné miesto, kde sa spája „čo vieme generovať" s „kto to má
 * počítať". Route-y nech volajú toto, nie `verejnyKatalog` priamo.
 */
export function katalogPreWeb() {
  return verejnyKatalog(nastaveniPoskytovatelia(), (m) => kamSModelom(m).poskytovatel);
}

/** Prehľad pre preflight a stránku so stavom. */
export function prehladPoskytovatelov() {
  return VSETCI.map((p) => ({
    id: p.id,
    rezim: p.rezim,
    nastaveny: p.id === 'mock' ? mockZapnuty() : p.nastaveny(),
    coChyba: p.coChyba(),
  }));
}

export { kie, google, openai, mock };
export type { Poskytovatel };
