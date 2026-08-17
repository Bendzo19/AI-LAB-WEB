/**
 * lib/discord.ts
 *
 * Thin, dependency-free Discord REST client for the pieces we need:
 *   - OAuth2 code exchange / refresh
 *   - fetch the authorising user's identity
 *   - add the user to the guild (needs `guilds.join` scope)
 *   - grant / revoke a role (needs bot token + Manage Roles + role hierarchy)
 *
 * Everything here is SERVER-ONLY. Importing this from a client component
 * would leak DISCORD_BOT_TOKEN. Keep it behind /api routes.
 */

const API = 'https://discord.com/api/v10';

/* ------------------------------------------------------------------ */
/* env                                                                 */
/* ------------------------------------------------------------------ */

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const DISCORD = {
  get clientId() { return env('DISCORD_CLIENT_ID'); },
  get clientSecret() { return env('DISCORD_CLIENT_SECRET'); },
  get botToken() { return env('DISCORD_BOT_TOKEN'); },
  get redirectUri() { return env('DISCORD_REDIRECT_URI'); },
  get guildId() { return env('DISCORD_GUILD_ID'); },
  get subscriberRoleId() { return env('DISCORD_SUBSCRIBER_ROLE_ID'); },
};

/** Scopes we ask the user for.
 *  identify    -> we get their Discord id / username / avatar
 *  guilds.join -> we can add them to the AI LAB server automatically
 */
export const OAUTH_SCOPES = ['identify', 'guilds.join'] as const;

/* ------------------------------------------------------------------ */
/* low-level fetch with retry on 429 / 5xx                             */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

interface DiscordFetchOptions extends RequestInit {
  /** how many times to retry on 429 / 5xx. default 3 */
  retries?: number;
}

async function discordFetch(
  path: string,
  init: DiscordFetchOptions = {},
): Promise<Response> {
  const { retries = 3, ...rest } = init;
  let attempt = 0;

  for (;;) {
    const res = await fetch(`${API}${path}`, {
      ...rest,
      // Never let Next.js cache Discord API responses.
      cache: 'no-store',
    });

    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= retries) return res;

    // Respect Discord's rate-limit headers when present.
    let waitMs = 1000 * 2 ** attempt;
    if (res.status === 429) {
      const body = (await res.clone().json().catch(() => ({}))) as Json;
      const retryAfter = Number(body.retry_after ?? 0);
      if (retryAfter > 0) waitMs = Math.ceil(retryAfter * 1000);
    }
    await new Promise((r) => setTimeout(r, waitMs));
    attempt += 1;
  }
}

async function assertOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  throw new Error(`Discord ${what} failed: ${res.status} ${res.statusText} ${text}`);
}

/* ------------------------------------------------------------------ */
/* OAuth2                                                             */
/* ------------------------------------------------------------------ */

export interface DiscordTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;   // seconds
  scope: string;
  token_type: string;
}

/** Build the URL we redirect the user to. */
export function buildAuthorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: DISCORD.clientId,
    redirect_uri: DISCORD.redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    state,
    // Always re-show the consent screen so a user can switch accounts.
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${p.toString()}`;
}

export async function exchangeCode(code: string): Promise<DiscordTokens> {
  const res = await discordFetch('/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD.clientId,
      client_secret: DISCORD.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: DISCORD.redirectUri,
    }),
  });
  await assertOk(res, 'token exchange');
  return res.json();
}

export async function refreshTokens(refreshToken: string): Promise<DiscordTokens> {
  const res = await discordFetch('/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD.clientId,
      client_secret: DISCORD.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  await assertOk(res, 'token refresh');
  return res.json();
}

/** Best-effort revoke so "Unlink" actually drops our access. */
export async function revokeToken(token: string): Promise<void> {
  await discordFetch('/oauth2/token/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD.clientId,
      client_secret: DISCORD.clientSecret,
      token,
    }),
    retries: 0,
  }).catch(() => undefined);
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export async function fetchCurrentUser(accessToken: string): Promise<DiscordUser> {
  const res = await discordFetch('/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await assertOk(res, 'users/@me');
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Guild membership + roles (bot token)                                */
/* ------------------------------------------------------------------ */

const botHeaders = () => ({
  Authorization: `Bot ${DISCORD.botToken}`,
  'Content-Type': 'application/json',
});

/**
 * Add the user to the guild. Requires the `guilds.join` OAuth scope
 * and the bot to have "Create Instant Invite" in the guild.
 *
 * 201 -> added, 204 -> already a member. Both are success.
 * We can pass roles straight away, which saves a second API call.
 */
export async function addGuildMember(
  discordId: string,
  accessToken: string,
  roles: string[] = [],
): Promise<'added' | 'already_member'> {
  const res = await discordFetch(
    `/guilds/${DISCORD.guildId}/members/${discordId}`,
    {
      method: 'PUT',
      headers: botHeaders(),
      body: JSON.stringify({ access_token: accessToken, roles }),
    },
  );
  if (res.status === 201) return 'added';
  if (res.status === 204) return 'already_member';
  await assertOk(res, 'add guild member');
  return 'already_member';
}

export interface GuildMember {
  roles: string[];
  nick: string | null;
  user?: DiscordUser;
}

/** null = user is not in the guild. */
export async function fetchGuildMember(discordId: string): Promise<GuildMember | null> {
  const res = await discordFetch(
    `/guilds/${DISCORD.guildId}/members/${discordId}`,
    { headers: botHeaders() },
  );
  if (res.status === 404) return null;
  await assertOk(res, 'get guild member');
  return res.json();
}

export async function grantRole(
  discordId: string,
  roleId: string = DISCORD.subscriberRoleId,
  reason = 'Active subscription on ailab web',
): Promise<void> {
  const res = await discordFetch(
    `/guilds/${DISCORD.guildId}/members/${discordId}/roles/${roleId}`,
    {
      method: 'PUT',
      headers: { ...botHeaders(), 'X-Audit-Log-Reason': encodeURIComponent(reason) },
    },
  );
  // 204 = ok (idempotent: already has it -> still 204)
  await assertOk(res, 'grant role');
}

export async function revokeRole(
  discordId: string,
  roleId: string = DISCORD.subscriberRoleId,
  reason = 'Subscription no longer active',
): Promise<void> {
  const res = await discordFetch(
    `/guilds/${DISCORD.guildId}/members/${discordId}/roles/${roleId}`,
    {
      method: 'DELETE',
      headers: { ...botHeaders(), 'X-Audit-Log-Reason': encodeURIComponent(reason) },
    },
  );
  if (res.status === 404) return; // not in guild / role already gone
  await assertOk(res, 'revoke role');
}
