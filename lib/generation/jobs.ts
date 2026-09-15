/**
 * lib/generation/jobs.ts
 *
 * Fronta generovania. Toto je jadro celej prestavby.
 *
 * Ako to beží pri sto ľuďoch naraz:
 *
 *   sto requestov  ->  sto nezávislých rezervácií (každá na inom riadku účtu)
 *                  ->  sto riadkov v generation_jobs
 *                  ->  sto krátkych volaní createTask u poskytovateľa
 *                  ->  sto callbackov, keď je hotovo
 *
 * Nikde v tom nie je globálny zámok, jedna fronta ani „čakám, kým sa
 * predchádzajúci dogeneruje". Jediné poradie, ktoré vzniká, je poradie
 * dvoch súčasných úloh TOHO ISTÉHO človeka na jednom riadku účtu —
 * a to je mikrosekundová záležitosť, nie minúty.
 *
 * Stropy (GEN_MAX_INFLIGHT_*) existujú len preto, aby jeden človek
 * nezabral celý účet u poskytovateľa. Čo sa nad strop nezmestí, ostane
 * v stave `queued` a pustí sa hneď, ako sa miesto uvoľní — nič sa
 * nezahadzuje a nikto nedostane chybu.
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { pool } from '@/lib/db';
import type { ClientLike } from '@/lib/pglite-pool';
import { GEN, appUrl, callbacksReachable } from './config';
import { cenaZa, modelPodlaId, type Cena, type Model } from './catalog';
import { rezervuj, zauctuj } from './credits';
import { kamSModelom, nastaveniPoskytovatelia, poskytovatel } from './providers';
import { ChybaPoskytovatela, type StavUlohy, type Vysledok } from './providers/types';

/* ------------------------------------------------------------------ */
/* typy                                                                */
/* ------------------------------------------------------------------ */

export type StavUlohyDb = 'queued' | 'dispatching' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface Uloha {
  id: string;
  user_id: string;
  status: StavUlohyDb;
  model_id: string;
  provider: string;
  provider_model: string;
  input: Record<string, unknown>;
  price_credits: number;
  charged_credits: number | null;
  provider_task_id: string | null;
  callback_token: string;
  attempts: number;
  result: Vysledok | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  dispatched_at: string | null;
  finished_at: string | null;
}

function naUlohu(r: Record<string, unknown>): Uloha {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    status: r.status as StavUlohyDb,
    model_id: String(r.model_id),
    provider: String(r.provider),
    provider_model: String(r.provider_model),
    input: (r.input ?? {}) as Record<string, unknown>,
    price_credits: Number(r.price_credits),
    charged_credits: r.charged_credits === null || r.charged_credits === undefined ? null : Number(r.charged_credits),
    provider_task_id: (r.provider_task_id as string | null) ?? null,
    callback_token: String(r.callback_token),
    attempts: Number(r.attempts ?? 0),
    result: (r.result as Vysledok | null) ?? null,
    error_code: (r.error_code as string | null) ?? null,
    error_message: (r.error_message as string | null) ?? null,
    created_at: new Date(r.created_at as string).toISOString(),
    dispatched_at: r.dispatched_at ? new Date(r.dispatched_at as string).toISOString() : null,
    finished_at: r.finished_at ? new Date(r.finished_at as string).toISOString() : null,
  };
}

const STLPCE = `id, user_id, status, model_id, provider, provider_model, input,
  price_credits, charged_credits, provider_task_id, callback_token, attempts,
  result, error_code, error_message, created_at, dispatched_at, finished_at`;

async function zapisUdalost(jobId: string, kind: string, detail?: unknown): Promise<void> {
  await pool
    .query(`INSERT INTO generation_events (job_id, kind, detail) VALUES ($1, $2, $3)`, [
      jobId,
      kind,
      detail === undefined ? null : JSON.stringify(detail),
    ])
    .catch(() => undefined); // denník nikdy nesmie zhodiť generovanie
}

/* ------------------------------------------------------------------ */
/* vytvorenie úlohy                                                    */
/* ------------------------------------------------------------------ */

export type VysledokVytvorenia =
  | { ok: true; uloha: Uloha; cena: Cena; zostatok: number; opakovane: boolean }
  | { ok: false; kod: 'model_neznamy' | 'model_nedostupny'; sprava: string }
  | { ok: false; kod: 'nedostatok_kreditov'; sprava: string; zostatok: number; treba: number }
  | { ok: false; kod: 'prilis_vela_poziadaviek'; sprava: string };

