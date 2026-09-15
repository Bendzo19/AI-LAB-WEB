/**
 * lib/generation/providers/mock.ts
 *
 * Poskytovateľ, ktorý nič negeneruje a nič nestojí. Slúži na:
 *
 *   - vývoj bez API kľúčov,
 *   - záťažový test (`npm run loadtest`), kde overujeme, že sto ľudí naraz
 *     naozaj prejde paralelne a že sa kredity nikdy nezdvoja,
 *   - testovanie chybových ciest (zlyhanie, timeout, opakovaný callback).
 *
 * Stav si nedrží v pamäti — čas dokončenia aj výsledok sú zakódované priamo
 * v `taskId`. Vďaka tomu funguje rovnako aj keď beží viac inštancií appky
 * (serverless), kde by pamäť jedného procesu nikomu nepomohla.
 */

import { GEN } from '../config';
import { appUrl } from '../config';
import type { Poskytovatel, StavUlohy, Zadanie, ZadanieVstup } from './types';

const LATENCIA_MS = Number(process.env.GEN_MOCK_LATENCY_MS ?? 400);
const ZLYHA_PCT = Number(process.env.GEN_MOCK_FAIL_PCT ?? 0);

/** 1×1 px PNG — aby mala odpoveď reálne zobraziteľný súbor. */
const UKAZKA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function novyTaskId(zlyha: boolean): string {
  const hotovoO = Date.now() + LATENCIA_MS;
  return `mock_${hotovoO}_${zlyha ? 'fail' : 'ok'}_${Math.random().toString(36).slice(2, 10)}`;
}

function rozober(taskId: string): { hotovoO: number; zlyha: boolean } | null {
  const m = /^mock_(\d+)_(ok|fail)_/.exec(taskId);
  if (!m) return null;
  return { hotovoO: Number(m[1]), zlyha: m[2] === 'fail' };
}

function stavPreId(taskId: string): StavUlohy {
  const r = rozober(taskId);
  if (!r) return { stav: 'chyba', kod: 'neznamy_task', sprava: `mock nepozná úlohu ${taskId}` };
  if (Date.now() < r.hotovoO) return { stav: 'bezi' };
  if (r.zlyha) {
    return { stav: 'chyba', kod: 'mock_zlyhanie', sprava: 'Simulované zlyhanie generovania (mock).' };
  }
  return {
    stav: 'hotovo',
    vysledok: { subory: [{ url: UKAZKA, typ: 'obrazok', nazov: 'mock.png' }] },
  };
}

export const mock: Poskytovatel = {
  id: 'mock',
  rezim: 'async',

  nastaveny: () => true,
  coChyba: () => '',

  async odosli(z: ZadanieVstup): Promise<Zadanie> {
    const zlyha = ZLYHA_PCT > 0 && Math.random() * 100 < ZLYHA_PCT;
    const taskId = novyTaskId(zlyha);

    // Keď je kam, zavoláme callback tak ako skutočný poskytovateľ —
    // testuje sa tým aj webhook, nielen dopytovanie.
    if (z.callbackUrl && process.env.GEN_MOCK_CALLBACK !== '0') {
      const url = z.callbackUrl.startsWith('http') ? z.callbackUrl : `${appUrl()}${z.callbackUrl}`;
      setTimeout(() => {
        void fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 200, data: { taskId } }),
        }).catch(() => undefined);
      }, LATENCIA_MS + 50);
    }

    return { druh: 'prijate', taskId };
  },

  async zisti(taskId: string): Promise<StavUlohy> {
    return stavPreId(taskId);
  },

  zCallbacku(payload: unknown) {
    if (!payload || typeof payload !== 'object') return null;
    const obal = payload as { data?: { taskId?: string }; taskId?: string };
    const taskId = obal.data?.taskId ?? obal.taskId;
    if (!taskId) return null;
    return { taskId, stav: stavPreId(taskId) };
  },
};

/** Koľko mock „generuje" — používa to záťažový test pri čakaní. */
export const mockLatenciaMs = LATENCIA_MS;
export const mockStrop = GEN.maxInflightTotal;
