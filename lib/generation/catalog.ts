/**
 * lib/generation/catalog.ts
 *
 * Katalóg modelov: čo vieme generovať, čo to stojí a aké polia model berie.
 *
 * Dáta sú v `models.json`, aby sa cena dala opraviť bez zásahu do kódu.
 * Formulár na webe sa kreslí z `polia` — keď pribudne model, NEPÍŠE sa nové
 * UI, len sa doplní riadok v JSON-e.
 *
 * Cena sa počíta na serveri a NIKDY sa nepreberá od klienta. Klient dostane
 * len odhad na zobrazenie; rezervuje sa to, čo spočíta server.
 */

import raw from './models.json';
import { GEN } from './config';
import { spocitajCenu, type Cena } from './cena';

/* ------------------------------------------------------------------ */
/* typy                                                                */
/* ------------------------------------------------------------------ */

export type Druh = 'foto' | 'video' | 'zvuk' | 'upscale';

export type DruhPola =
  | 'text'      // jeden riadok
  | 'plocha'    // viac riadkov
  | 'vyber'     // select
  | 'posuvnik'  // slider
  | 'prepinac'  // checkbox
  | 'subor'     // URL súboru (alebo pole URL, keď `viac`)
  | 'seed';

export interface Pole {
  meno: string;
  nadpis: string;
  druh: DruhPola;
  skupina: 'zaklad' | 'pokrocile';
  povinne: boolean;
  napoveda?: string;
  predvolene?: string | number | boolean;
  moznosti?: string[];
  min?: number;
  max?: number;
  krok?: number;
  riadky?: number;
  max_znakov?: number;
  max_suborov?: number;
  jednotka?: string;
  /** Tento výber mení cenu — UI to ukáže pri poli. */
  cena?: boolean;
  /** Pri `druh: 'subor'`: čo sa nahráva. */
  co?: 'obrazok' | 'video' | 'zvuk';
  /** Pri `druh: 'subor'`: viac súborov naraz. */
  viac?: boolean;
}

export interface Model {
  id: string;
  druh: Druh;
  rodina: string;
  nazov: string;
  popis: string;

  /** Kto to reálne počíta: 'kie' | 'google' | 'openai' | 'mock'. */
  poskytovatel: string;
  /** Identifikátor modelu u poskytovateľa. */
  provider_model: string;
  /** true = slug ešte nebol overený proti dokumentácii poskytovateľa. */
  overit?: boolean;

  jednotka: string;
  /** Koľko jednotiek pokrýva základná cena (napr. 5 sekúnd, 1000 znakov). */
  jednotka_zaklad: number;
  /** Pole vstupu, z ktorého sa číta počet jednotiek (napr. `duration`). */
  jednotka_pole?: string;
  /** Počet jednotiek = dĺžka textu v tom poli (TTS). */
  jednotka_z_dlzky?: boolean;
  /** Počet jednotiek sa vopred nedá zistiť — rezervuj toľkoto. */
  rezerva_jednotiek?: number;

  kredity: number;
  usd: number;

  cena_pole?: string;
  ceny_pola?: Record<string, number>;
  cena_zaklad?: string;
  /** Lacnejší cenník, keď je na vstupe referenčné video. */
  ceny_s_videom?: Record<string, number>;
  video_polia?: string[];
  poznamka_cena?: string;

  nsfw: boolean;
  moderacia: string;
  moderacia_veta?: string;
  stitky: string[];
  overene: string;
  dostupny: boolean;

  povinne: string[];
  polia: Pole[];
}

interface Katalog {
  kredit_usd: number;
  modely: Model[];
}

/* ------------------------------------------------------------------ */
/* načítanie + kontrola                                                */
/* ------------------------------------------------------------------ */

const DRUHY_POLA: DruhPola[] = ['text', 'plocha', 'vyber', 'posuvnik', 'prepinac', 'subor', 'seed'];

/**
 * Katalóg je dáta, ktoré niekto raz za čas ručne upraví. Keď sa pri tom
 * pomýli, chceme to vedieť pri štarte — nie vtedy, keď užívateľovi
 * zoberieme kredity za model, ktorý sa nedá odoslať.
 */
