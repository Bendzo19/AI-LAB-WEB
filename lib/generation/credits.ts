/**
 * lib/generation/credits.ts
 *
 * Kredity. Celá pravda o peniazoch je v dvoch tabuľkách:
 *
 *   credit_accounts   aktuálny stav (rýchle čítanie)
 *   credit_ledger     čo sa kedy stalo (audit, reklamácie, účtovníctvo)
 *
 * Prečo sa rezervuje a až potom účtuje:
 *
 *   Generovanie trvá sekundy až minúty a môže zlyhať. Keby sme účtovali
 *   až po dokončení, človek by si medzitým mohol pustiť dvadsať behov na
 *   kredity, ktoré má len raz. Keby sme účtovali dopredu natvrdo, platil
 *   by aj za to, čo mu poskytovateľ odmietol. Rezervácia rieši oboje:
 *   kredity sú hneď odložené, ale minú sa až keď výsledok naozaj je.
 *
 * Súbeh: rezervácia je JEDEN `UPDATE ... WHERE balance >= cena`. Postgres
 * pri ňom zamkne riadok daného užívateľa, takže dve súčasné požiadavky
 * toho istého človeka sa nikdy neprekryjú. Riadky iných užívateľov sa
 * nezamykajú vôbec — sto ľudí naraz sa teda nijako nebrzdí.
 */

import { pool } from '@/lib/db';
import type { ClientLike } from '@/lib/pglite-pool';

/** Čokoľvek, na čom sa dá spustiť dotaz — pool aj klient v transakcii. */
export interface Vykonavatel {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
}

export interface Stav {
  balance: number;
  reserved: number;
  lifetime_topup: number;
  lifetime_spent: number;
}

interface StavRiadok {
  balance: string | number;
  reserved: string | number;
  lifetime_topup?: string | number;
  lifetime_spent?: string | number;
}

/** BIGINT chodí z `pg` ako string — inak by `+` lepil texty. */
const cislo = (v: string | number | undefined): number => (v === undefined ? 0 : Number(v));

export type LedgerKind = 'topup' | 'grant' | 'reserve' | 'charge' | 'refund' | 'adjust';

/* ------------------------------------------------------------------ */
/* čítanie                                                             */
/* ------------------------------------------------------------------ */

export async function stavUctu(userId: string, db: Vykonavatel = pool): Promise<Stav> {
  const { rows } = await db.query<StavRiadok>(
    `SELECT balance, reserved, lifetime_topup, lifetime_spent
       FROM credit_accounts WHERE user_id = $1`,
    [userId],
  );
  const r = rows[0];
  return {
    balance: cislo(r?.balance),
    reserved: cislo(r?.reserved),
    lifetime_topup: cislo(r?.lifetime_topup),
    lifetime_spent: cislo(r?.lifetime_spent),
  };
}

export interface ZaznamKnihy {
  id: string;
  kind: LedgerKind;
  balance_delta: number;
  balance_after: number;
  job_id: string | null;
  note: string | null;
  created_at: string;
}

