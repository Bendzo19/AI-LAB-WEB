/**
 * scripts/verify-setup.ts
 *
 * Run this FIRST, before touching the app code. It proves the Discord side is
 * configured correctly and tells you exactly what is wrong if it isn't —
 * far faster than debugging a silent 403 in a webhook.
 *
 *   npx tsx scripts/verify-setup.ts
 *   npx tsx scripts/verify-setup.ts <tvoje_discord_id>   # also does a live role test
 */

const API = 'https://discord.com/api/v10';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const ROLE  = process.env.DISCORD_SUBSCRIBER_ROLE_ID;
const APP   = process.env.DISCORD_CLIENT_ID;

const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;

function ok(m: string)   { console.log(`  \x1b[32m✓\x1b[0m ${m}`); }
function bad(m: string)  { console.log(`  \x1b[31m✗\x1b[0m ${m}`); }
function warn(m: string) { console.log(`  \x1b[33m!\x1b[0m ${m}`); }

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

interface Role { id: string; name: string; position: number; permissions: string; managed: boolean }
interface Member { user: { id: string; username: string }; roles: string[] }

async function main() {
  let failed = false;

  console.log('\n\x1b[1mENV\x1b[0m');
  for (const [k, v] of Object.entries({
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_GUILD_ID: GUILD,
    DISCORD_SUBSCRIBER_ROLE_ID: ROLE,
    DISCORD_CLIENT_ID: APP,
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
    DISCORD_REDIRECT_URI: process.env.DISCORD_REDIRECT_URI,
    DISCORD_STATE_SECRET: process.env.DISCORD_STATE_SECRET,
  })) {
    if (v) ok(`${k} set`);
    else { bad(`${k} MISSING`); failed = true; }
  }
  if (failed) { console.log('\nFix the env first.\n'); process.exit(1); }

  console.log('\n\x1b[1mBOT IDENTITY\x1b[0m');
  const me = await api<{ id: string; username: string }>('/users/@me');
  ok(`logged in as ${me.username} (${me.id})`);
  if (me.id !== APP) {
    bad(`bot id ${me.id} != DISCORD_CLIENT_ID ${APP} — token belongs to a different app`);
    failed = true;
  }

  console.log('\n\x1b[1mGUILD\x1b[0m');
  const guild = await api<{ id: string; name: string }>(`/guilds/${GUILD}`);
  ok(`bot is in "${guild.name}"`);

  console.log('\n\x1b[1mROLES\x1b[0m');
  const roles = await api<Role[]>(`/guilds/${GUILD}/roles`);

  const target = roles.find((r) => r.id === ROLE);
  if (!target) {
    bad(`role ${ROLE} not found in guild`);
    failed = true;
  } else {
    ok(`target role "${target.name}" @ position ${target.position}`);
    if (target.managed) {
      bad('target role is integration-managed — a bot cannot assign it');
      failed = true;
    }
  }

  const botMember = await api<Member>(`/guilds/${GUILD}/members/${me.id}`);
  const botRoles = roles.filter((r) => botMember.roles.includes(r.id));

  const perms = botRoles.reduce((acc, r) => acc | BigInt(r.permissions), 0n);
  const isAdmin = (perms & ADMINISTRATOR) !== 0n;
  const canManage = isAdmin || (perms & MANAGE_ROLES) !== 0n;

  if (canManage) ok(`bot has Manage Roles${isAdmin ? ' (via Administrator)' : ''}`);
  else { bad('bot LACKS Manage Roles — Server Settings → Roles → bot role → Správa rolí'); failed = true; }

  const highest = Math.max(...botRoles.map((r) => r.position), 0);
  const highestName = botRoles.find((r) => r.position === highest)?.name ?? '?';
  console.log(`    bot roles: ${botRoles.map((r) => `${r.name}(${r.position})`).join(', ')}`);

  if (target) {
    if (highest > target.position) {
      ok(`hierarchy ok: "${highestName}"(${highest}) > "${target.name}"(${target.position})`);
    } else {
      bad(
        `hierarchy BROKEN: bot's highest role "${highestName}"(${highest}) is not above ` +
        `"${target.name}"(${target.position}). Drag the bot's role higher in Server Settings → Roles.`,
      );
      failed = true;
    }
  }

  console.log('\n\x1b[1mINTENTS / MEMBER LIST\x1b[0m');
  try {
    const members = await api<Member[]>(`/guilds/${GUILD}/members?limit=1`);
    ok(`can list members (${members.length} sampled) — Server Members Intent is on`);
  } catch {
    warn('cannot list members — enable Server Members Intent (only needed for bulk sync)');
  }

  const testId = process.argv[2];
  if (testId) {
    console.log('\n\x1b[1mLIVE ROLE TEST\x1b[0m');
    const before = await api<Member>(`/guilds/${GUILD}/members/${testId}`);
    const had = before.roles.includes(ROLE!);
    console.log(`    ${before.user.username} currently ${had ? 'HAS' : 'does not have'} the role`);

    const put = await fetch(`${API}/guilds/${GUILD}/members/${testId}/roles/${ROLE}`, {
      method: 'PUT',
      headers: { Authorization: `Bot ${TOKEN}`, 'X-Audit-Log-Reason': 'verify-setup test' },
    });
    if (put.ok) ok('grant succeeded');
    else { bad(`grant failed: ${put.status} ${await put.text()}`); failed = true; }

    if (!had && put.ok) {
      const del = await fetch(`${API}/guilds/${GUILD}/members/${testId}/roles/${ROLE}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${TOKEN}`, 'X-Audit-Log-Reason': 'verify-setup cleanup' },
      });
      if (del.ok) ok('revoke succeeded (state restored)');
      else warn(`revoke failed: ${del.status} — role left assigned`);
    }
  }

  console.log(
    failed
      ? '\n\x1b[31mSETUP INCOMPLETE\x1b[0m — fix the ✗ items above.\n'
      : '\n\x1b[32mSETUP OK\x1b[0m — the bot can assign the role.\n',
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\n\x1b[31mFATAL\x1b[0m', e instanceof Error ? e.message : e, '\n');
  process.exit(1);
});

export {};
