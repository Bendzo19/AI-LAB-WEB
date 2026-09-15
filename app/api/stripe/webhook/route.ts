/**
 * POST /api/stripe/webhook
 *
 * Instant grant/revoke the moment a payment event happens.
 * Without this, a new subscriber waits until the next cron run for their role.
 *
 * Stripe CLI (dev):
 *   stripe listen --forward-to localhost:3000/api/stripe/webhook
 *
 * Events to enable in the Stripe dashboard:
 *   checkout.session.completed
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   invoice.payment_failed
 *
 *   npm i stripe
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { pool, syncDiscordRole } from '@/lib/db';
import { pripis } from '@/lib/generation/credits';

export const dynamic = 'force-dynamic';
// Stripe needs the raw body for signature verification.
export const runtime = 'nodejs';

/**
 * Klient sa vytvára až v požiadavke, nie pri načítaní modulu.
 *
 * Pri načítaní modulu ho vytvoriť nemožno: `next build` prechádza route-y
 * a bez `STRIPE_SECRET_KEY` (CI, preview, klon bez .env) by celý build
 * spadol na súbore, ktorý sa pri builde ani nemá volať.
 */
function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY');
  return new Stripe(key);
}

/** Map a Stripe customer back to your website user. Adjust to your schema. */
async function userIdForCustomer(customerId: string): Promise<string | null> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM subscriptions
     WHERE provider_customer_id = $1
     ORDER BY updated_at DESC LIMIT 1`,
    [customerId],
  );
  return rows[0]?.user_id ?? null;
}

async function upsertSubscription(sub: Stripe.Subscription, userId: string) {
  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;

  await pool.query(
    `INSERT INTO subscriptions
       (user_id, provider, provider_customer_id, provider_subscription_id,
        status, current_period_end, cancel_at_period_end, updated_at)
     VALUES ($1, 'stripe', $2, $3, $4::subscription_status, $5, $6, now())
     ON CONFLICT (provider_subscription_id) DO UPDATE SET
       status               = EXCLUDED.status,
       current_period_end   = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       updated_at           = now()`,
    [
      userId,
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      sub.id,
      sub.status,
      periodEnd ? new Date(periodEnd * 1000) : null,
      sub.cancel_at_period_end,
    ],
  );
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'no signature' }, { status: 400 });

  let stripe: Stripe;
  try {
    stripe = stripeClient();
  } catch {
    console.error('[stripe/webhook] STRIPE_SECRET_KEY nie je nastavené');
    return NextResponse.json({ error: 'stripe not configured' }, { status: 503 });
  }

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('[stripe/webhook] bad signature', err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Put your website user id in metadata when creating the Checkout Session:
        //   metadata: { user_id: String(user.id) }
        const userId = session.metadata?.user_id ?? null;

        /* Jednorazový nákup kreditov (mode: 'payment').
         *
         * Počet kreditov berieme z metadát session, ktoré sme SAMI zapísali
         * pri jej vytváraní — nie z ničoho, čo pošle prehliadač. `ref` je id
         * session, takže opakovaný webhook (Stripe ich posiela pri pochybnosti
         * znova) kredity nepripíše druhýkrát. */
        if (userId && session.mode === 'payment' && session.metadata?.kredity) {
          if (session.payment_status !== 'paid') {
            console.warn('[stripe/webhook] session bez zaplatenia, kredity nepripisujem', session.id);
            break;
          }
          const kredity = Number(session.metadata.kredity);
          if (!Number.isInteger(kredity) || kredity <= 0) {
            console.error('[stripe/webhook] zlé metadata.kredity', session.metadata.kredity);
            break;
          }
          const vysledok = await pripis(
            userId,
            kredity,
            session.id,
            'topup',
            `nákup balíčka ${session.metadata.balicek ?? '?'}`,
          );
          console.log(
            `[stripe/webhook] kredity ${vysledok.pripisane ? 'pripísané' : 'už boli pripísané'}: ` +
              `+${kredity} pre užívateľa ${userId}, zostatok ${vysledok.zostatok}`,
          );
          break;
        }

        if (!userId || !session.subscription) break;

        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription.id;
        const sub = await stripe.subscriptions.retrieve(subId);

        await upsertSubscription(sub, userId);
        await syncDiscordRole(userId, { reason: `stripe:${event.type}` });
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

        const userId =
          sub.metadata?.user_id ?? (await userIdForCustomer(customerId));
        if (!userId) {
          console.warn('[stripe/webhook] no user for customer', customerId);
          break;
        }

        await upsertSubscription(sub, userId);
        await syncDiscordRole(userId, { reason: `stripe:${event.type}` });
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
        if (!customerId) break;

        const userId = await userIdForCustomer(customerId);
        if (userId) await syncDiscordRole(userId, { reason: 'stripe:payment_failed' });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // Return 500 so Stripe retries — better than silently losing a role grant.
    console.error('[stripe/webhook] handler error', err);
    return NextResponse.json({ error: 'handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
