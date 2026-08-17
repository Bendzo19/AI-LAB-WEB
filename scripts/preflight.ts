/**
 * scripts/preflight.ts
 *
 *   npm run check
 *
 * Spusti to skôr, než budeš hľadať, prečo web nejde. Prejde .env, databázu
 * aj Discord a vypíše presne to, čo chýba — namiesto toho, aby si lovil
 * chybu v behu aplikácie.
 *
 * Nič nemení a nič nikam neposiela okrem dvoch čítacích dotazov na Discord
 * API (kto som + aké mám role) a jedného `select 1` na databázu.
 */

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
const ok   = (m: string) => console.log(`  ${G}✓${X} ${m}`);
const bad  = (m: string) => console.log(`  ${R}✗${X} ${m}`);
const warn = (m: string) => console.log(`  ${Y}!${X} ${m}`);
const hint = (m: string) => console.log(`    ${D}${m}${X}`);

async function main(): Promise<void> {
  let fatal = 0;

  /* ------------------------------------------------------------------ ENV */
  console.log(`\n${B}1. Premenné v .env${X}`);

  const REQUIRED = [
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'DISCORD_BOT_TOKEN',
    'DISCORD_REDIRECT_URI',
    'DISCORD_GUILD_ID',
    'DISCORD_SUBSCRIBER_ROLE_ID',
    'DISCORD_STATE_SECRET',
    'APP_URL',
  ] as const;

  // Hodnoty, ktoré vyzerajú "vyplnené", ale sú to zabudnuté zástupné texty.
  const PLACEHOLDERS = [/^dummy$/i, /^x$/i, /^todo$/i, /^zmen/i, /DOPL/i, /^changeme$/i, /^$/];

  for (const k of REQUIRED) {
    const v = process.env[k];
    if (!v) {
      bad(`${k} chýba`);
      fatal++;
    } else if (PLACEHOLDERS.some((p) => p.test(v))) {
      bad(`${k} má zástupnú hodnotu ("${v}")`);
      fatal++;
    } else {
      // Tokeny nikdy nevypisujeme celé.
      const shown = /TOKEN|SECRET|DATABASE_URL/.test(k)
        ? `${v.slice(0, 6)}… (${v.length} znakov)`
        : v;
      ok(`${k} = ${shown}`);
    }
  }

  if (process.env.DISCORD_BOT_TOKEN && /^dummy|^x$/i.test(process.env.DISCORD_BOT_TOKEN)) {
    hint('Token vezmi z Developer Portal → Bot → Resetovat token');
  }

  const redirect = process.env.DISCORD_REDIRECT_URI ?? '';
  if (redirect && !redirect.endsWith('/api/discord/callback')) {
    bad(`DISCORD_REDIRECT_URI musí končiť /api/discord/callback — máš "${redirect}"`);
    fatal++;
  }
  if (redirect && process.env.APP_URL && !redirect.startsWith(process.env.APP_URL)) {
    warn(`DISCORD_REDIRECT_URI (${redirect}) nezačína rovnako ako APP_URL (${process.env.APP_URL})`);
    hint('Ak sa nezhodujú, Discord vráti invalid_redirect_uri.');
  }

  const stateSecret = process.env.DISCORD_STATE_SECRET ?? '';
  if (stateSecret && stateSecret.length < 32) {
    warn(`DISCORD_STATE_SECRET je krátky (${stateSecret.length} znakov) — použi openssl rand -hex 32`);
  }

  if (fatal) {
    console.log(`\n${R}${B}Zastavujem — najprv doplň .env.${X}\n`);
    process.exit(1);
  }

  /* ------------------------------------------------------------- DATABÁZA */
  console.log(`\n${B}2. Databáza${X}`);

  const EXPECTED_TABLES = ['users', 'subscriptions', 'discord_links', 'discord_role_events'];

  if (!process.env.DATABASE_URL?.trim()) {
    ok('DATABASE_URL nie je nastavené → použije sa vývojová databáza PGlite');
    hint('Nič inštalovať nemusíš. Dáta pôjdu do .dev-db/ v projekte.');
    hint('Na produkciu doplň DATABASE_URL z Neonu — vtedy sa PGlite nepoužije.');
  } else try {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')
        ? undefined
        : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    });

    await pool.query('select 1');
    ok('pripojenie funguje');

    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const have = new Set(rows.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !have.has(t));

    if (missing.length) {
      bad(`chýbajú tabuľky: ${missing.join(', ')}`);
      hint('Spusti db/schema.sql — v Neone cez SQL Editor, alebo:');
      hint('psql "$DATABASE_URL" -f db/schema.sql');
      fatal++;
    } else {
      ok(`tabuľky sú na mieste (${EXPECTED_TABLES.join(', ')})`);
      const { rows: c } = await pool.query<{ n: string }>('select count(*)::text n from users');
      console.log(`    ${D}užívateľov v databáze: ${c[0].n}${X}`);
    }
    await pool.end();
  } catch (err) {
    bad(`nepripojím sa: ${err instanceof Error ? err.message : String(err)}`);
    hint('Skontroluj DATABASE_URL. Neon connection string musí obsahovať ?sslmode=require');
    fatal++;
  }

  /* --------------------------------------------------------------- DISCORD */
  console.log(`\n${B}3. Discord${X}`);

  const API = 'https://discord.com/api/v10';
  const auth = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };

  try {
    const meRes = await fetch(`${API}/users/@me`, { headers: auth });
    if (!meRes.ok) {
      bad(`token neplatí (${meRes.status} ${meRes.statusText})`);
      hint('Resetuj token v Developer Portal → Bot a vlož nový do .env');
      fatal++;
    } else {
      const me = (await meRes.json()) as { id: string; username: string };
      ok(`bot je prihlásený ako ${me.username}`);
      if (me.id !== process.env.DISCORD_CLIENT_ID) {
        bad(`token patrí inej aplikácii (bot ${me.id} ≠ CLIENT_ID ${process.env.DISCORD_CLIENT_ID})`);
        fatal++;
      }

      const guild = process.env.DISCORD_GUILD_ID;
      const gRes = await fetch(`${API}/guilds/${guild}/members/${me.id}`, { headers: auth });
      if (!gRes.ok) {
        bad(`bot nie je na serveri ${guild} (${gRes.status})`);
        hint('Pridaj ho cez inštalačný odkaz vo footeri webu.');
        fatal++;
      } else {
        ok('bot je na serveri AI LAB');

        const rRes = await fetch(`${API}/guilds/${guild}/roles`, { headers: auth });
        const roles = (await rRes.json()) as Array<{
          id: string; name: string; position: number; permissions: string; managed: boolean;
        }>;
        const member = (await gRes.json()) as { roles: string[] };

        const target = roles.find((r) => r.id === process.env.DISCORD_SUBSCRIBER_ROLE_ID);
        if (!target) {
          bad(`rola ${process.env.DISCORD_SUBSCRIBER_ROLE_ID} na serveri neexistuje`);
          fatal++;
        } else {
          ok(`cieľová rola: ${target.name} (pozícia ${target.position})`);
          if (target.managed) {
            bad(`rola "${target.name}" je spravovaná integráciou — bot ju priradiť NEMÔŽE`);
            fatal++;
          }

          const MANAGE_ROLES = 1n << 28n, ADMIN = 1n << 3n;
          const botRoles = roles.filter((r) => member.roles.includes(r.id));
          const perms = botRoles.reduce((a, r) => a | BigInt(r.permissions), 0n);
          const canManage = (perms & MANAGE_ROLES) !== 0n || (perms & ADMIN) !== 0n;

          if (canManage) ok('bot má oprávnenie Správa rolí');
          else {
            bad('bot NEMÁ oprávnenie Správa rolí (Manage Roles)');
            hint('Nastavenia servera → Roly → rola bota → zapni Správa rolí');
            fatal++;
          }

          const highest = Math.max(...botRoles.map((r) => r.position), -1);
          if (highest > target.position) {
            ok(`hierarchia je v poriadku (bot ${highest} > rola ${target.position})`);
          } else {
            bad(`hierarchia je zlá — najvyššia rola bota je ${highest}, cieľová ${target.position}`);
            hint('Rolu bota musíš v Nastavenia servera → Roly presunúť NAD rolu Předplatné.');
            hint('Toto je najčastejšia príčina 403 Missing Permissions.');
            fatal++;
          }
        }
      }
    }
  } catch (err) {
    bad(`Discord API nedostupné: ${err instanceof Error ? err.message : String(err)}`);
    fatal++;
  }

  /* ---------------------------------------------------------------- VÝSLEDOK */
  console.log('');
  if (fatal) {
    console.log(`${R}${B}${fatal} problém(ov) — oprav ich a spusti znova: npm run check${X}\n`);
    process.exit(1);
  }
  console.log(`${G}${B}Všetko v poriadku. Spusti web:${X} npm run dev`);
  console.log(`${D}Potom: http://localhost:3000/api/dev/login?sub=1 → /account → Prepojiť Discord${X}\n`);

}

main().catch((err) => {
  console.error(`\n${R}Preflight zlyhal:${X}`, err);
  process.exit(1);
});

export {};