export interface ZadanieUlohy {
  userId: string;
  modelId: string;
  /** Už skontrolovaný vstup z `skontrolujVstup`. */
  vstup: Record<string, unknown>;
  idempotencyKey?: string | null;
}

/**
 * Založí úlohu a odloží kredity. Nič neodosiela — odoslanie je ďalší krok,
 * ktorý sa smie zopakovať bez toho, aby to niečo stálo.
 */
export async function vytvorUlohu(z: ZadanieUlohy): Promise<VysledokVytvorenia> {
  const model = modelPodlaId(z.modelId);
  if (!model) {
    return { ok: false, kod: 'model_neznamy', sprava: `Model "${z.modelId}" neexistuje.` };
  }

  const smer = kamSModelom(model);
  const dostupni = nastaveniPoskytovatelia();
  if (!dostupni.has(smer.poskytovatel)) {
    const p = poskytovatel(smer.poskytovatel);
    return {
      ok: false,
      kod: 'model_nedostupny',
      sprava: `Model "${model.nazov}" je momentálne nedostupný${p ? ` — chýba ${p.coChyba()}` : ''}.`,
    };
  }

  /* Ochrana proti skriptu, ktorý by sypal úlohy bez prestávky. */
  const { rows: frekvencia } = await pool.query<{ pocet: string }>(
    `SELECT count(*) AS pocet FROM generation_jobs
      WHERE user_id = $1 AND created_at > now() - interval '1 minute'`,
    [z.userId],
  );
  if (Number(frekvencia[0]?.pocet ?? 0) >= GEN.maxSubmitsPerMinute) {
    return {
      ok: false,
      kod: 'prilis_vela_poziadaviek',
      sprava: `Za poslednú minútu si poslal ${GEN.maxSubmitsPerMinute} zadaní. Chvíľu počkaj.`,
    };
  }

  const cena = cenaZa(model, z.vstup);
  const jobId = randomUUID();
  const token = randomBytes(24).toString('base64url');

  const client = (await pool.connect()) as ClientLike;
  try {
    await client.query('BEGIN');

    const { rows: vlozene } = await client.query<Record<string, unknown>>(
      `INSERT INTO generation_jobs
         (id, user_id, model_id, provider, provider_model, input,
          price_credits, callback_token, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       -- WHERE musí byť aj tu: index je čiastočný (len riadky s kľúčom),
       -- a bez rovnakej podmienky ho Postgres pre ON CONFLICT nenájde.
       ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING ${STLPCE}`,
      [
        jobId, z.userId, model.id, smer.poskytovatel, smer.providerModel,
        JSON.stringify(z.vstup), cena.kredity, token, z.idempotencyKey ?? null,
      ],
    );

    /* Rovnaký idempotency key = to isté kliknutie druhýkrát. Vrátime
       pôvodnú úlohu a NEÚČTUJEME nič. */
    if (vlozene.length === 0) {
      await client.query('ROLLBACK');
      const { rows } = await pool.query<Record<string, unknown>>(
        `SELECT ${STLPCE} FROM generation_jobs WHERE user_id = $1 AND idempotency_key = $2`,
        [z.userId, z.idempotencyKey],
      );
      if (rows[0]) {
        return { ok: true, uloha: naUlohu(rows[0]), cena, zostatok: -1, opakovane: true };
      }
      return { ok: false, kod: 'model_neznamy', sprava: 'Úlohu sa nepodarilo založiť.' };
    }

    const rez = await rezervuj(client, z.userId, jobId, cena.kredity);
    if (!rez.ok) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        kod: 'nedostatok_kreditov',
        sprava: `Na tento beh treba ${cena.kredity} kreditov, máš ${rez.zostatok}.`,
        zostatok: rez.zostatok,
        treba: cena.kredity,
      };
    }

    await client.query('COMMIT');
    void zapisUdalost(jobId, 'vytvorena', { model: model.id, kredity: cena.kredity });

    return { ok: true, uloha: naUlohu(vlozene[0]), cena, zostatok: rez.zostatok, opakovane: false };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ */
/* stropy                                                              */
/* ------------------------------------------------------------------ */

interface Obsadenost {
  /** Koľko ROZBEHNUTÝCH úloh je starších než táto. */
  starsichSpolu: number;
  starsichUPoskytovatela: number;
  starsichUUzivatela: number;
}

