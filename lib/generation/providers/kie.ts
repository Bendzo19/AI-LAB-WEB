/**
 * lib/generation/providers/kie.ts
 *
 * kie.ai — jeden účet, jedno API, desiatky modelov (Seedream, Kling, Wan,
 * Nano Banana, Grok…). Presne to, čo katalóg používa dnes.
 *
 * Dôležité pre priepustnosť: kie má asynchrónne API. `createTask` je krátke
 * HTTP volanie (stovky ms), ktoré vráti `taskId` — samotné generovanie beží
 * na ich GPU. Náš request teda nikdy nečaká na obrázok, len na potvrdenie
 * prijatia. Preto sto ľudí naraz znamená sto krátkych volaní, nie sto
 * minút čakania v rade.
 *
 * Výsledok si vyzdvihneme dvoma nezávislými cestami:
 *   1. `callBackUrl` — kie zavolá nás, len čo je hotovo (rýchle)
 *   2. cron dopyt na `recordInfo` — poistka, keď callback nedorazí
 *
 * Tvary odpovedí sa medzi modelmi líšia, preto sa výsledky parsujú
 * tolerantne (viď `pozbierajUrl`) a nie podľa jedného pevného kľúča.
 */

import {
  ChybaPoskytovatela,
  fetchSCasovymStropom,
  pozbierajUrl,
  typPodlaUrl,
  zHttpStavu,
  type Poskytovatel,
  type StavUlohy,
  type Vysledok,
  type Zadanie,
  type ZadanieVstup,
} from './types';
import { GEN } from '../config';

const BASE = (process.env.KIE_API_BASE ?? 'https://api.kie.ai').replace(/\/+$/, '');

function kluc(): string {
  const k = process.env.KIE_API_KEY?.trim();
  if (!k) {
    throw new ChybaPoskytovatela('nenastavene', 'KIE_API_KEY nie je nastavený', false);
  }
  return k;
}

interface KieOdpoved {
  code?: number;
  msg?: string;
  message?: string;
  data?: unknown;
}

