/**
 * netlify/functions/cron-sync-roles.mjs
 *
 * Hodinová reconciliácia Discord rolí (existujúca route /api/cron/sync-roles).
 * Predplatné vyprší tichým uplynutím obdobia — bez tohto by neplatiaci
 * držali rolu ďalej.
 */

export default async () => {
  const zaklad = process.env.APP_URL ?? process.env.URL;
  if (!zaklad) return new Response('missing base url', { status: 500 });

  const res = await fetch(`${zaklad.replace(/\/+$/, '')}/api/cron/sync-roles`, {
    headers: process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
  });
  const telo = await res.text();
  if (!res.ok) console.error('[cron-sync-roles]', res.status, telo.slice(0, 500));
  return new Response(telo, { status: res.status });
};

export const config = { schedule: '0 * * * *' };
