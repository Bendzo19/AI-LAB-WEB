/**
 * GET /api/dev/login   — LEN PRE VÝVOJ A TESTOVANIE
 *
 * Účel: umožniť otestovať celý Discord flow ešte PREDTÝM, než postavíš
 * skutočné prihlasovanie. Vytvorí testovacieho užívateľa, nastaví session
 * cookie a voliteľne mu dá aktívne predplatné.
 *
 * Použitie:
 *   /api/dev/login                  -> užívateľ BEZ predplatného
 *   /api/dev/login?sub=1            -> užívateľ S aktívnym predplatným
 *   /api/dev/login?sub=1&email=a@b.sk
 *   /api/dev/login?logout=1         -> odhlásenie
 *
 * Test scenár:
 *   1. /api/dev/login?sub=1   -> "prihlásiš" sa s predplatným
 *   2. /account               -> klikni Prepojiť Discord
 *   3. na Discorde autorizuj
 *   4. skontroluj rolu Předplatné na serveri AI LAB
 *   5. /api/dev/login         -> ten istý e-mail, ale bez predplatného
 *   6. zavolaj cron sync      -> rola sa musí ODOBRAŤ
 *
 * BEZPEČNOSŤ: v produkcii vracia 404. Toto je jediná vec, ktorá stojí medzi
 * týmto endpointom a tým, aby si sa hocikto prihlásil ako hocikto. Nikdy
 * neodstraňuj tú kontrolu a tento súbor zmaž, keď budeš mať reálne auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool, syncDiscordRole } from '@/lib/db';

export const dynamic = 'force-dynamic';

const IS_PROD = process.env.NODE_ENV === 'production';

export async function GET(req: NextRequest) {
  if (IS_PROD) {
    return new NextResponse('Not found', { status: 404 });
  }

  const sp = req.nextUrl.searchParams;
  const origin = process.env.APP_URL ?? req.nextUrl.origin;

  /* ---------- odhlásenie ---------- */
  if (sp.get('logout')) {
    const res = NextResponse.redirect(new URL('/', origin));
    res.cookies.delete('session_user_id');
    return res;
  }

  const email = sp.get('email') ?? 'test@ailab-web.com';
  const wantSub = sp.get('sub') === '1';

  let userId: string;

  // Transakciu držíme len na zápisy a hneď ju zatvárame. Discord voláme až
  // POTOM — držať databázové spojenie počas HTTP volania na cudzie API je
  // spôsob, ako vyčerpať pool (a s PGlite, ktoré má jedno spojenie, je to
  // priamo deadlock).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Užívateľ podľa e-mailu (idempotentné — opakované volanie ho neduplikuje).
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [email],
    );
    userId = String(rows[0].id);

    // Predplatné prepneme podľa ?sub — nech sa dá testovať grant aj revoke.
    const subId = `dev_sub_${userId}`;
    if (wantSub) {
      await client.query(
        `INSERT INTO subscriptions
           (user_id, provider, provider_customer_id, provider_subscription_id,
            status, current_period_end, updated_at)
         VALUES ($1, 'dev', $2, $3, 'active', now() + interval '30 days', now())
         ON CONFLICT (provider_subscription_id) DO UPDATE SET
           status = 'active',
           current_period_end = now() + interval '30 days',
           updated_at = now()`,
        [userId, `dev_cus_${userId}`, subId],
      );
    } else {
      await client.query(
        `UPDATE subscriptions
         SET status = 'canceled', current_period_end = now() - interval '1 day',
             updated_at = now()
         WHERE provider_subscription_id = $1`,
        [subId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dev/login]', msg);
    return NextResponse.json(
      {
        error: 'dev login failed',
        detail: msg,
        hint:
          'Ak používaš vlastný Postgres: beží a je DATABASE_URL správne? ' +
          'Spustil si db/schema.sql? Bez DATABASE_URL sa použije PGlite a ' +
          'schéma sa aplikuje sama.',
      },
      { status: 500 },
    );
  } finally {
    // Uvoľniť PRED volaním Discordu.
    client.release();
  }

  // Ak už Discord prepojený má, hneď zosynchronizuj rolu — tak vidíš
  // efekt zmeny predplatného okamžite, bez čakania na cron.
  let action = 'unknown';
  try {
    const sync = await syncDiscordRole(userId, {
      reason: `dev login (sub=${wantSub})`,
    });
    action = sync.action;
  } catch (err) {
    // Nezhodíme prihlásenie kvôli Discordu — chceme sa dostať na /account
    // a tam uvidíš, čo je zlé.
    action = 'error';
    console.error('[dev/login] syncDiscordRole:', err instanceof Error ? err.message : err);
  }

  const target = new URL('/account', origin);
  target.searchParams.set('dev', wantSub ? 'sub-active' : 'sub-inactive');
  target.searchParams.set('role', action);

  const res = NextResponse.redirect(target);
  res.cookies.set('session_user_id', userId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // dev = http
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
