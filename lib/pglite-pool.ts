/**
 * lib/pglite-pool.ts
 *
 * Vývojová databáza, ktorá nepotrebuje NIČ nainštalovať.
 *
 * PGlite je skutočný PostgreSQL skompilovaný do WebAssembly. Beží priamo
 * v procese Node.js a ukládá dáta do priečinka `.dev-db/`. Znamená to, že
 * to isté SQL, ktoré pobeží na Neone, funguje aj tu — nič sa neprepisuje.
 *
 * Aktivuje sa SAMA, keď v .env nie je `DATABASE_URL`. Takže:
 *
 *   npm install && npm run dev     -> ide, databázu riešiť nemusíš
 *
 * Keď neskôr doplníš `DATABASE_URL` (Neon), kód automaticky prepne na
 * skutočný Postgres a tento súbor sa nepoužije.
 *
 * V produkcii sa NIKDY nepoužije — bez DATABASE_URL app v produkcii spadne
 * naschvál, aby ti dáta neskončili v efemérnom priečinku na serveri.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Podmnožina `pg.Pool`, ktorú aplikácia reálne používa. */
export interface PoolLike {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
  connect(): Promise<ClientLike>;
  end(): Promise<void>;
}

export interface ClientLike {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
  release(): void;
}

const DATA_DIR = join(process.cwd(), '.dev-db');
const SCHEMA = join(process.cwd(), 'db', 'schema.sql');

type PGliteInstance = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

let ready: Promise<PGliteInstance> | null = null;

async function boot(): Promise<PGliteInstance> {
  const { PGlite } = (await import('@electric-sql/pglite')) as {
    PGlite: new (dir?: string) => PGliteInstance;
  };

  const db = new PGlite(DATA_DIR);

  // Schému aplikujeme pri každom starte. schema.sql je idempotentná
  // (IF NOT EXISTS), takže opakovaný beh nič nerozbije.
  try {
    await db.exec(readFileSync(SCHEMA, 'utf8'));
  } catch (err) {
    console.error(
      '\n[pglite] Nepodarilo sa aplikovať db/schema.sql:',
      err instanceof Error ? err.message : err,
    );
    throw err;
  }

  console.log(
    `\x1b[35m[pglite]\x1b[0m vývojová databáza beží (${DATA_DIR}). ` +
      `Pre produkciu doplň DATABASE_URL do .env.`,
  );
  return db;
}

function instance(): Promise<PGliteInstance> {
  ready ??= boot();
  return ready;
}

/**
 * PGlite má jedno spojenie, takže paralelné dotazy treba serializovať —
 * inak by sa dve transakcie prekryli a BEGIN/COMMIT by si liezli do cesty.
 */
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function run<T>(text: string, params?: unknown[]) {
  const db = await instance();
  const res = await db.query(text, params ?? []);
  const rows = (res.rows ?? []) as T[];
  return { rows, rowCount: res.affectedRows ?? rows.length };
}

export function createPglitePool(): PoolLike {
  return {
    query: <T = Record<string, unknown>>(text: string, params?: unknown[]) =>
      serialize(() => run<T>(text, params)),

    // Aplikácia používa connect() na transakcie. PGlite má jedno spojenie,
    // tak vrátime ten istý objekt — a držíme si zámok, kým sa nezavolá
    // release(), aby transakcia nebola prerušená iným dotazom.
    async connect(): Promise<ClientLike> {
      let unlock!: () => void;
      const held = new Promise<void>((res) => (unlock = res));
      const mine = chain.then(
        () => undefined,
        () => undefined,
      );
      chain = mine.then(() => held);
      await mine;

      return {
        query: <T = Record<string, unknown>>(text: string, params?: unknown[]) =>
          run<T>(text, params),
        release: () => unlock(),
      };
    },

    async end() {
      if (!ready) return;
      const db = await ready;
      await db.close();
      ready = null;
    },
  };
}