async function volaj(cesta: string, init: RequestInit, timeoutMs: number): Promise<KieOdpoved> {
  const res = await fetchSCasovymStropom(
    `${BASE}${cesta}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${kluc()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    },
    timeoutMs,
  );

  const telo = await res.text();
  if (!res.ok) throw zHttpStavu(res.status, telo);

  let json: KieOdpoved;
  try {
    json = JSON.parse(telo) as KieOdpoved;
  } catch {
    throw new ChybaPoskytovatela('zla_odpoved', `kie.ai vrátil nečitateľnú odpoveď: ${telo.slice(0, 200)}`, true);
  }

  // kie vracia HTTP 200 aj pri chybe — skutočný výsledok je v `code`.
  const code = json.code ?? 200;
  if (code !== 200) {
    const sprava = json.msg ?? json.message ?? `kie.ai kód ${code}`;
    throw prelozKod(code, sprava);
  }
  return json;
}

/**
 * Preklad chybového kódu na rozhodnutie „skúsiť znova / vrátiť kredity".
 *
 * 402 je ten, ktorý bolí najviac: došli peniaze na SPOLOČNOM účte u kie.
 * Užívateľ za to nemôže, takže mu kredity vrátime a chyba ide do logu ako
 * prevádzková, nie ako jeho.
 */
function prelozKod(code: number, sprava: string): ChybaPoskytovatela {
  switch (code) {
    case 401:
    case 403:
      return new ChybaPoskytovatela('zly_kluc', `kie.ai odmietol kľúč: ${sprava}`, false, code);
    case 402:
      return new ChybaPoskytovatela(
        'provider_bez_kreditu',
        `Na účte AI LAB u kie.ai došli prostriedky (${sprava}). Kredity sa vrátili.`,
        false,
        code,
      );
    case 404:
      return new ChybaPoskytovatela('neznamy_model', `kie.ai nepozná tento model: ${sprava}`, false, code);
    case 422:
    case 400:
      return new ChybaPoskytovatela('zly_vstup', `kie.ai odmietol zadanie: ${sprava}`, false, code);
    case 429:
      return new ChybaPoskytovatela('rate_limit', `kie.ai: priveľa požiadaviek (${sprava})`, true, code);
    default:
      return new ChybaPoskytovatela(
        code >= 500 ? 'provider_down' : `kie_${code}`,
        sprava,
        code >= 500,
        code,
      );
  }
}

function naVysledok(data: unknown): Vysledok {
  const urls = pozbierajUrl(data).filter((u) => typPodlaUrl(u) !== 'ine' || /kie|file|cdn|storage/i.test(u));
  return {
    subory: urls.map((url) => ({ url, typ: typPodlaUrl(url) })),
    metadata: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined,
  };
}

interface KieStavData {
  taskId?: string;
  state?: string;
  successFlag?: number;
  resultJson?: unknown;
  response?: unknown;
  failCode?: string | number;
  failMsg?: string;
  errorMessage?: string;
}

/** Stav úlohy z tvaru, ktorý chodí aj z `recordInfo`, aj z callbacku. */
function stavZData(data: KieStavData): StavUlohy {
  const state = String(data.state ?? '').toLowerCase();

  if (state === 'fail' || state === 'failed' || state === 'error' || data.successFlag === 3) {
    const sprava = data.failMsg ?? data.errorMessage ?? 'generovanie zlyhalo';
    const kod = String(data.failCode ?? 'provider_fail');
    return { stav: 'chyba', kod, sprava };
  }

  if (state === 'success' || state === 'succeeded' || data.successFlag === 1) {
    const vysledok = naVysledok(data.resultJson ?? data.response ?? data);
    if (vysledok.subory.length === 0) {
      return { stav: 'chyba', kod: 'prazdny_vysledok', sprava: 'kie.ai označil úlohu za hotovú, ale neposlal žiadny súbor' };
    }
    return { stav: 'hotovo', vysledok };
  }

  return { stav: 'bezi' };
}

export const kie: Poskytovatel = {
  id: 'kie',
  rezim: 'async',

  nastaveny: () => Boolean(process.env.KIE_API_KEY?.trim()),
  coChyba: () => 'KIE_API_KEY (kie.ai → API Key)',

  async odosli(z: ZadanieVstup): Promise<Zadanie> {
    const telo: Record<string, unknown> = {
      model: z.providerModel,
      input: z.vstup,
    };
    if (z.callbackUrl) telo.callBackUrl = z.callbackUrl;

    const odpoved = await volaj(
      '/api/v1/jobs/createTask',
      { method: 'POST', body: JSON.stringify(telo) },
      GEN.dispatchTimeoutMs,
    );

    const data = (odpoved.data ?? {}) as { taskId?: string; task_id?: string };
    const taskId = data.taskId ?? data.task_id;
    if (!taskId) {
      throw new ChybaPoskytovatela('bez_task_id', 'kie.ai neposlal taskId', true);
    }
    return { druh: 'prijate', taskId };
  },

  async zisti(taskId: string): Promise<StavUlohy> {
    const odpoved = await volaj(
      `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { method: 'GET' },
      15_000,
    );
    return stavZData((odpoved.data ?? {}) as KieStavData);
  },

  zCallbacku(payload: unknown) {
    if (!payload || typeof payload !== 'object') return null;

    const obal = payload as KieOdpoved & KieStavData;
    const data = (obal.data && typeof obal.data === 'object' ? obal.data : obal) as KieStavData;
    const taskId = data.taskId;
    if (!taskId) return null;

    // Callback s nenulovým `code` znamená chybu aj keď `state` chýba.
    const code = obal.code ?? 200;
    if (code !== 200 && !data.state) {
      const chyba = prelozKod(code, obal.msg ?? 'generovanie zlyhalo');
      return { taskId, stav: { stav: 'chyba', kod: chyba.kod, sprava: chyba.message } };
    }

    return { taskId, stav: stavZData(data) };
  },
};
