import type { Metadata } from 'next';
import { DiscordLinkCard } from '@/components/DiscordLinkCard';
import { getCurrentUserId } from '@/lib/auth';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Môj účet',
  robots: { index: false, follow: false },
};

// Stav prepojenia sa mení mimo Next.js (cez cron a Stripe webhook),
// takže túto stránku nesmieme cachovať.
export const dynamic = 'force-dynamic';

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ discord?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const userId = await getCurrentUserId();

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-white">Môj účet</h1>
      <p className="mt-2 text-white/50">
        Prepojenie Discordu a stav tvojho predplatného.
      </p>

      <div className="mt-10">
        {userId ? (
          <DiscordLinkCard searchParams={params} />
        ) : (
          <section className="rounded-2xl border border-white/10 bg-ink-800/60 p-6">
            <h2 className="font-semibold text-white">Nie si prihlásený</h2>
            <p className="mt-1.5 text-sm text-white/50">
              Discord sa prepája k tvojmu účtu na AI LAB, takže sa najprv musíš
              prihlásiť.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-block rounded-lg bg-brand-500 px-4 py-2.5
                         text-sm font-medium text-white transition hover:bg-brand-600"
            >
              Prihlásiť sa
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