/**
 * Koľko úloh sa dostalo na rad skôr než táto.
 *
 * Prečo sa počítajú len STARŠIE a nie všetky rozbehnuté:
 *
 *   Keby sme počítali všetky, nápor tristo ľudí naraz by sa zahryzol sám
 *   do seba — všetkých tristo si naraz zoberie úlohu, každý uvidí tristo
 *   rozbehnutých, každý usúdi, že je nad stropom, a všetci sa vrátia do
 *   frontu. Namerané: z 300 sa takto rozbehlo 17.
 *
 *   S poradím podľa `created_at` vidí najstarších dvesto pred sebou menej
 *   než strop a ide von hneď; až zvyšok počká. Presne to sa od stropu
 *   čaká — nie „keď je rušno, nejde nič".
 */
async function obsadenost(uloha: Uloha): Promise<Obsadenost> {
  const { rows } = await pool.query<{ spolu: string; u_poskytovatela: string; u_uzivatela: string }>(
    `SELECT count(*)                                  AS spolu,
            count(*) FILTER (WHERE provider = $2)     AS u_poskytovatela,
            count(*) FILTER (WHERE user_id  = $3)     AS u_uzivatela
       FROM generation_jobs
      WHERE status IN ('dispatching', 'running')
        AND id <> $1
        AND (created_at, id) < ($4::timestamptz, $1::uuid)`,
    [uloha.id, uloha.provider, uloha.user_id, uloha.created_at],
  );
  return {
    starsichSpolu: Number(rows[0]?.spolu ?? 0),
    starsichUPoskytovatela: Number(rows[0]?.u_poskytovatela ?? 0),
    starsichUUzivatela: Number(rows[0]?.u_uzivatela ?? 0),
  };
}

function prekrocenyStrop(o: Obsadenost): string | null {
  if (o.starsichUUzivatela >= GEN.maxInflightPerUser) return 'strop_uzivatela';
  if (o.starsichUPoskytovatela >= GEN.maxInflightPerProvider) return 'strop_poskytovatela';
  if (o.starsichSpolu >= GEN.maxInflightTotal) return 'strop_celkovy';
  return null;
}

/* ------------------------------------------------------------------ */
/* odoslanie                                                           */
/* ------------------------------------------------------------------ */

function odstup(pokus: number): number {
  return Math.min(120, 3 * 2 ** Math.max(0, pokus - 1));
}

async function vratDoFrontu(jobId: string, sekund: number, preco: string): Promise<void> {
  await pool.query(
    `UPDATE generation_jobs
        SET status = 'queued',
            next_attempt_at = now() + ($2 || ' seconds')::interval,
            updated_at = now()
      WHERE id = $1 AND status = 'dispatching'`,
    [jobId, String(sekund)],
  );
  void zapisUdalost(jobId, 'vrateno_do_frontu', { preco, o_sekund: sekund });
}

export type VysledokOdoslania =
  | { druh: 'odoslane'; taskId: string }
  | { druh: 'hotove' }
  | { druh: 'caka'; preco: string }
  | { druh: 'zlyhalo'; kod: string; sprava: string }
  | { druh: 'preskocene' };

/**
 * Pošle jednu úlohu poskytovateľovi.
 *
 * Zámok je jediný `UPDATE ... WHERE status='queued'` — kto ho vyhrá, ten
 * odosiela. Preto môže bežať súčasne z requestu aj z cronu bez toho, aby
 * sa niečo odoslalo dvakrát.
 */
