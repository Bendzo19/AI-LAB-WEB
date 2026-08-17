/**
 * lib/db.ts
 *
 * Postgres access + the two functions that carry all the business meaning:
 *   isSubscriptionActive()  -> does this website user currently pay?
 *   syncDiscordRole()       -> make Discord match that answer
 *
 * Uses `pg`. If you already use Prisma / Drizzle, replace the query bodies —
 * the exported signatures are what the routes depend on.
 *
 *   npm i pg
 *   npm i -D @types/pg
 */

import { Pool } from 'pg';
import { createPglitePool, type PoolLike } from './pglite-pool';
import {
  DISCORD,
  grantRole,
  revokeRole,
  fetchGuildMember,
  addGuildMember,
} from './discord';

/* ------------------------------------------------------------------ */
/* pool (survives hot-reload in dev)                                   */
/*                                                                     */
/* DATABASE_URL nastavené  -> skutočný Postgres (Neon, Supabase, …)     */
/* nenastavené + dev       -> PGlite v .dev-db/, nič netreba inštalovať */
/* nenastavené + produkcia -> spadne naschvál                          */
/* ------------------------------------------------------------------ */

const globalForPg = globalThis as unknown as { _pgPool?: PoolLike };

/** Zástupné hodnoty, ktoré ľudia zabudnú prepísať. V produkcii ich
 *  nepovolíme, v dev ich ignorujeme a spadneme na PGlite. */
const PLACEHOLDER_DB = /user:pass|user:heslo|:pass@|nieco\.|example\.com|changeme/i;

function createPool(): PoolLike {
  const raw = process.env.DATABASE_URL?.trim();
  const url = raw && !PLACEHOLDER_DB.test(raw) ? raw : undefined;

  if (raw && !url) {
    console.warn(
      '\x1b[33m[db]\x1b[0m DATABASE_URL vyzerá ako nevyplnená vzorová hodnota ' +
        `("${raw.slice(0, 40)}…") — ignorujem ju a použijem vývojovú databázu.`,
    );
  }

  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'DATABASE_URL chýba. V produkcii je povinné — vývojová databáza PGlite ' +
          'sa na serveri nesmie použiť, dáta by zmizli pri každom deployi.',
      );
    }
    return createPglitePool();
  }

  return new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    // Hostované databázy (Neon, Supabase) vyžadujú TLS; localhost nie.
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  }) as unknown as PoolLike;
}

export const pool: PoolLike = globalForPg._pgPool ?? createPool();

if (process.env.NODE_ENV !== 'production') globalForPg._pgPool = pool;

/* ------------------------------------------------------------------ */
/* links                                                               */
/* ------------------------------------------------------------------ */

export interface DiscordLinkRow {
  user_id: string;
  discord_id: string;
  discord_username: string | null;
  discord_avatar: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: Date | null;
  linked_at: Date;
}

export async function getLinkByUserId(userId: string): Promise<DiscordLinkRow | null> {
  const { rows } = await pool.query<DiscordLinkRow>(
    `SELECT * FROM discord_links WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function getLinkByDiscordId(discordId: string): Promise<DiscordLinkRow | null> {
  const { rows } = await pool.query<DiscordLinkRow>(
    `SELECT * FROM discord_links WHERE discord_id = $1`,
    [discordId],
  );
  return rows[0] ?? null;
}

export interface UpsertLinkInput {
  userId: string;
  discordId: string;
  username: string;
  avatar: string | null;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

/**
 * Create or update the link.
 * Throws `DISCORD_ALREADY_LINKED` if that Discord account belongs to someone else —
 * without this check, two website accounts could share one Discord user and both
 * would fight over the role.
 */
export async function upsertLink(input: UpsertLinkInput): Promise<void> {
  const existing = await getLinkByDiscordId(input.discordId);
  if (existing && existing.user_id !== input.userId) {
    throw new Error('DISCORD_ALREADY_LINKED');
  }

  await pool.query(
    `INSERT INTO discord_links
       (user_id, discord_id, discord_username, discord_avatar,
        access_token, refresh_token, token_expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval, now())
     ON CONFLICT (user_id) DO UPDATE SET
       discord_id       = EXCLUDED.discord_id,
       discord_username = EXCLUDED.discord_username,
       discord_avatar   = EXCLUDED.discord_avatar,
       access_token     = EXCLUDED.access_token,
       refresh_token    = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       updated_at       = now()`,
    [
      input.userId,
      input.discordId,
      input.username,
      input.avatar,
      input.accessToken,
      input.refreshToken,
      String(input.expiresInSeconds),
    ],
  );
}

export async function deleteLink(userId: string): Promise<DiscordLinkRow | null> {
  const { rows } = await pool.query<DiscordLinkRow>(
    `DELETE FROM discord_links WHERE user_id = $1 RETURNING *`,
    [userId],
  );
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* subscription truth                                                  */
/* ------------------------------------------------------------------ */

export async function isSubscriptionActive(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM v_active_subscribers WHERE user_id = $1) AS ok`,
    [userId],
  );
  return rows[0]?.ok ?? false;
}

