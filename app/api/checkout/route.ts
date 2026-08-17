/**
 * POST|GET /api/checkout
 *
 * Vytvorí Stripe Checkout Session a presmeruje užívateľa na platbu.
 *
 * Kritická vec: do metadata MUSÍ ísť `user_id`, a to na DVE miesta —
 * na session aj na subscription_data. Webhook potom vie, komu priradiť
 * rolu. Bez toho platba prejde, ale rola sa nepriradí a budeš hľadať prečo.
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getCurrentUserId } from '@/lib/auth';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY');
  return new Stripe(key);
}

async function createCheckout(req: NextRequest) {
  const origin = process.env.APP_URL ?? req.nextUrl.origin;

  const userId = await getCurrentUserId();
  if (!userId) {
    const login = new URL('/login', origin);
    login.searchParams.set('next', '/pricing');
    return NextResponse.redirect(login);
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json(
      {
        error: 'STRIPE_PRICE_ID nie je nastavené',
        hint:
          'Stripe Dashboard -> Product catalog -> vytvor produkt s opakovanou ' +
          'cenou -> skopíruj Price ID (price_...) do .env',
      },
      { status: 500 },
    );
  }

  const stripe = stripeClient();

  // E-mail predvyplníme, aby užívateľ nemusel písať to, čo už vieme.
  const { rows } = await pool.query<{ email: string }>(
    `SELECT email FROM users WHERE id = $1`,
    [userId],
  );
  const email = rows[0]?.email;

  // Ak už raz platil, použijeme toho istého Stripe customera — inak by sa
  // v Stripe hromadili duplikáty toho istého človeka.
  const { rows: cust } = await pool.query<{ provider_customer_id: string | null }>(
    `SELECT provider_customer_id FROM subscriptions
     WHERE user_id = $1 AND provider = 'stripe' AND provider_customer_id IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  const existingCustomer = cust[0]?.provider_customer_id ?? undefined;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],

    ...(existingCustomer
      ? { customer: existingCustomer }
      : { customer_email: email }),

    // Toto je to, čo webhook potrebuje.
    metadata: { user_id: String(userId) },
    subscription_data: { metadata: { user_id: String(userId) } },

    success_url: `${origin}/account?discord=checkout&stripe=success`,
    cancel_url: `${origin}/pricing?stripe=cancelled`,

    // EÚ: daňové údaje a súhlas so začatím plnenia pred uplynutím
    // 14-dňovej lehoty na odstúpenie (viď /terms čl. 5).
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    consent_collection: { terms_of_service: 'required' },
    allow_promotion_codes: true,
    locale: 'sk',
  });

  if (!session.url) {
    return NextResponse.json({ error: 'Stripe nevrátil URL' }, { status: 500 });
  }
  return NextResponse.redirect(session.url, { status: 303 });
}

export async function GET(req: NextRequest) {
  try {
    return await createCheckout(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[checkout]', msg);
    return NextResponse.json({ error: 'checkout failed', detail: msg }, { status: 500 });
  }
}

export const POST = GET;