export async function odosliUlohu(jobId: string): Promise<VysledokOdoslania> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `UPDATE generation_jobs
        SET status = 'dispatching', attempts = attempts + 1, updated_at = now()
      WHERE id = $1 AND status = 'queued' AND next_attempt_at <= now()
      RETURNING ${STLPCE}`,
    [jobId],
  );
  if (rows.length === 0) return { druh: 'preskocene' };

  const uloha = naUlohu(rows[0]);
  const model = modelPodlaId(uloha.model_id);
  const p = poskytovatel(uloha.provider);

  if (!model || !p) {
    await dokonciChybou(uloha, 'zla_konfiguracia', `Model ${uloha.model_id} alebo poskytovateľ ${uloha.provider} už neexistuje.`);
    return { druh: 'zlyhalo', kod: 'zla_konfiguracia', sprava: 'Model nie je dostupný.' };
  }

  /* Stropy kontrolujeme až po zabratí úlohy: až vtedy má úloha svoje
     miesto v poradí a vie povedať, koľko ich je pred ňou. */
  const o = await obsadenost(uloha);
  const strop = prekrocenyStrop(o);
  if (strop) {
    await vratDoFrontu(jobId, strop === 'strop_uzivatela' ? 5 : 10, strop);
    return { druh: 'caka', preco: strop };
  }

  const callbackUrl = callbacksReachable() || process.env.GEN_FORCE_CALLBACK === '1'
    ? `${appUrl()}/api/webhooks/generation/${uloha.provider}?job=${uloha.id}&t=${uloha.callback_token}`
    : null;

  try {
    const zadanie = await p.odosli({
      jobId: uloha.id,
      model,
      providerModel: uloha.provider_model,
      vstup: uloha.input,
      callbackUrl,
    });

    if (zadanie.druh === 'hotovo') {
      await dokonciUspechom(uloha, zadanie.vysledok);
      return { druh: 'hotove' };
    }

    await pool.query(
      `UPDATE generation_jobs
          SET status = 'running', provider_task_id = $2, dispatched_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'dispatching'`,
      [uloha.id, zadanie.taskId],
    );
    void zapisUdalost(uloha.id, 'odoslana', { taskId: zadanie.taskId, pokus: uloha.attempts });
    return { druh: 'odoslane', taskId: zadanie.taskId };
  } catch (err) {
    const chyba =
      err instanceof ChybaPoskytovatela
        ? err
        : new ChybaPoskytovatela('neznama', err instanceof Error ? err.message : String(err), true);

    const mozemeSkusitZnova = chyba.opakovatelne && uloha.attempts < GEN.maxAttempts;

    if (mozemeSkusitZnova) {
      await vratDoFrontu(jobId, odstup(uloha.attempts), chyba.kod);
      return { druh: 'caka', preco: chyba.kod };
    }

    await dokonciChybou(uloha, chyba.kod, chyba.message);
    return { druh: 'zlyhalo', kod: chyba.kod, sprava: chyba.message };
  }
}

/* ------------------------------------------------------------------ */
/* dokončenie + zaúčtovanie                                            */
/* ------------------------------------------------------------------ */

/**
 * Prechod do konečného stavu je atomický: v jednej transakcii sa zmení
 * stav úlohy AJ zaúčtujú kredity. Kto prehrá súboj o `UPDATE ... WHERE
 * status IN ('dispatching','running')`, ten neúčtuje nič — preto môžu
 * webhook a cron dobehnúť súčasne a nič sa nezdvojí.
 */
async function dokonci(
  uloha: Uloha,
  novyStav: 'succeeded' | 'failed' | 'canceled',
  data: { vysledok?: Vysledok; kod?: string; sprava?: string; uctovat: number },
): Promise<boolean> {
  const client = (await pool.connect()) as ClientLike;
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ user_id: string; price_credits: string }>(
      `UPDATE generation_jobs
          SET status = $2,
              result = $3::jsonb,
              error_code = $4,
              error_message = $5,
              charged_credits = $6,
              finished_at = now(),
              updated_at = now()
        WHERE id = $1 AND status IN ('queued', 'dispatching', 'running')
        RETURNING user_id, price_credits`,
      [
        uloha.id, novyStav,
        data.vysledok ? JSON.stringify(data.vysledok) : null,
        data.kod ?? null,
        data.sprava ? data.sprava.slice(0, 2000) : null,
        data.uctovat,
      ],
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return false; // niekto iný ju dokončil skôr
    }

    await zauctuj(
      client,
      String(rows[0].user_id),
      uloha.id,
      Number(rows[0].price_credits),
      data.uctovat,
      novyStav === 'succeeded' ? 'generovanie dokončené' : `generovanie zlyhalo (${data.kod ?? 'bez kódu'})`,
    );

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Skutočná cena, keď poskytovateľ nahlási počet jednotiek (dĺžka zvuku/videa). */
function skutocnaCena(uloha: Uloha, vysledok: Vysledok): number {
  const model = modelPodlaId(uloha.model_id);
  if (!model?.rezerva_jednotiek || !vysledok.jednotiek) return uloha.price_credits;

  const pomer = Math.min(1, vysledok.jednotiek / model.rezerva_jednotiek);
  return Math.max(1, Math.ceil(uloha.price_credits * pomer));
}

export async function dokonciUspechom(uloha: Uloha, vysledok: Vysledok): Promise<boolean> {
  const uctovat = skutocnaCena(uloha, vysledok);
  const zmenene = await dokonci(uloha, 'succeeded', { vysledok, uctovat });
  if (zmenene) {
    void zapisUdalost(uloha.id, 'hotovo', { suborov: vysledok.subory.length, uctovane: uctovat });
  }
  return zmenene;
}

