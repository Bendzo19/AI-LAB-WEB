/**
 * scripts/loadtest-generation.ts
 *
 *   npm run loadtest             # 100 ľudí, každý 1 generovanie
 *   npm run loadtest -- --users=200 --jobs=2
 *
 * Overuje presne to, kvôli čomu celá prestavba vznikla:
 *
 *   1. sto ľudí naraz sa NEZARADÍ DO RADU — všetci dostanú úlohu rozbehnutú
 *   2. kredity sa nikdy neminú dvakrát (súbeh na jednom účte)
 *   3. rovnaký idempotency key neúčtuje druhýkrát
 *   4. po dobehnutí je účtovníctvo v poriadku: držané = 0 a zostatok
 *      presne zodpovedá tomu, čo sa reálne minulo
 *
 * Beží proti mock poskytovateľovi (GEN_MOCK=1), takže nič nestojí a nič
 * neodchádza von. Databáza musí byť skutočný Postgres — PGlite má jedno
 * spojenie a súbeh by nemeral nič.
 */

import { Pool } from 'pg';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? '1'] as const;
  }),
);

const POCET_UZIVATELOV = Number(args.get('users') ?? 100);
const ULOH_NA_UZIVATELA = Number(args.get('jobs') ?? 1);
const URL = (args.get('url') ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const MODEL = args.get('model') ?? 'kie-z-image';
const KREDITOV = Number(args.get('credits') ?? 100);
/** Musí sedieť s GEN_MAX_INFLIGHT_TOTAL servera, inak test kontroluje niečo iné. */
const STROP = Number(process.env.GEN_MAX_INFLIGHT_TOTAL ?? 200);

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
const ok = (m: string) => console.log(`  ${G}✓${X} ${m}`);
const zle = (m: string) => console.log(`  ${R}✗${X} ${m}`);
const info = (m: string) => console.log(`  ${D}${m}${X}`);

let chyb = 0;
function tvrd(podmienka: boolean, sprava: string): void {
  if (podmienka) ok(sprava);
  else { zle(sprava); chyb += 1; }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

interface OdpovedGenerovania {
  uloha?: { id: string; stav: string };
  error?: string;
  zostatok?: number;
}

async function posli(userId: string, telo: unknown): Promise<{ stav: number; data: OdpovedGenerovania }> {
  const res = await fetch(`${URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `session_user_id=${userId}` },
    body: JSON.stringify(telo),
  });
  const data = (await res.json().catch(() => ({}))) as OdpovedGenerovania;
  return { stav: res.status, data };
}

/** Cron beží v produkcii každú minútu; v teste ho ťukáme sami. */
async function ukroc(): Promise<void> {
  const hlavicky: Record<string, string> = {};
  if (process.env.CRON_SECRET) hlavicky.Authorization = `Bearer ${process.env.CRON_SECRET}`;
  await fetch(`${URL}/api/cron/generation`, { headers: hlavicky }).catch(() => undefined);
}

async function pockajNaDobehnutie(idcka: string[], maxMs = 90_000): Promise<void> {
  const do_ = Date.now() + maxMs;
  while (Date.now() < do_) {
    const { rows } = await pool.query<{ pocet: string }>(
      `SELECT count(*) AS pocet FROM generation_jobs
        WHERE id = ANY($1::uuid[]) AND status IN ('queued','dispatching','running')`,
      [idcka],
    );
    if (Number(rows[0].pocet) === 0) return;
    await ukroc();
    await new Promise((r) => setTimeout(r, 500));
  }
  const { rows: zvysok } = await pool.query<{ status: string; pocet: string }>(
    `SELECT status, count(*) AS pocet FROM generation_jobs
      WHERE id = ANY($1::uuid[]) AND status IN ('queued','dispatching','running') GROUP BY status`,
    [idcka],
  );
  throw new Error(`Úlohy nedobehli do časového stropu: ${JSON.stringify(zvysok)}`);
}

async function main(): Promise<void> {
  console.log(`\n${B}Záťažový test generovania${X}`);
  info(`${POCET_UZIVATELOV} užívateľov × ${ULOH_NA_UZIVATELA} úloh, model ${MODEL}, ${URL}`);

  if (!process.env.DATABASE_URL) {
    zle('DATABASE_URL nie je nastavené — test potrebuje skutočný Postgres.');
    process.exit(1);
  }

  /* ---------------------------------------------------------- príprava */
  console.log(`\n${B}1. Príprava${X}`);
  const znacka = `lt${Date.now()}`;
  const uzivatelia: string[] = [];

  for (let i = 0; i < POCET_UZIVATELOV; i += 1) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`${znacka}+${i}@loadtest.local`],
    );
    uzivatelia.push(String(rows[0].id));
  }
  await pool.query(
    `INSERT INTO credit_accounts (user_id, balance, lifetime_topup)
     SELECT unnest($1::bigint[]), $2, $2
     ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance`,
    [uzivatelia, KREDITOV],
  );
  // Aj úvodný vklad ide do knihy — inak by kontrola „zostatok sedí
  // s knihou" nemala s čím porovnávať.
  await pool.query(
    `INSERT INTO credit_ledger
       (user_id, kind, balance_delta, reserved_delta, balance_after, reserved_after, ref, note)
     SELECT unnest($1::bigint[]), 'topup', $2, 0, $2, 0, 'loadtest', 'úvodný vklad testu'`,
    [uzivatelia, KREDITOV],
  );
  ok(`${uzivatelia.length} účtov, každý ${KREDITOV} kreditov`);

  /* --------------------------------------------- 1) súbežné generovanie */
  console.log(`\n${B}2. Sto ľudí naraz${X}`);

  const poziadavky: Promise<{ stav: number; data: OdpovedGenerovania; ms: number }>[] = [];
  const start = Date.now();

  for (const userId of uzivatelia) {
    for (let j = 0; j < ULOH_NA_UZIVATELA; j += 1) {
      const t0 = Date.now();
      poziadavky.push(
        posli(userId, { model: MODEL, polia: { prompt: `load test ${znacka} ${j}` } }).then((r) => ({
          ...r,
          ms: Date.now() - t0,
        })),
      );
    }
  }

  const odpovede = await Promise.all(poziadavky);
  const trvanie = Date.now() - start;

  const prijate = odpovede.filter((o) => o.stav === 202);
  const casy = odpovede.map((o) => o.ms).sort((a, b) => a - b);
  const p50 = casy[Math.floor(casy.length * 0.5)];
  const p95 = casy[Math.floor(casy.length * 0.95)];

  info(`celkovo ${trvanie} ms, medián odpovede ${p50} ms, p95 ${p95} ms`);
  tvrd(prijate.length === odpovede.length, `všetkých ${odpovede.length} zadaní prijatých (202), žiadne odmietnutie`);

  if (prijate.length !== odpovede.length) {
    const chybne = odpovede.filter((o) => o.stav !== 202).slice(0, 3);
    for (const c of chybne) info(`  ukážka chyby: HTTP ${c.stav} ${JSON.stringify(c.data).slice(0, 200)}`);
  }

  const idcka = prijate.map((o) => o.data.uloha!.id);

  const { rows: stavy } = await pool.query<{ status: string; pocet: string }>(
    `SELECT status, count(*) AS pocet FROM generation_jobs WHERE id = ANY($1::uuid[]) GROUP BY status`,
    [idcka],
  );
  const podlaStavu = Object.fromEntries(stavy.map((s) => [s.status, Number(s.pocet)]));
  info(`hneď po odoslaní: ${JSON.stringify(podlaStavu)}`);

  const rozbehnute = (podlaStavu.running ?? 0) + (podlaStavu.succeeded ?? 0) + (podlaStavu.dispatching ?? 0);
  const caka = podlaStavu.queued ?? 0;

  tvrd(rozbehnute + caka === idcka.length, `žiadna úloha sa nestratila (${rozbehnute} beží + ${caka} čaká)`);

  if (idcka.length <= STROP) {
    tvrd(
      rozbehnute === idcka.length,
      `${rozbehnute} z ${idcka.length} úloh sa rozbehlo okamžite — nikto nečaká na nikoho`,
    );
  } else {
    // Nad strop sa časť úloh zámerne odloží. Kontrolujeme, že sa strop
    // naozaj VYUŽIJE (a nie že nápor zablokuje sám seba) — presné číslo
    // býva nižšie než strop, lebo prvé úlohy medzitým dobehnú a uvoľnia
    // miesto ďalším až v ďalšom kole.
    tvrd(
      rozbehnute >= STROP * 0.7,
      `strop ${STROP}: rozbehlo sa ${rozbehnute} úloh, zvyšok (${caka}) čaká na uvoľnenie miesta`,
    );
  }

  /* --------------------------------------------------- 2) dvojitá útrata */
  console.log(`\n${B}3. Súbeh na jednom účte (dvojitá útrata)${X}`);

  const { rows: chudak } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`${znacka}+chudak@loadtest.local`],
  );
  const chudakId = String(chudak[0].id);
  await pool.query(
    `INSERT INTO credit_accounts (user_id, balance) VALUES ($1, 2)
     ON CONFLICT (user_id) DO UPDATE SET balance = 2, reserved = 0`,
    [chudakId],
  );

  // 2 kredity = presne na JEDEN beh Z-Image. Desať súčasných pokusov.
  const naraz = await Promise.all(
    Array.from({ length: 10 }, () =>
      posli(chudakId, { model: MODEL, polia: { prompt: 'dvojita utrata' } }),
    ),
  );
  const uspesne = naraz.filter((o) => o.stav === 202).length;
  const odmietnute = naraz.filter((o) => o.stav === 402).length;

  tvrd(uspesne === 1, `z 10 súčasných pokusov prešiel presne 1 (prešlo ${uspesne})`);
  tvrd(odmietnute === 9, `zvyšných 9 dostalo 402 nedostatok kreditov (dostalo ${odmietnute})`);

  const { rows: ucetChudaka } = await pool.query<{ balance: string; reserved: string }>(
    `SELECT balance, reserved FROM credit_accounts WHERE user_id = $1`,
    [chudakId],
  );
  tvrd(
    Number(ucetChudaka[0].balance) === 0 && Number(ucetChudaka[0].reserved) === 2,
    `účet po súbehu: zostatok ${ucetChudaka[0].balance}, držané ${ucetChudaka[0].reserved} (čakám 0 / 2)`,
  );

  /* ------------------------------------------------------ 3) idempotencia */
  console.log(`\n${B}4. Dvojité kliknutie${X}`);

  const kluc = `idem-${znacka}`;
  const prve = await posli(uzivatelia[0], {
    model: MODEL, polia: { prompt: 'dvojklik' }, idempotency_key: kluc,
  });
  const druhe = await posli(uzivatelia[0], {
    model: MODEL, polia: { prompt: 'dvojklik' }, idempotency_key: kluc,
  });
  tvrd(
    Boolean(prve.data.uloha?.id) && prve.data.uloha?.id === druhe.data.uloha?.id,
    'druhé kliknutie s rovnakým kľúčom vrátilo tú istú úlohu, nezaložilo novú',
  );

  const { rows: pocetIdem } = await pool.query<{ pocet: string }>(
    `SELECT count(*) AS pocet FROM generation_jobs WHERE user_id = $1 AND idempotency_key = $2`,
    [uzivatelia[0], kluc],
  );
  tvrd(Number(pocetIdem[0].pocet) === 1, `v databáze je 1 úloha s tým kľúčom (je ${pocetIdem[0].pocet})`);

  /* ------------------------------------------------- 4) účtovníctvo po behu */
  console.log(`\n${B}5. Účtovníctvo po dobehnutí${X}`);

  const vsetky = [...idcka, prve.data.uloha?.id].filter((x): x is string => Boolean(x));
  await pockajNaDobehnutie(vsetky);
  ok('všetky úlohy dobehli');

  const { rows: vysledky } = await pool.query<{ status: string; pocet: string }>(
    `SELECT status, count(*) AS pocet FROM generation_jobs WHERE id = ANY($1::uuid[]) GROUP BY status`,
    [vsetky],
  );
  info(`konečné stavy: ${JSON.stringify(Object.fromEntries(vysledky.map((v) => [v.status, Number(v.pocet)])))}`);

  const { rows: drzane } = await pool.query<{ pocet: string }>(
    `SELECT coalesce(sum(reserved), 0) AS pocet FROM credit_accounts WHERE user_id = ANY($1::bigint[])`,
    [uzivatelia],
  );
  tvrd(Number(drzane[0].pocet) === 0, `po dobehnutí nie sú držané žiadne kredity (držané: ${drzane[0].pocet})`);

  // Zostatok musí sedieť s knihou do posledného kreditu.
  const { rows: nesedi } = await pool.query<{ user_id: string; balance: string; z_knihy: string }>(
    `SELECT a.user_id, a.balance, coalesce(sum(l.balance_delta), 0) AS z_knihy
       FROM credit_accounts a
       LEFT JOIN credit_ledger l ON l.user_id = a.user_id
      WHERE a.user_id = ANY($1::bigint[])
      GROUP BY a.user_id, a.balance
     HAVING a.balance <> coalesce(sum(l.balance_delta), 0)`,
    [uzivatelia],
  );
  tvrd(nesedi.length === 0, `zostatok všetkých účtov sedí s účtovnou knihou (nesedí: ${nesedi.length})`);

  const { rows: minute } = await pool.query<{ uctovane: string; zostatok: string }>(
    `SELECT coalesce(sum(charged_credits), 0) AS uctovane,
            (SELECT coalesce(sum(balance), 0) FROM credit_accounts WHERE user_id = ANY($1::bigint[])) AS zostatok
       FROM generation_jobs WHERE user_id = ANY($1::bigint[])`,
    [uzivatelia],
  );
  const ocakavany = uzivatelia.length * KREDITOV - Number(minute[0].uctovane);
  tvrd(
    Number(minute[0].zostatok) === ocakavany,
    `spolu zostáva ${minute[0].zostatok} kreditov = ${uzivatelia.length}×${KREDITOV} − ${minute[0].uctovane} minutých`,
  );

  /* -------------------------------------------------------------- upratanie */
  if (args.get('keep') !== '1') {
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${znacka}%`]);
    info('testovacie účty zmazané');
  }

  console.log(
    `\n${chyb === 0 ? `${G}${B}Všetko prešlo.${X}` : `${R}${B}${chyb} kontrol zlyhalo.${X}`}\n`,
  );
  await pool.end();
  process.exit(chyb === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`\n${R}Test spadol:${X}`, err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