function skontroluj(k: Katalog): Katalog {
  const chyby: string[] = [];
  const videne = new Set<string>();

  for (const m of k.modely) {
    const kde = `model "${m.id}"`;
    if (videne.has(m.id)) chyby.push(`${kde}: duplicitné id`);
    videne.add(m.id);

    if (!m.provider_model) chyby.push(`${kde}: chýba provider_model`);
    if (!(m.jednotka_zaklad > 0)) chyby.push(`${kde}: jednotka_zaklad musí byť > 0`);
    if (!(m.kredity > 0)) chyby.push(`${kde}: kredity musia byť > 0`);

    const mena = new Set(m.polia.map((p) => p.meno));
    for (const p of m.polia) {
      if (!DRUHY_POLA.includes(p.druh)) chyby.push(`${kde}, pole "${p.meno}": neznámy druh "${p.druh}"`);
      if (p.druh === 'vyber' && (!p.moznosti || p.moznosti.length === 0)) {
        chyby.push(`${kde}, pole "${p.meno}": výber bez možností`);
      }
      if (p.predvolene !== undefined && p.druh === 'vyber' && p.moznosti && !p.moznosti.includes(String(p.predvolene))) {
        chyby.push(`${kde}, pole "${p.meno}": predvolené "${String(p.predvolene)}" nie je medzi možnosťami`);
      }
    }
    for (const povinne of m.povinne) {
      if (!mena.has(povinne)) chyby.push(`${kde}: povinné pole "${povinne}" v poliach neexistuje`);
    }
    if (m.cena_pole && !mena.has(m.cena_pole)) {
      chyby.push(`${kde}: cena_pole "${m.cena_pole}" v poliach neexistuje`);
    }
    if (m.cena_pole && !m.ceny_pola) chyby.push(`${kde}: cena_pole bez ceny_pola`);
    if (m.jednotka_pole && !mena.has(m.jednotka_pole)) {
      chyby.push(`${kde}: jednotka_pole "${m.jednotka_pole}" v poliach neexistuje`);
    }
    for (const vp of m.video_polia ?? []) {
      if (!mena.has(vp)) chyby.push(`${kde}: video_pole "${vp}" v poliach neexistuje`);
    }
  }

  if (chyby.length) {
    throw new Error(`lib/generation/models.json je pokazený:\n  - ${chyby.join('\n  - ')}`);
  }
  return k;
}

const KATALOG = skontroluj(raw as Katalog);

export const MODELY: readonly Model[] = KATALOG.modely;

const PODLA_ID = new Map(MODELY.map((m) => [m.id, m]));

export function modelPodlaId(id: string): Model | null {
  return PODLA_ID.get(id) ?? null;
}

/**
 * Modely, ktoré sa dajú reálne spustiť.
 *
 * `kamS` hovorí, KTO model počíta — pri presmerovaní (GEN_MODEL_ROUTING)
 * alebo pri mocku to nie je poskytovateľ zapísaný v katalógu. Bez toho by
 * sa po prepnutí modelu na OpenAI prestal ponúkať, hoci funguje.
 */
export function dostupneModely(
  mozniPoskytovatelia: ReadonlySet<string>,
  kamS: (m: Model) => string = (m) => m.poskytovatel,
): Model[] {
  return MODELY.filter((m) => m.dostupny && mozniPoskytovatelia.has(kamS(m)));
}

/* ------------------------------------------------------------------ */
/* cena                                                                */
/* ------------------------------------------------------------------ */

/**
 * Cena jedného behu v kreditoch.
 *
 * Samotný výpočet je v `cena.ts` — čistá funkcia, ktorú používa aj
 * prehliadač, aby odhad v formulári sedel s tým, čo sa naozaj rezervuje.
 */
export function cenaZa(m: Model, vstup: Record<string, unknown>): Cena {
  return spocitajCenu(m, vstup, GEN.markupPct);
}

export type { Cena };

/** Predvolené hodnoty polí — používa ich formulár aj validácia. */
export function predvolene(m: Model): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of m.polia) {
    if (p.predvolene !== undefined) out[p.meno] = p.predvolene;
  }
  return out;
}

/**
 * Verejný tvar katalógu pre prehliadač. `provider_model` ani `usd` von
 * nejde — je to nákupná cena a mapovanie na poskytovateľa, ktoré nikomu
 * mimo servera nič nedáva.
 */
export function verejnyKatalog(
  mozniPoskytovatelia: ReadonlySet<string>,
  kamS?: (m: Model) => string,
) {
  return {
    kredit_usd: GEN.creditUsd,
    prirazka_pct: GEN.markupPct,
    modely: dostupneModely(mozniPoskytovatelia, kamS).map((m) => ({
      id: m.id,
      druh: m.druh,
      rodina: m.rodina,
      nazov: m.nazov,
      popis: m.popis,
      jednotka: m.jednotka,
      kredity: m.kredity,
      cena_pole: m.cena_pole ?? null,
      ceny_pola: m.ceny_pola ?? null,
      ceny_s_videom: m.ceny_s_videom ?? null,
      video_polia: m.video_polia ?? null,
      jednotka_zaklad: m.jednotka_zaklad,
      jednotka_pole: m.jednotka_pole ?? null,
      jednotka_z_dlzky: m.jednotka_z_dlzky ?? false,
      rezerva_jednotiek: m.rezerva_jednotiek ?? null,
      poznamka_cena: m.poznamka_cena ?? null,
      nsfw: m.nsfw,
      moderacia: m.moderacia,
      moderacia_veta: m.moderacia_veta ?? '',
      stitky: m.stitky,
      povinne: m.povinne,
      polia: m.polia,
    })),
  };
}