export async function dokonciChybou(uloha: Uloha, kod: string, sprava: string): Promise<boolean> {
  const zmenene = await dokonci(uloha, 'failed', { kod, sprava, uctovat: 0 });
  if (zmenene) {
    void zapisUdalost(uloha.id, 'chyba', { kod, sprava: sprava.slice(0, 500) });
    if (kod === 'provider_bez_kreditu' || kod === 'zly_kluc') {
      // Toto nie je chyba užívateľa a treba to vidieť v logu okamžite.
      console.error(`[generation] PREVÁDZKOVÁ CHYBA (${kod}): ${sprava}`);
    }
  }
  return zmenene;
}

/* ------------------------------------------------------------------ */
/* callback + dopytovanie                                              */
/* ------------------------------------------------------------------ */

export async function ulohaPodlaId(jobId: string): Promise<Uloha | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${STLPCE} FROM generation_jobs WHERE id = $1`,
    [jobId],
  );
  return rows[0] ? naUlohu(rows[0]) : null;
}

/** Použije stav od poskytovateľa na úlohu. Vracia, či sa niečo zmenilo. */
export async function pouziStav(uloha: Uloha, stav: StavUlohy): Promise<boolean> {
  if (stav.stav === 'bezi') return false;
  if (stav.stav === 'hotovo') return dokonciUspechom(uloha, stav.vysledok);
  return dokonciChybou(uloha, stav.kod, stav.sprava);
}

export interface VysledokCallbacku {
  spracovane: boolean;
  preco?: string;
}

export async function spracujCallback(
  providerId: string,
  jobId: string,
  token: string,
  payload: unknown,
): Promise<VysledokCallbacku> {
  const uloha = await ulohaPodlaId(jobId);
  if (!uloha) return { spracovane: false, preco: 'uloha_neexistuje' };

  // Porovnanie v konštantnom čase netreba — token je 192-bitový náhodný
  // reťazec a útočník nemá ako merať. Dôležité je, že sa porovnáva vôbec.
  if (uloha.callback_token !== token) {
    void zapisUdalost(jobId, 'callback_zly_token', { providerId });
    return { spracovane: false, preco: 'zly_token' };
  }
  if (uloha.provider !== providerId) return { spracovane: false, preco: 'iny_poskytovatel' };

  const p = poskytovatel(providerId);
  if (!p?.zCallbacku) return { spracovane: false, preco: 'poskytovatel_bez_callbacku' };

  const rozobrane = p.zCallbacku(payload);
  if (!rozobrane) {
    void zapisUdalost(jobId, 'callback_nezrozumitelny', { payload });
    return { spracovane: false, preco: 'nezrozumitelny' };
  }

  if (uloha.provider_task_id && rozobrane.taskId !== uloha.provider_task_id) {
    return { spracovane: false, preco: 'iny_task' };
  }

  void zapisUdalost(jobId, 'callback', { stav: rozobrane.stav.stav });
  const zmenene = await pouziStav(uloha, rozobrane.stav);
  return { spracovane: zmenene, preco: zmenene ? undefined : 'uz_dokoncena' };
}

/** Dotiahne stav jednej bežiacej úlohy priamo od poskytovateľa. */
export async function dotiahniUlohu(uloha: Uloha): Promise<boolean> {
  if (uloha.status !== 'running' || !uloha.provider_task_id) return false;
  const p = poskytovatel(uloha.provider);
  if (!p) return false;

  try {
    const stav = await p.zisti(uloha.provider_task_id);
    return await pouziStav(uloha, stav);
  } catch (err) {
    const chyba = err instanceof ChybaPoskytovatela ? err : null;
    if (chyba && !chyba.opakovatelne) {
      return dokonciChybou(uloha, chyba.kod, chyba.message);
    }
    void zapisUdalost(uloha.id, 'dopyt_zlyhal', { sprava: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* údržba (cron)                                                       */
/* ------------------------------------------------------------------ */

/** Pustí čakajúce úlohy. Spravodlivo: najviac `maxInflightPerUser` na človeka. */
export async function odosliCakajuce(limit = GEN.cronBatchSize): Promise<{ pustene: number; caka: number }> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM (
       SELECT id,
              row_number() OVER (PARTITION BY user_id ORDER BY created_at) AS poradie,
              created_at
         FROM generation_jobs
        WHERE status = 'queued' AND next_attempt_at <= now()
     ) q
      WHERE poradie <= $1
      ORDER BY created_at
      LIMIT $2`,
    [GEN.maxInflightPerUser, limit],
  );

  // Paralelne — to je celý zmysel tohto systému.
  const vysledky = await Promise.allSettled(rows.map((r) => odosliUlohu(r.id)));
  const pustene = vysledky.filter(
    (v) => v.status === 'fulfilled' && (v.value.druh === 'odoslane' || v.value.druh === 'hotove'),
  ).length;

  const { rows: zvysok } = await pool.query<{ pocet: string }>(
    `SELECT count(*) AS pocet FROM generation_jobs WHERE status = 'queued'`,
  );

  return { pustene, caka: Number(zvysok[0]?.pocet ?? 0) };
}