/** Every linked account + whether it should hold the role. Used by the cron job. */
export async function listLinksWithEntitlement(): Promise<
  { userId: string; discordId: string; shouldHaveRole: boolean }[]
> {
  const { rows } = await pool.query<{
    user_id: string;
    discord_id: string;
    should_have_role: boolean;
  }>(
    `SELECT dl.user_id,
            dl.discord_id,
            (a.user_id IS NOT NULL) AS should_have_role
     FROM discord_links dl
     LEFT JOIN v_active_subscribers a ON a.user_id = dl.user_id`,
  );
  return rows.map((r) => ({
    userId: r.user_id,
    discordId: r.discord_id,
    shouldHaveRole: r.should_have_role,
  }));
}

/* ------------------------------------------------------------------ */
/* audit                                                               */
/* ------------------------------------------------------------------ */

async function logRoleEvent(e: {
  userId: string | null;
  discordId: string;
  roleId: string;
  action: 'grant' | 'revoke' | 'join';
  reason: string;
  success: boolean;
  error?: string;
}): Promise<void> {
  await pool
    .query(
      `INSERT INTO discord_role_events
         (user_id, discord_id, role_id, action, reason, success, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [e.userId, e.discordId, e.roleId, e.action, e.reason, e.success, e.error ?? null],
    )
    .catch(() => undefined); // audit must never break the main flow
}

/* ------------------------------------------------------------------ */
/* the one function that matters                                       */
/* ------------------------------------------------------------------ */

export type SyncResult =
  | { action: 'granted' }
  | { action: 'revoked' }
  | { action: 'noop'; why: 'already_correct' | 'not_in_guild' | 'no_link' }
  | { action: 'error'; error: string };

/**
 * Make Discord reflect the database.
 *
 * - active subscription  -> user has DISCORD_SUBSCRIBER_ROLE_ID
 * - no subscription      -> user does not have it
 *
 * Idempotent: safe to call from the OAuth callback, a Stripe webhook and a
 * nightly cron at the same time.
 *
 * @param opts.accessToken pass the user's OAuth access token to also ADD them
 *        to the guild if they aren't a member yet (requires guilds.join scope).
 */
export async function syncDiscordRole(
  userId: string,
  opts: { accessToken?: string; reason?: string } = {},
): Promise<SyncResult> {
  const link = await getLinkByUserId(userId);
  if (!link) return { action: 'noop', why: 'no_link' };

  const roleId = DISCORD.subscriberRoleId;
  const shouldHave = await isSubscriptionActive(userId);
  const reason = opts.reason ?? (shouldHave ? 'Subscription active' : 'Subscription inactive');

  try {
    let member = await fetchGuildMember(link.discord_id);

    // Not in the server yet? If we have their OAuth token, pull them in.
    if (!member) {
      if (!opts.accessToken) return { action: 'noop', why: 'not_in_guild' };

      await addGuildMember(
        link.discord_id,
        opts.accessToken,
        shouldHave ? [roleId] : [],
      );
      await logRoleEvent({
        userId, discordId: link.discord_id, roleId,
        action: 'join', reason, success: true,
      });

      if (shouldHave) {
        await logRoleEvent({
          userId, discordId: link.discord_id, roleId,
          action: 'grant', reason, success: true,
        });
        return { action: 'granted' };
      }
      return { action: 'noop', why: 'already_correct' };
    }

    const hasRole = member.roles.includes(roleId);

    if (shouldHave && !hasRole) {
      await grantRole(link.discord_id, roleId, reason);
      await logRoleEvent({
        userId, discordId: link.discord_id, roleId,
        action: 'grant', reason, success: true,
      });
      return { action: 'granted' };
    }

    if (!shouldHave && hasRole) {
      await revokeRole(link.discord_id, roleId, reason);
      await logRoleEvent({
        userId, discordId: link.discord_id, roleId,
        action: 'revoke', reason, success: true,
      });
      return { action: 'revoked' };
    }

    return { action: 'noop', why: 'already_correct' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logRoleEvent({
      userId, discordId: link.discord_id, roleId,
      action: shouldHave ? 'grant' : 'revoke',
      reason, success: false, error: message,
    });
    return { action: 'error', error: message };
  }
}
