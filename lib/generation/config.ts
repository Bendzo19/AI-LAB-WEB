/**
 * lib/generation/config.ts
 *
 * Všetky čísla, ktoré rozhodujú o priepustnosti, na jednom mieste.
 * Meniť sa dajú premennými prostredia BEZ nasadzovania nového buildu —
 * keď poskytovateľ zdvihne limit, zdvihneš číslo a je to.
 *
 * Prečo vôbec nejaké stropy, keď chceme paralelné generovanie:
 *
 *   Stropy tu NIE SÚ preto, aby sa čakalo. Sú preto, aby jeden človek
 *   s 500 úlohami nezabral celý účet u poskytovateľa ostatným, a aby sme
 *   neprekročili limit poskytovateľa a nezačali dostávať 429 na všetko.
 *   Pri bežnej prevádzke (100 ľudí, každý 1-2 úlohy) sa strop nedotkne
 *   nikoho — všetko ide von okamžite.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[generation] ${name}="${raw}" nie je číslo — použijem ${fallback}`);
    return fallback;
  }
  return n;
}

export const GEN = {
  /** Koľko úloh smie mať JEDEN užívateľ naraz rozbehnutých. */
  maxInflightPerUser: num('GEN_MAX_INFLIGHT_PER_USER', 4),

  /** Strop pre celú stránku dokopy. Chráni účet u poskytovateľa. */
  maxInflightTotal: num('GEN_MAX_INFLIGHT_TOTAL', 200),

  /** Strop na jedného poskytovateľa (kie/google/openai zvlášť). */
  maxInflightPerProvider: num('GEN_MAX_INFLIGHT_PER_PROVIDER', 150),

  /** Koľko odoslaní za minútu znesie jeden účet (ochrana proti skriptu). */
  maxSubmitsPerMinute: num('GEN_MAX_SUBMITS_PER_MINUTE', 20),

  /** Po koľkých minútach bez odpovede považujeme úlohu za stratenú. */
  jobTimeoutMinutes: num('GEN_JOB_TIMEOUT_MINUTES', 25),

  /** Koľkokrát skúsime úlohu odoslať, kým to vzdáme. */
  maxAttempts: num('GEN_MAX_ATTEMPTS', 3),

  /** Prirážka v percentách nad nákupnú cenu. 0 = predávame za nákup. */
  markupPct: num('GEN_MARKUP_PCT', 0),

  /** Hodnota jedného kreditu v USD — len na zobrazovanie. */
  creditUsd: num('GEN_CREDIT_USD', 0.005),

  /** Koľko kreditov dostane nový účet. */
  signupBonus: num('CREDITS_SIGNUP_BONUS', 0),

  /** Koľko kreditov dostane predplatiteľ každý mesiac. */
  monthlySubscriberGrant: num('CREDITS_MONTHLY_SUBSCRIBER', 0),

  /** Koľko sekúnd čakáme na odpoveď poskytovateľa pri odosielaní. */
  dispatchTimeoutMs: num('GEN_DISPATCH_TIMEOUT_MS', 20_000),

  /** Koľko úloh spracuje jeden beh cronu. */
  cronBatchSize: num('GEN_CRON_BATCH', 40),
} as const;

/** Verejná adresa appky — callback URL musí byť dosiahnuteľná zvonku. */
export function appUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (!raw) return 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

/**
 * Callback od poskytovateľa vie prísť len na verejnú adresu. Na localhoste
 * teda callback nikdy nedorazí a úlohu dotiahne až dopytovanie (cron alebo
 * prvý pohľad na stav). Toto zistíme raz a správame sa podľa toho.
 */
export function callbacksReachable(): boolean {
  const url = appUrl();
  return url.startsWith('https://') && !/localhost|127\.0\.0\.1|\.local\b/.test(url);
}
