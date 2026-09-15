/**
 * POST /api/credits/checkout   { balicek: "tvorca" }
 * GET  /api/credits/checkout?balicek=tvorca
 *
 * Jednorazová platba za kredity (nie predplatné). Kredity sa pripíšu až
 * z webhooku `checkout.session.completed` — nikdy nie z návratovej adresy,
 * ktorú si vie ktokoľvek otvoriť sám.
 *
 * Cena ide zo servera (`balicky()`), nie z tela požiadavky. Inak by si
 * klient vypýtal 6000 kreditov za 1 cent.
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getCurrentUserId } from '@/lib/auth';
import { pool } from '@/lib/db';
import { balicekPodlaId, balicky } from '@/lib/generation/balicky';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('balicek');
  if (!id) return NextResponse.json({ balicky: balicky() });
  return vytvor(req, id);
}

export async function POST(req: NextRequest) {
  let telo: { balicek?: string } = {};
  try {
    telo = (await req.json()) as { balicek?: string };
  } catch {
    /* prázdne telo je v poriadku, id môže prísť v query */
  }
  const id = telo.balicek ?? req.nextUrl.searchParams.get('balicek');
  if (!id) return NextResponse.json({ error: 'chyba_balicek' }, { status: 400 });
  return vytvor(req, id);
}

async function vytvor(req: NextRequest, balicekId: string) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'neprihlaseny' }, { status: 401 });

  const balicek = balicekPodlaId(balicekId);
  if (!balicek) return NextResponse.json({ error: 'neznamy_balicek' }, { status: 404 });

  const kluc = process.env.STRIPE_SECRET_KEY;
  if (!kluc) {
    return NextResponse.json(
      { error: 'stripe_nenastaveny', sprava: 'Chýba STRIPE_SECRET_KEY.' },
      { status: 503 },
    );
  }

  const stripe = new Stripe(kluc);
  const origin = process.env.APP_URL ?? req.nextUrl.origin;

  const { rows } = await pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: balicek.mena,
          unit_amount: balicek.cena_centov,
          product_data: {
            name: `${balicek.kredity} kreditov — ${balicek.nazov}`,
            description: balicek.popis,
          },
        },
      },
    ],
    // Webhook berie počet kreditov ODTIALTO, nie z požiadavky klienta.
    metadata: { user_id: String(userId), kredity: String(balicek.kredity), balicek: balicek.id },
    payment_intent_data: {
      metadata: { user_id: String(userId), kredity: String(balicek.kredity) },
    },
    customer_email: rows[0]?.email,
    success_url: `${origin}/studio?kredity=pripisane`,
    cancel_url: `${origin}/studio?kredity=zrusene`,
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    allow_promotion_codes: true,
    locale: 'sk',
  });

  if (!session.url) return NextResponse.json({ error: 'stripe_bez_url' }, { status: 500 });

  // Prehliadač posiela fetch (chce JSON), odkaz v maile chce presmerovanie.
  if (req.headers.get('accept')?.includes('application/json')) {
    return NextResponse.json({ url: session.url });
  }
  return NextResponse.redirect(session.url, { status: 303 });
}
