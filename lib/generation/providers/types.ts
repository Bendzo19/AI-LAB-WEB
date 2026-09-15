/**
 * lib/generation/providers/types.ts
 *
 * Rozhranie, cez ktoré appka hovorí s poskytovateľom. Celý zvyšok systému
 * (kredity, fronta, UI) o žiadnom konkrétnom poskytovateľovi nevie — vďaka
 * tomu sa dá model presmerovať z kie.ai priamo na Google alebo OpenAI bez
 * zásahu do fronty aj do účtovania.
 *
 * Dva režimy, pretože poskytovatelia sa delia na dva druhy:
 *
 *   async   pošleš zadanie, dostaneš id, výsledok príde callbackom
 *           (kie.ai; toto je to, čo drží web priepustný — nič sa nečaká)
 *
 *   inline  jedno HTTP volanie vráti rovno hotový súbor
 *           (Google Gemini, OpenAI Images). Beží preto na pozadí, aby
 *           request užívateľa neblokoval.
 */

import type { Model } from '../catalog';

export type TypSuboru = 'obrazok' | 'video' | 'zvuk' | 'ine';

export interface Subor {
  url: string;
  typ: TypSuboru;
  nazov?: string;
}

export interface Vysledok {
  subory: Subor[];
  /** Skutočný počet jednotiek (sekúnd, obrázkov) — na doúčtovanie. */
  jednotiek?: number;
  metadata?: Record<string, unknown>;
}

export type StavUlohy =
  | { stav: 'bezi' }
  | { stav: 'hotovo'; vysledok: Vysledok }
  | { stav: 'chyba'; kod: string; sprava: string };

export interface ZadanieVstup {
  jobId: string;
  model: Model;
  /** Identifikátor modelu u poskytovateľa (po prípadnom presmerovaní). */
  providerModel: string;
  vstup: Record<string, unknown>;
  /** null = callbacky sem nedoletia (localhost), výsledok si dotiahneme sami. */
  callbackUrl: string | null;
}

export type Zadanie =
  | { druh: 'prijate'; taskId: string }
  | { druh: 'hotovo'; vysledok: Vysledok };

export interface Poskytovatel {
  id: string;
  rezim: 'async' | 'inline';
  /** Má nastavené kľúče? Bez toho sa modely tohto poskytovateľa neponúkajú. */
  nastaveny(): boolean;
  /** Čo chýba, aby bol nastavený — do preflightu a chybových hlášok. */
  coChyba(): string;
  odosli(z: ZadanieVstup): Promise<Zadanie>;
  zisti(taskId: string): Promise<StavUlohy>;
  /** Spracovanie callbacku. `null` = payload nerozumieme. */
  zCallbacku?(payload: unknown): { taskId: string; stav: StavUlohy } | null;
}

/**
 * Chyba od poskytovateľa.
 *
 * `opakovatelne` rozhoduje o peniazoch aj o UX: opakovateľné (429, 5xx,
 * spadnutá sieť) vrátime do fronty a skúsime znova, neopakovateľné
 * (zlý vstup, moderácia) znamenajú koniec úlohy a vrátenie kreditov.
 */
export class ChybaPoskytovatela extends Error {
  readonly kod: string;
  readonly opakovatelne: boolean;
  readonly httpStav?: number;

  constructor(kod: string, sprava: string, opakovatelne: boolean, httpStav?: number) {
    super(sprava);
    this.name = 'ChybaPoskytovatela';
    this.kod = kod;
    this.opakovatelne = opakovatelne;
    this.httpStav = httpStav;
  }
}

/** Sieťová chyba a 5xx sa oplatí zopakovať, 4xx okrem 429 nie. */
export function zHttpStavu(stav: number, telo: string): ChybaPoskytovatela {
  const opakovatelne = stav === 429 || stav === 408 || stav >= 500;
  const kod = stav === 429 ? 'rate_limit' : stav >= 500 ? 'provider_down' : `http_${stav}`;
  return new ChybaPoskytovatela(kod, `Poskytovateľ vrátil ${stav}: ${telo.slice(0, 500)}`, opakovatelne, stav);
}

/** fetch s tvrdým časovým stropom — visiace spojenie blokuje slot vo fronte. */
export async function fetchSCasovymStropom(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ChybaPoskytovatela('timeout', `Poskytovateľ neodpovedal do ${timeoutMs} ms`, true);
    }
    throw new ChybaPoskytovatela(
      'siet',
      `Nepodarilo sa spojiť s poskytovateľom: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  } finally {
    clearTimeout(t);
  }
}

/** Z adresy uhádne, či je to obrázok, video alebo zvuk. */
export function typPodlaUrl(url: string): TypSuboru {
  const cesta = url.split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif|bmp)$/.test(cesta)) return 'obrazok';
  if (/\.(mp4|mov|webm|mkv|m4v)$/.test(cesta)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|flac|aac)$/.test(cesta)) return 'zvuk';
  return 'ine';
}

/**
 * Vytiahne adresy výsledkov z čohokoľvek, čo poskytovateľ pošle.
 *
 * Zámerne tolerantné: kie.ai vracia raz `resultJson` ako reťazec, raz už
 * rozparsovaný objekt, a kľúče sa medzi modelmi líšia (`resultUrls`,
 * `result_urls`, `videoUrl`…). Namiesto mapovania každého tvaru zvlášť
 * prejdeme strom a pozbierame všetko, čo vyzerá ako adresa súboru.
 */
export function pozbierajUrl(data: unknown, do_ = new Set<string>(), hlbka = 0): string[] {
  if (hlbka > 8) return [...do_];

  if (typeof data === 'string') {
    const s = data.trim();
    if (/^https?:\/\//i.test(s)) {
      do_.add(s);
    } else if (s.startsWith('{') || s.startsWith('[')) {
      try {
        pozbierajUrl(JSON.parse(s), do_, hlbka + 1);
      } catch {
        /* nebol to JSON, nevadí */
      }
    }
    return [...do_];
  }

  if (Array.isArray(data)) {
    for (const x of data) pozbierajUrl(x, do_, hlbka + 1);
    return [...do_];
  }

  if (data && typeof data === 'object') {
    for (const v of Object.values(data as Record<string, unknown>)) {
      pozbierajUrl(v, do_, hlbka + 1);
    }
  }
  return [...do_];
}
