/**
 * lib/generation/balicky.ts
 *
 * Kreditové balíčky na predaj.
 *
 * Ceny sú v centoch, aby sa nikde nepočítalo s desatinnými číslami —
 * 9,90 € je `990`. Prepisujú sa premennou prostredia; checkout ich číta
 * pri každej platbe, cenník na /pricing sa pregeneruje do hodiny:
 *
 *   CREDIT_PACKS=[{"id":"maly","nazov":"Malý","kredity":1000,"cena_centov":690}]
 *
 * Orientácia v hodnote: 1 kredit = 0,005 USD nákupnej ceny u poskytovateľa
 * (GEN_CREDIT_USD). Predvolené balíčky nižšie sú nastavené tak, aby marža
 * pokryla platobné poplatky a prevádzku — over si ich skôr, než spustíš
 * predaj, a nezabudni na DPH podľa toho, či si platiteľ.
 */

export interface Balicek {
  id: string;
  nazov: string;
  kredity: number;
  cena_centov: number;
  mena: string;
  popis?: string;
  najpredavanejsi?: boolean;
}

const PREDVOLENE: Balicek[] = [
  { id: 'skuska', nazov: 'Skúška', kredity: 500, cena_centov: 490, mena: 'eur', popis: 'Na vyskúšanie fotiek.' },
  { id: 'tvorca', nazov: 'Tvorca', kredity: 2000, cena_centov: 1790, mena: 'eur', popis: 'Bežný mesiac tvorby.', najpredavanejsi: true },
  { id: 'studio', nazov: 'Štúdio', kredity: 6000, cena_centov: 4900, mena: 'eur', popis: 'Video a klientska práca.' },
];

let cache: Balicek[] | null = null;

export function balicky(): Balicek[] {
  if (cache) return cache;

  const surove = process.env.CREDIT_PACKS?.trim();
  if (!surove) {
    cache = PREDVOLENE;
    return cache;
  }

  try {
    const json = JSON.parse(surove) as Balicek[];
    const platne = json.filter(
      (b) => b && typeof b.id === 'string' && b.kredity > 0 && b.cena_centov > 0,
    );
    if (platne.length === 0) throw new Error('žiadny platný balíček');
    cache = platne.map((b) => ({ ...b, mena: b.mena ?? 'eur' }));
  } catch (err) {
    console.warn('[credits] CREDIT_PACKS sa nedá prečítať, používam predvolené balíčky.', err);
    cache = PREDVOLENE;
  }
  return cache;
}

export function balicekPodlaId(id: string): Balicek | null {
  return balicky().find((b) => b.id === id) ?? null;
}
