/**
 * lib/generation/cena.ts
 *
 * Výpočet ceny. Čistá funkcia bez prístupu k prostrediu, aby ju vedel
 * spustiť server aj prehliadač — a aby odhad, ktorý človek vidí pri
 * posuvníku, bol TÁ ISTÁ matematika, akou sa mu potom rezervujú kredity.
 *
 * Dve implementácie (jedna na serveri, jedna v UI) sa vždy rozídu. Toto
 * je jedna.
 */

export interface CenovyPopis {
  kredity: number;
  jednotka: string;
  jednotka_zaklad: number;
  jednotka_pole?: string | null;
  jednotka_z_dlzky?: boolean;
  rezerva_jednotiek?: number | null;
  cena_pole?: string | null;
  ceny_pola?: Record<string, number> | null;
  cena_zaklad?: string | null;
  ceny_s_videom?: Record<string, number> | null;
  video_polia?: string[] | null;
  poznamka_cena?: string | null;
}

export interface Cena {
  /** Koľko kreditov sa rezervuje. */
  kredity: number;
  /** Základ pred prepočtom na jednotky — na vysvetlenie v UI. */
  zaklad: number;
  jednotiek: number;
  jednotka: string;
  /** true = presnú cenu vieme až po dokončení (dĺžka zvuku/videa). */
  odhad: boolean;
  poznamka?: string;
}

function pouzivaReferencneVideo(m: CenovyPopis, vstup: Record<string, unknown>): boolean {
  for (const pole of m.video_polia ?? []) {
    const v = vstup[pole];
    if (Array.isArray(v) ? v.length > 0 : Boolean(v)) return true;
  }
  return false;
}

/**
 * Pravidlo, ktoré tu platí všade: pri neistote radšej NADhodnotiť.
 * Rezervovaná čiastka je strop — čo sa neminie, vráti sa pri dokončení.
 * Opačné poradie (doúčtovať potom) by znamenalo mínusové zostatky.
 */
export function spocitajCenu(
  m: CenovyPopis,
  vstup: Record<string, unknown>,
  prirazkaPct = 0,
): Cena {
  /* 1. základ podľa cenotvorného poľa */
  let zaklad = m.kredity;
  const sVideom = pouzivaReferencneVideo(m, vstup) && m.ceny_s_videom;
  const cennik = sVideom ? m.ceny_s_videom : m.ceny_pola;

  if (m.cena_pole && cennik) {
    const volba = String(vstup[m.cena_pole] ?? m.cena_zaklad ?? '');
    const podlaVolby = cennik[volba];
    // Neznáma voľba nesmie vyjsť lacnejšie — vezmeme najdrahšiu možnosť.
    zaklad = podlaVolby ?? Math.max(...Object.values(cennik));
  } else if (sVideom && cennik) {
    zaklad = Math.max(...Object.values(cennik));
  }

  /* 2. počet jednotiek */
  let jednotiek = m.jednotka_zaklad;
  let odhad = false;

  if (m.rezerva_jednotiek) {
    jednotiek = m.rezerva_jednotiek;
    odhad = true;
  } else if (m.jednotka_pole) {
    const surove = vstup[m.jednotka_pole];
    if (m.jednotka_z_dlzky) {
      const dlzka = typeof surove === 'string' ? surove.length : 0;
      jednotiek = Math.max(1, Math.ceil(dlzka / m.jednotka_zaklad)) * m.jednotka_zaklad;
    } else {
      const n = Number(surove);
      jednotiek = Number.isFinite(n) && n > 0 ? n : m.jednotka_zaklad;
    }
  }

  /* 3. prepočet + prirážka, vždy nahor */
  const surova = (zaklad * jednotiek) / m.jednotka_zaklad;
  const sPrirazkou = surova * (1 + prirazkaPct / 100);

  return {
    kredity: Math.max(1, Math.ceil(sPrirazkou)),
    zaklad,
    jednotiek,
    jednotka: m.jednotka,
    odhad,
    poznamka: m.poznamka_cena ?? undefined,
  };
}
