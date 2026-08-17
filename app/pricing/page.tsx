import type { Metadata } from 'next';
import Link from 'next/link';

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
