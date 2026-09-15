/**
 * lib/generation/validate.ts
 *
 * Kontrola vstupu proti popisu polí modelu.
 *
 * Dve pravidlá, ktoré sa tu držia dôsledne:
 *
 *  1. Von ide LEN to, čo model pozná. Neznáme kľúče sa zahadzujú — inak by
 *     ktokoľvek mohol posielať poskytovateľovi ľubovoľné parametre na náš
 *     účet (napr. vyšší počet výstupov, než za čo zaplatil).
 *
 *  2. Nič sa „nedoladí" potichu. Keď je hodnota mimo rozsahu, vrátime chybu
 *     s menom poľa — užívateľ musí vedieť, čo opraviť.
 */

import type { Model, Pole } from './catalog';
import { predvolene } from './catalog';

export interface ChybaPola {
  pole: string;
  sprava: string;
}

export type VysledokKontroly =
  | { ok: true; vstup: Record<string, unknown> }
  | { ok: false; chyby: ChybaPola[] };

/** Súbory beriem len ako verejné https adresy. */
function skontrolujUrl(hodnota: unknown): string | null {
  if (typeof hodnota !== 'string' || hodnota.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(hodnota.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  // Poskytovateľ si súbor stiahne sám. Adresy do vnútornej siete nemajú
  // ako fungovať a sú typický pokus o SSRF, tak ich nepustíme ďalej.
  const host = url.hostname.toLowerCase();
  const privatna =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(10|127)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '::1' ||
    host === '0.0.0.0';
  if (privatna) return null;

  const povoleneHosty = (process.env.GEN_ALLOWED_FILE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (povoleneHosty.length > 0 && !povoleneHosty.some((h) => host === h || host.endsWith(`.${h}`))) {
    return null;
  }
  return url.toString();
}

function kontrolaPola(p: Pole, hodnota: unknown, chyby: ChybaPola[]): unknown {
  const chyba = (sprava: string) => {
    chyby.push({ pole: p.meno, sprava });
    return undefined;
  };

  switch (p.druh) {
    case 'text':
    case 'plocha': {
      if (typeof hodnota !== 'string') return chyba(`${p.nadpis}: očakávam text`);
      const t = hodnota.trim();
      if (p.max_znakov && t.length > p.max_znakov) {
        return chyba(`${p.nadpis}: najviac ${p.max_znakov} znakov (máš ${t.length})`);
      }
      return t === '' ? undefined : t;
    }

    case 'vyber': {
      const v = String(hodnota);
      if (!p.moznosti?.includes(v)) {
        return chyba(`${p.nadpis}: "${v}" nie je z ponuky (${p.moznosti?.join(', ')})`);
      }
      return v;
    }

    case 'posuvnik': {
      const n = Number(hodnota);
      if (!Number.isFinite(n)) return chyba(`${p.nadpis}: očakávam číslo`);
      if (p.min !== undefined && n < p.min) return chyba(`${p.nadpis}: minimum je ${p.min}`);
      if (p.max !== undefined && n > p.max) return chyba(`${p.nadpis}: maximum je ${p.max}`);
      return n;
    }

    case 'seed': {
      if (hodnota === '' || hodnota === null) return undefined;
      const n = Number(hodnota);
      if (!Number.isInteger(n) || n < 0) return chyba(`${p.nadpis}: očakávam celé číslo >= 0`);
      if (p.max !== undefined && n > p.max) return chyba(`${p.nadpis}: maximum je ${p.max}`);
      return n;
    }

    case 'prepinac': {
      if (typeof hodnota === 'boolean') return hodnota;
      if (hodnota === 'true') return true;
      if (hodnota === 'false') return false;
      return chyba(`${p.nadpis}: očakávam áno/nie`);
    }

    case 'subor': {
      if (p.viac) {
        const pole = Array.isArray(hodnota) ? hodnota : [hodnota];
        const cisté: string[] = [];
        for (const item of pole) {
          const url = skontrolujUrl(item);
          if (!url) return chyba(`${p.nadpis}: "${String(item)}" nie je platná verejná adresa súboru`);
          cisté.push(url);
        }
        if (p.max_suborov && p.max_suborov > 0 && cisté.length > p.max_suborov) {
          return chyba(`${p.nadpis}: najviac ${p.max_suborov} súborov`);
        }
        return cisté.length ? cisté : undefined;
      }
      const url = skontrolujUrl(hodnota);
      if (!url) return chyba(`${p.nadpis}: očakávam verejnú adresu súboru (https://…)`);
      return url;
    }
  }
}

/**
 * Vyčistí a skontroluje vstup. Výsledok je presne to, čo pôjde
 * poskytovateľovi — nič viac.
 */
export function skontrolujVstup(m: Model, surovy: unknown): VysledokKontroly {
  const chyby: ChybaPola[] = [];

  if (surovy === null || typeof surovy !== 'object' || Array.isArray(surovy)) {
    return { ok: false, chyby: [{ pole: '_', sprava: 'Očakávam objekt s poľami modelu.' }] };
  }
  const vstupy = surovy as Record<string, unknown>;

  const vystup: Record<string, unknown> = { ...predvolene(m) };

  for (const p of m.polia) {
    const dodane = vstupy[p.meno];
    const prazdne = dodane === undefined || dodane === null || dodane === '' ||
      (Array.isArray(dodane) && dodane.length === 0);

    if (prazdne) {
      if (p.povinne || m.povinne.includes(p.meno)) {
        chyby.push({ pole: p.meno, sprava: `${p.nadpis}: toto pole treba vyplniť` });
      }
      continue;
    }

    const hodnota = kontrolaPola(p, dodane, chyby);
    if (hodnota !== undefined) vystup[p.meno] = hodnota;
  }

  // Povinné polia musia po kontrole naozaj existovať (nie len byť poslané).
  for (const meno of m.povinne) {
    if (vystup[meno] === undefined && !chyby.some((c) => c.pole === meno)) {
      const p = m.polia.find((x) => x.meno === meno);
      chyby.push({ pole: meno, sprava: `${p?.nadpis ?? meno}: toto pole treba vyplniť` });
    }
  }

  if (chyby.length) return { ok: false, chyby };
  return { ok: true, vstup: vystup };
}
