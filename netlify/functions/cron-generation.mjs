/**
 * netlify/functions/cron-generation.mjs
 *
 * Netlify vie spúšťať funkcie podľa času, ale nie route-y Next.js.
 * Táto funkcia teda len zavolá našu údržbovú route.
 *
 * Čo robí údržba: pustí úlohy, ktoré čakali na uvoľnenie stropu, dotiahne
 * výsledky, na ktoré nedorazil callback, a zavrie tie, čo prekročili
 * časový strop (kredity sa vrátia).
 *
 * Generovanie na tomto NESTOJÍ — bežná cesta je request + callback.
 * Toto je poistka. Keby cron nebežal vôbec, web funguje ďalej.
 */

export default async () => {
  const zaklad = process.env.APP_URL ?? process.env.URL;
  if (!zaklad) {
    console.error('[cron-generation] chýba APP_URL aj URL');
    return new Response('missing base url', { status: 500 });
  }

  const res = await fetch(`${zaklad.replace(/\/+$/, '')}/api/cron/generation`, {
    headers: process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
  });

  const telo = await res.text();
  if (!res.ok) console.error('[cron-generation]', res.status, telo.slice(0, 500));
  return new Response(telo, { status: res.status });
};

export const config = { schedule: '* * * * *' };