export async function historiaKreditov(
  userId: string,
  limit = 50,
  db: Vykonavatel = pool,
): Promise<ZaznamKnihy[]> {
  const { rows } = await db.query<Record<string, string>>(
    `SELECT id, kind, balance_delta, balance_after, job_id, note, created_at
       FROM credit_ledger
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind as LedgerKind,
    balance_delta: Number(r.balance_delta),
    balance_after: Number(r.balance_after),
    job_id: r.job_id ?? null,
    note: r.note ?? null,
    created_at: new Date(r.created_at).toISOString(),
  }));
}

/* ------------------------------------------------------------------ */
/* zápisy                                                              */
/* ------------------------------------------------------------------ */

export async function zabezpecUcet(userId: string, db: Vykonavatel = pool): Promise<void> {
  await db.query(
    `INSERT INTO credit_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

async function zapisDoKnihy(
  db: Vykonavatel,
  z: {
    userId: string;
    kind: LedgerKind;
    balanceDelta: number;
    reservedDelta: number;
    balanceAfter: number;
    reservedAfter: number;
    jobId?: string | null;
    ref: string;
    note?: string | null;
  },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO credit_ledger
       (user_id, kind, balance_delta, reserved_delta, balance_after, reserved_after, job_id, ref, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, kind, ref) DO NOTHING`,
    [
      z.userId, z.kind, z.balanceDelta, z.reservedDelta,
      z.balanceAfter, z.reservedAfter, z.jobId ?? null, z.ref, z.note ?? null,
    ],
  );
  return rowCount > 0;
}

export type VysledokRezervacie =
  | { ok: true; zostatok: number }
  | { ok: false; chyba: 'nedostatok'; zostatok: number; treba: number };

/**
 * Odloží kredity na úlohu. Volá sa v tej istej transakcii, v ktorej
 * vzniká riadok úlohy — buď je oboje, alebo nič.
 */
export async function rezervuj(
  db: Vykonavatel,
  userId: string,
  jobId: string,
  kredity: number,
): Promise<VysledokRezervacie> {
  await zabezpecUcet(userId, db);

  const { rows } = await db.query<StavRiadok>(
    `UPDATE credit_accounts
        SET balance = balance - $2,
            reserved = reserved + $2,
            updated_at = now()
      WHERE user_id = $1 AND balance >= $2
      RETURNING balance, reserved`,
    [userId, kredity],
  );

  if (rows.length === 0) {
    const stav = await stavUctu(userId, db);
    return { ok: false, chyba: 'nedostatok', zostatok: stav.balance, treba: kredity };
  }

  const balance = cislo(rows[0].balance);
  const reserved = cislo(rows[0].reserved);

  await zapisDoKnihy(db, {
    userId, kind: 'reserve',
    balanceDelta: -kredity, reservedDelta: kredity,
    balanceAfter: balance, reservedAfter: reserved,
    jobId, ref: jobId, note: 'rezervácia na generovanie',
  });

  return { ok: true, zostatok: balance };
}

/**
 * Úloha dopadla. `skutocne` je to, čo sa naozaj minulo (0 = zlyhanie,
 * menej než rezervácia = vrátime rozdiel).
 *
 * MUSÍ bežať v transakcii. Poradie krokov nie je náhodné:
 *
 *   1. najprv poistný riadok do knihy (UNIQUE na user+kind+ref)
 *   2. až potom pohyb na účte
 *
 * Opačne by dva súbežné callbacky na tú istú úlohu oba prešli cez
 * podmienku `reserved >= rezervovane` — stačí, aby mal človek rozbehnutú
 * ešte jednu úlohu a druhý callback by uvoľnil cudziu rezerváciu.
 */
export async function zauctuj(
  db: Vykonavatel,
  userId: string,
  jobId: string,
  rezervovane: number,
  skutocne: number,
  poznamka?: string,
): Promise<{ zostatok: number; vratene: number }> {
  const minute = Math.max(0, Math.min(skutocne, rezervovane));
  const vratene = rezervovane - minute;

  const prvyRaz = await zapisDoKnihy(db, {
    userId, kind: 'charge',
    balanceDelta: 0, reservedDelta: -minute,
    balanceAfter: 0, reservedAfter: 0, // skutočné hodnoty doplníme nižšie
    jobId, ref: jobId, note: poznamka ?? null,
  });

  if (!prvyRaz) {
    // Túto úlohu už niekto zaúčtoval (webhook aj cron naraz, opakovaný
    // callback poskytovateľa). Účet sa nesmie hnúť druhýkrát.
    const stav = await stavUctu(userId, db);
    return { zostatok: stav.balance, vratene: 0 };
  }

  const { rows } = await db.query<StavRiadok>(
    `UPDATE credit_accounts
        SET reserved       = reserved - $2,
            balance        = balance + $3,
            lifetime_spent = lifetime_spent + $4,
            updated_at     = now()
      WHERE user_id = $1 AND reserved >= $2
      RETURNING balance, reserved`,
    [userId, rezervovane, vratene, minute],
  );

  if (rows.length === 0) {
    // Držaná čiastka je menšia než rezervácia tejto úlohy — to je rozbitý
    // stav dát, nie bežná situácia. Necháme transakciu spadnúť, nech sa
    // poistný riadok tiež vráti a nič sa neúčtuje nadvakrát.
    throw new Error(
      `ROZBITA_REZERVACIA: úloha ${jobId} chce uvoľniť ${rezervovane} kreditov, ` +
        `ale na účte ${userId} toľko držaných nie je`,
    );
  }

  const balance = cislo(rows[0].balance);
  const reserved = cislo(rows[0].reserved);

  await db.query(
    `UPDATE credit_ledger
        SET balance_after = $3, reserved_after = $4
      WHERE user_id = $1 AND kind = 'charge' AND ref = $2`,
    [userId, jobId, balance, reserved],
  );

  if (vratene > 0) {
    await zapisDoKnihy(db, {
      userId, kind: 'refund',
      // Zvyšok držanej čiastky sa vracia do voľného zostatku: súčet
      // reserved_delta oboch riadkov je presne -rezervovane.
      balanceDelta: vratene, reservedDelta: -vratene,
      balanceAfter: balance, reservedAfter: reserved,
      jobId, ref: jobId,
      note: minute === 0 ? 'generovanie zlyhalo — vrátené celé' : 'vrátený rozdiel oproti rezervácii',
    });
  }

  return { zostatok: balance, vratene };
}

/** Zlyhanie = vrátime všetko. Skratka nad `zauctuj`. */
export function vratCelu(
  db: Vykonavatel,
  userId: string,
  jobId: string,
  rezervovane: number,
  dovod: string,
): Promise<{ zostatok: number; vratene: number }> {
  return zauctuj(db, userId, jobId, rezervovane, 0, dovod);
}

/**
 * Pripísanie kreditov (platba, mesačný nárok predplatiteľa, ručná úprava).
 *
 * `ref` je kľúč idempotencie — id Stripe session, `2026-09` pri mesačnom
 * nároku a podobne. To isté `ref` druhýkrát nepripíše nič.
 */
export async function pripis(
  userId: string,
  kredity: number,
  ref: string,
  kind: Extract<LedgerKind, 'topup' | 'grant' | 'adjust'> = 'topup',
  poznamka?: string,
): Promise<{ pripisane: boolean; zostatok: number }> {
  if (!Number.isInteger(kredity) || kredity === 0) {
    throw new Error(`pripis(): kredity musia byť celé nenulové číslo, dostal som ${kredity}`);
  }

  const client = (await pool.connect()) as ClientLike;
  try {
    await client.query('BEGIN');
    await zabezpecUcet(userId, client);

    // Najprv poistka proti duplicite. Keď tu neprejde, platba už bola
    // spracovaná a nič ďalšie nerobíme.
    const { rowCount } = await client.query(
      `INSERT INTO credit_ledger
         (user_id, kind, balance_delta, reserved_delta, balance_after, reserved_after, ref, note)
       VALUES ($1, $2, $3, 0, 0, 0, $4, $5)
       ON CONFLICT (user_id, kind, ref) DO NOTHING`,
      [userId, kind, kredity, ref, poznamka ?? null],
    );

    if (rowCount === 0) {
      await client.query('ROLLBACK');
      const stav = await stavUctu(userId);
      return { pripisane: false, zostatok: stav.balance };
    }

    const { rows } = await client.query<StavRiadok>(
      `UPDATE credit_accounts
          SET balance        = balance + $2,
              lifetime_topup = lifetime_topup + GREATEST($2, 0),
              updated_at     = now()
        WHERE user_id = $1
        RETURNING balance, reserved`,
      [userId, kredity],
    );

    const balance = cislo(rows[0]?.balance);
    const reserved = cislo(rows[0]?.reserved);

    await client.query(
      `UPDATE credit_ledger
          SET balance_after = $3, reserved_after = $4
        WHERE user_id = $1 AND kind = $2 AND ref = $5`,
      [userId, kind, balance, reserved, ref],
    );

    await client.query('COMMIT');
    return { pripisane: true, zostatok: balance };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
