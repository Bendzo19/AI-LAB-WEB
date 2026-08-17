import Link from 'next/link';
import Image from 'next/image';
import { SITE } from '@/lib/site';

export default function HomePage() {
  return (
    <>
      {/* ---------------- hero ---------------- */}
      <section className="glow relative overflow-hidden">
        {/* logo ako svetelný akcent — dekoratívne, preto aria-hidden */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-16 hidden opacity-[0.13]
                     blur-[1px] lg:block"
        >
          <Image src="/logo-512.png" alt="" width={460} height={460} priority />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-28 sm:pb-24">
          <Image
            src="/logo-128.png"
            alt=""
            width={56}
            height={56}
            priority
            className="mb-7 h-14 w-14 lg:hidden"
          />
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10
                        bg-white/[0.03] px-3 py-1 text-xs font-medium text-brand-400">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" aria-hidden />
            Komunita + knowledge base
          </p>

          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight
                         text-white sm:text-6xl">
            Postav si AI creatora,
            <br />
            ktorý vydrží{' '}
            <span className="bg-gradient-to-r from-brand-400 to-brand-600 bg-clip-text text-transparent">
              viac než jeden post
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/55">
            Identity consistency, ComfyUI workflows, image-to-video a marketing,
            ktorý to celé zarobí. Bez teórie — hotové postupy, ktoré fungujú dnes.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/pricing"
              className="rounded-xl bg-brand-500 px-5 py-3 font-medium text-white
                         transition hover:bg-brand-600"
            >
              Získať prístup
            </Link>
            <Link
              href="/account"
              className="rounded-xl border border-white/12 px-5 py-3 font-medium
                         text-white/85 transition hover:bg-white/5"
            >
              Prepojiť Discord
            </Link>
          </div>

          <p className="mt-4 text-sm text-white/35">
            Po zaplatení dostaneš rolu <strong className="text-white/60">Předplatné</strong>{' '}
            na Discorde automaticky — do niekoľkých sekúnd.
          </p>
        </div>
      </section>

      {/* ---------------- pilíře ---------------- */}
      <section className="mx-auto max-w-6xl px-6 py-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card
            title="Identity consistency"
            body="LoRA tréning, dataset príprava, FaceID a IP-Adapter workflow. Aby tvoja modelka vyzerala rovnako na stotine fotky, nie len na prvej."
          />
          <Card
            title="ComfyUI workflows"
            body="Hotové JSON workflow na import — image-to-image, upscale, face detailer, regional prompting. Vysvetlené po nodoch, nie „skopíruj a mlč“."
          />
          <Card
            title="Image-to-video"
            body="Prvý frame, motion prompting, temporálna konzistencia. Kling, Veo, Seedance a Runway — čo na čo použiť a prečo."
          />
          <Card
            title="Realizmus, nie plast"
            body="Prečo technicky perfektná fotka performuje horšie ako mierne nedokonalá. Raw iPhone estetika, ktorá neprezradí AI."
          />
          <Card
            title="Distribúcia"
            body="Content pillars, hooky, retention, profile conversion. Ako z pekných obrázkov spraviť sledovanosť a z nej príjem."
          />
          <Card
            title="Komunita"
            body="Discord s ľuďmi, ktorí to reálne robia. Feedback na tvoje výstupy, wins kanál, a odpovede od tých, čo už tú chybu spravili."
          />
        </div>
      </section>

      {/* ---------------- ako to funguje ---------------- */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Ako prebieha prístup
        </h2>
        <p className="mt-2.5 max-w-lg text-white/50">
          Tri kroky. Rolu na Discorde nemusíš nikoho prosiť — priradí sa sama.
        </p>

        <ol className="mt-10 grid gap-5 sm:grid-cols-3">
          <Step
            n={1}
            title="Predplatné"
            body="Zaplatíš na webe. Platbu spracúva Stripe, karta sa k nám nikdy nedostane."
          />
          <Step
            n={2}
            title="Prepojíš Discord"
            body="Jeden klik na „Prepojiť Discord“. Ak nie si na serveri, pridáme ťa automaticky."
          />
          <Step
            n={3}
            title="Rola je tam"
            body="Dostaneš rolu Předplatné a s ňou premium kanály. Keď predplatné skončí, rola sa odoberie."
          />
        </ol>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-8">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-ink-800 px-8 py-14 text-center">
          <div className="glow pointer-events-none absolute inset-0" aria-hidden />
          <h2 className="relative text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Prvý konzistentný character do týždňa
          </h2>
          <p className="relative mx-auto mt-3 max-w-md text-white/55">
            Nie za tri mesiace hľadania po YouTube. Postupy sú napísané tak, aby si
            ich vedel spustiť dnes večer.
          </p>
          <Link
            href="/pricing"
            className="relative mt-8 inline-block rounded-xl bg-brand-500 px-6 py-3
                       font-medium text-white transition hover:bg-brand-600"
          >
            Pozrieť predplatné
          </Link>
        </div>
      </section>
    </>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-2xl border border-white/8 bg-ink-800/60 p-6 transition
                        hover:border-white/15 hover:bg-ink-800">
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-white/50">{body}</p>
    </article>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="rounded-2xl border border-white/8 bg-ink-800/60 p-6">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500/15
                       font-mono text-sm font-bold text-brand-400">
        {n}
      </span>
      <h3 className="mt-4 font-semibold text-white">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-white/50">{body}</p>
    </li>
  );
}