/**
 * Poistka za callbackom: dotiahne bežiace úlohy, na ktoré sa poskytovateľ
 * dlhšie neozval, a zavrie tie, ktoré prekročili časový strop.
 */
export async function dotiahniBeziace(limit = GEN.cronBatchSize): Promise<{ dotiahnute: number; vyprsane: number }> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${STLPCE} FROM generation_jobs
      WHERE status = 'running'
        AND dispatched_at < now() - interval '20 seconds'
      ORDER BY dispatched_at
      LIMIT $1`,
    [limit],
  );

  const ulohy = rows.map(naUlohu);
  const hranica = Date.now() - GEN.jobTimeoutMinutes * 60_000;

  let vyprsane = 0;
  const dotiahnut: Uloha[] = [];

  for (const u of ulohy) {
    if (u.dispatched_at && new Date(u.dispatched_at).getTime() < hranica) {
      vyprsane += 1;
      await dokonciChybou(
        u,
        'timeout',
        `Poskytovateľ sa neozval do ${GEN.jobTimeoutMinutes} minút. Kredity sa vrátili.`,
      );
    } else {
      dotiahnut.push(u);
    }
  }

  const vysledky = await Promise.allSettled(dotiahnut.map((u) => dotiahniUlohu(u)));
  const dotiahnute = vysledky.filter((v) => v.status === 'fulfilled' && v.value).length;

  return { dotiahnute, vyprsane };
}

/**
 * Úlohy, ktoré uviazli v stave `dispatching` (spadol proces uprostred
 * odosielania). Vrátime ich do frontu — a keď už prekročili počet pokusov,
 * zavrieme ich a vrátime kredity.
 */
export async function zachranUviaznute(): Promise<number> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${STLPCE} FROM generation_jobs
      WHERE status = 'dispatching' AND updated_at < now() - interval '3 minutes'
      LIMIT 100`,
  );

  let opravene = 0;
  for (const r of rows) {
    const u = naUlohu(r);
    if (u.attempts >= GEN.maxAttempts) {
      if (await dokonciChybou(u, 'uviazla', 'Odoslanie sa nepodarilo dokončiť. Kredity sa vrátili.')) {
        opravene += 1;
      }
    } else {
      const { rowCount } = await pool.query(
        `UPDATE generation_jobs
            SET status = 'queued', next_attempt_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'dispatching'`,
        [u.id],
      );
      opravene += rowCount;
    }
  }
  return opravene;
}

/* ------------------------------------------------------------------ */
/* čítanie pre UI                                                      */
/* ------------------------------------------------------------------ */

export async function ulohaUzivatela(jobId: string, userId: string): Promise<Uloha | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${STLPCE} FROM generation_jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId],
  );
  return rows[0] ? naUlohu(rows[0]) : null;
}

export async function ulohyUzivatela(userId: string, limit = 30): Promise<Uloha[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${STLPCE} FROM generation_jobs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map(naUlohu);
}

/** Prevádzkový prehľad — koľko toho beží a koľko čaká. */
export async function prehladFronty(): Promise<{
  podlaStavu: Record<string, number>;
  podlaPoskytovatela: { provider: string; bezi: number }[];
}> {
  const { rows: stavy } = await pool.query<{ status: string; pocet: string }>(
    `SELECT status, count(*) AS pocet FROM generation_jobs
      WHERE created_at > now() - interval '24 hours'
      GROUP BY status`,
  );
  const { rows: podla } = await pool.query<{ provider: string; jobs: string }>(
    `SELECT provider, jobs FROM v_generation_inflight`,
  );

  return {
    podlaStavu: Object.fromEntries(stavy.map((r) => [r.status, Number(r.pocet)])),
    podlaPoskytovatela: podla.map((r) => ({ provider: r.provider, bezi: Number(r.jobs) })),
  };
}

export type { Model };
