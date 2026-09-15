/**
 * /studio — generovanie na webe.
 *
 * Server component: overí prihlásenie a načíta zostatok, aby prvé
 * vykreslenie nebolo prázdne. Zvyšok (katalóg, úlohy, dopytovanie)
 * si dotiahne klient.
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import { getCurrentUserId } from '@/lib/auth';
import { stavUctu, zabezpecUcet } from '@/lib/generation/credits';
import { Studio } from '@/components/studio/Studio';
import { SITE } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Štúdio — ${SITE.name}`,
  description: 'Generovanie fotiek, videí a hlasu. Platíš kreditmi, generuješ koľko chceš naraz.',
  robots: { index: false },
};

export default async function StudioPage() {
  const userId = await getCurrentUserId();

  if (!userId) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24">
        <h1 className="text-2xl font-semibold text-white">Štúdio je pre prihlásených</h1>
        <p className="mt-3 leading-relaxed text-white/55">
          Generovanie sa účtuje z kreditov, takže potrebujeme vedieť, komu ich odpísať.
        </p>
        <Link
          href="/account"
          className="mt-7 inline-block rounded-xl bg-brand-500 px-5 py-3 font-medium text-white
                     transition hover:bg-brand-600"
        >
          Prejsť na účet
        </Link>
      </main>
    );
  }

  await zabezpecUcet(userId);
  const ucet = await stavUctu(userId);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 sm:py-14">
      <Studio zostatokNaStart={ucet.balance} drzaneNaStart={ucet.reserved} />
    </main>
  );
}
