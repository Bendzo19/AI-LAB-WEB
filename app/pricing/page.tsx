import type { Metadata } from 'next';
import Link from 'next/link';
import { balicky } from '@/lib/generation/balicky';
import { MODELY } from '@/lib/generation/catalog';

/**
 * Cenník je statický, ale kreditové balíčky sa dajú meniť premennou
 * CREDIT_PACKS. Aby zmena nečakala na ďalší deploy, stránka sa raz za
 * hodinu pregeneruje. Účtuje sa vždy podľa servera (/api/credits/checkout),
 * takže ani v tej hodine nemôže vzniknúť rozdiel medzi cenou a platbou.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Predplatné',
  description:
    'Prístup do AI LAB — workflows, knowledge base a Discord komunita. ' +
    'Rola Předplatné sa priradí automaticky po zaplatení.',
};

const INCLUDED = [
  'Všetky ComfyUI workflows (JSON na import)',
  'Postupy na identity consistency a LoRA tréning',
  'Image-to-video: prvý frame, motion, temporálna konzistencia',
  'Prompt knihovna pre FLUX, SDXL, Kling, Veo, Seedance',
  'Premium kanály na Discorde + feedback na tvoje výstupy',
  'Nové workflow a postupy priebežne, bez príplatku',
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Predplatné
      </h1>
      <p className="mt-3 max-w-lg text-white/55">
        Jeden prístup ku všetkému. Rolu <strong className="text-white/80">Předplatné</strong>{' '}
        na Discorde dostaneš automaticky po zaplatení — nemusíš nikoho kontaktovať.
      </p>

      <section className="mt-10 rounded-2xl border border-brand-500/25 bg-ink-800/60 p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">AI LAB Prístup</h2>
            <p className="mt-1 text-sm text-white/45">Mesačné predplatné, zrušiteľné kedykoľvek</p>
          </div>
          <p className="font-mono text-3xl font-semibold text-white">
            {/* TODO: doplň reálnu cenu a naviaž na Stripe Price ID */}
            —{' '}
            <span className="align-middle font-sans text-sm font-normal text-white/40">
              / mesiac
            </span>
          </p>
        </div>

        <ul className="mt-7 space-y-2.5">
          {INCLUDED.map((item) => (
            <li key={item} className="flex gap-3 text-sm text-white/65">
              <Check />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        {/* Stripe Checkout. metadata.user_id sa nastavuje v /api/checkout. */}
        <Link
          href="/api/checkout"
          prefetch={false}
          className="mt-8 block rounded-xl bg-brand-500 px-5 py-3 text-center
                     font-medium text-white transition hover:bg-brand-600"
        >
          Aktivovať predplatné
        </Link>

        <p className="mt-4 text-center text-xs leading-relaxed text-white/35">
          Platbu spracúva Stripe. Údaje o karte sa k nám nikdy nedostanú.
          Zrušením prestane predplatné platiť ku koncu zaplateného obdobia
          a vtedy sa odoberie aj rola na Discorde.
        </p>
      </section>

      {/* --------------------------------------------------- kredity --- */}
      <section id="kredity" className="mt-14 scroll-mt-24">
        <h2 className="text-xl font-semibold tracking-tight text-white">Kredity na generovanie</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/55">
          Predplatné je prístup ku know-how. Samotné generovanie vo{' '}
          <Link href="/studio" className="text-brand-400 underline-offset-4 hover:underline">
            Štúdiu
          </Link>{' '}
          sa platí kreditmi — koľko spotrebuješ, toľko zaplatíš. Kredity neexpirujú
          a generovať môžeš koľko vecí naraz chceš.
        </p>

        <ul className="mt-6 grid gap-4 sm:grid-cols-3">
          {balicky().map((b) => (
            <li
              key={b.id}
              className={`rounded-2xl border p-5 ${
                b.najpredavanejsi
                  ? 'border-brand-500/40 bg-brand-500/[0.06]'
                  : 'border-white/10 bg-ink-800/40'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-medium text-white">{b.nazov}</h3>
                {b.najpredavanejsi && (
                  <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-[11px] text-brand-300">
                    najčastejší
                  </span>
                )}
              </div>

              <p className="mt-3 text-2xl font-semibold tabular-nums text-white">
                {(b.cena_centov / 100).toFixed(2).replace('.', ',')} €
              </p>
              <p className="mt-1 text-sm tabular-nums text-white/55">
                {b.kredity.toLocaleString('sk-SK')} kreditov
              </p>
              {b.popis && <p className="mt-2 text-xs leading-relaxed text-white/40">{b.popis}</p>}

              <Link
                href={`/api/credits/checkout?balicek=${b.id}`}
                prefetch={false}
                className={`mt-5 block rounded-xl px-4 py-2.5 text-center text-sm font-medium transition ${
                  b.najpredavanejsi
                    ? 'bg-brand-500 text-white hover:bg-brand-600'
                    : 'border border-white/12 text-white/85 hover:bg-white/5'
                }`}
              >
                Kúpiť kredity
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-xs leading-relaxed text-white/35">
          Orientačne: fotka od {najlacnejsiaFotka()} kreditov, päťsekundové video od{' '}
          {najlacnejsieVideo()} kreditov. Presnú cenu vidíš pri každom modeli ešte pred
          spustením a pri neúspešnom generovaní sa kredity vracajú v plnej výške.
        </p>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold tracking-tight text-white">Časté otázky</h2>
        <dl className="mt-6 divide-y divide-white/8">
          <Faq
            q="Ako rýchlo dostanem rolu na Discorde?"
            a="Do niekoľkých sekúnd po zaplatení, ak už máš Discord prepojený. Ak nie, prepojíš ho v sekcii Účet a rola sa priradí okamžite po autorizácii."
          />
          <Faq
            q="Musím byť najprv na serveri?"
            a="Nie. Pri prepojení ťa na server pridáme automaticky, ak tam ešte nie si."
          />
          <Faq
            q="Čo sa stane, keď predplatné zruším?"
            a="Prístup ti zostane do konca zaplateného obdobia. Potom sa rola Předplatné automaticky odoberie a premium kanály zmiznú. Na serveri zostaneš."
          />
          <Faq
            q="Môžem Discord odpojiť?"
            a="Áno, kedykoľvek v sekcii Účet. Odpojením ale hneď stratíš rolu, aj keď máš predplatné aktívne — prepojenie je to, čo nám hovorí, komu rolu dať."
          />
          <Faq
            q="Môžem jeden Discord účet použiť na dve predplatné?"
            a="Nie. Jeden Discord účet sa dá prepojiť len s jedným účtom na AI LAB."
          />
        </dl>
      </section>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="py-5">
      <dt className="font-medium text-white">{q}</dt>
      <dd className="mt-1.5 text-sm leading-relaxed text-white/50">{a}</dd>
    </div>
  );
}

function Check() {
  return (
    <svg
      width="18" height="18" viewBox="0 0 20 20" fill="none"
      className="mt-0.5 shrink-0 text-brand-400" aria-hidden
    >
      <path
        d="M4.5 10.5l3.5 3.5 7.5-8"
        stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/* Ceny berieme z katalógu, nie z hlavy — inak sa text na cenníku rozíde
   s tým, čo Štúdio naozaj účtuje. */
function najlacnejsiaFotka(): number {
  return najlacnejsi('foto');
}

function najlacnejsieVideo(): number {
  return najlacnejsi('video');
}

function najlacnejsi(druh: string): number {
  const ceny = MODELY.filter((m) => m.druh === druh && m.dostupny).map((m) => m.kredity);
  return ceny.length ? Math.min(...ceny) : 0;
}
