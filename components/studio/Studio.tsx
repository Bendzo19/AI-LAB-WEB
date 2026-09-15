'use client';

/**
 * components/studio/Studio.tsx
 *
 * Generovanie na webe.
 *
 * Kľúčová vec pre pocit z rýchlosti: kliknutie na „Generovať" NEČAKÁ na
 * obrázok. Server vráti úlohu do pár stoviek milisekúnd, karta sa objaví
 * hneď v stave „generujem" a výsledok do nej dorazí, keď je hotový.
 * Medzitým sa dá kľudne zadať ďalšie generovanie — aj desiate.
 *
 * Dopytovanie je len na tie úlohy, ktoré naozaj bežia, a spomaľuje sa
 * s ich vekom. Dvadsať otvorených kariet teda neznamená dvadsať
 * requestov za sekundu.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { spocitajCenu } from '@/lib/generation/cena';
import { Pole } from './Pole';
import { KartaUlohy } from './KartaUlohy';
import { jeVBehu, type Katalog, type ModelPreWeb, type UlohaPreWeb } from './typy';

const DRUHY = [
  { id: 'foto', nazov: 'Fotky' },
  { id: 'video', nazov: 'Videá' },
  { id: 'zvuk', nazov: 'Hlas' },
  { id: 'upscale', nazov: 'Zväčšiť' },
] as const;

interface Props {
  zostatokNaStart: number;
  drzaneNaStart: number;
}

export function Studio({ zostatokNaStart, drzaneNaStart }: Props) {
  const [katalog, setKatalog] = useState<Katalog | null>(null);
  const [nacitavam, setNacitavam] = useState(true);
  const [chybaNacitania, setChybaNacitania] = useState<string | null>(null);

  const [druh, setDruh] = useState<string>('foto');
  const [modelId, setModelId] = useState<string | null>(null);
  const [hodnoty, setHodnoty] = useState<Record<string, unknown>>({});

  const [ulohy, setUlohy] = useState<UlohaPreWeb[]>([]);
  const [zostatok, setZostatok] = useState(zostatokNaStart);
  const [drzane, setDrzane] = useState(drzaneNaStart);

  const [odosielam, setOdosielam] = useState(false);
  const [chybyPoli, setChybyPoli] = useState<Record<string, string>>({});
  const [hlaska, setHlaska] = useState<{ druh: 'chyba' | 'info'; text: string } | null>(null);

  const model = useMemo(
    () => katalog?.modely.find((m) => m.id === modelId) ?? null,
    [katalog, modelId],
  );

  /* ------------------------------------------------ prvé načítanie */
  useEffect(() => {
    let zrusene = false;

    (async () => {
      try {
        const [kRes, uRes] = await Promise.all([
          fetch('/api/models'),
          fetch('/api/generate?limit=20'),
        ]);
        if (!kRes.ok) throw new Error(`Katalóg sa nenačítal (${kRes.status}).`);

        const k = (await kRes.json()) as Katalog;
        const u = uRes.ok ? ((await uRes.json()) as { ulohy: UlohaPreWeb[] }) : { ulohy: [] };
        if (zrusene) return;

        setKatalog(k);
        setUlohy(u.ulohy);

        const prvy = k.modely.find((m) => m.druh === 'foto') ?? k.modely[0];
        if (prvy) {
          setModelId(prvy.id);
          setDruh(prvy.druh);
          setHodnoty(predvoleneHodnoty(prvy));
        }
      } catch (err) {
        if (!zrusene) setChybaNacitania(err instanceof Error ? err.message : String(err));
      } finally {
        if (!zrusene) setNacitavam(false);
      }
    })();

    return () => {
      zrusene = true;
    };
  }, []);

  /* --------------------------------------- dopytovanie bežiacich úloh */
  const bezia = useMemo(() => ulohy.filter(jeVBehu), [ulohy]);
  const beziaRef = useRef(bezia);
  beziaRef.current = bezia;

  useEffect(() => {
    if (bezia.length === 0) return;

    let zastav = false;

    const tik = async () => {
      const aktualne = beziaRef.current;
      if (aktualne.length === 0) return;

      const odpovede = await Promise.all(
        aktualne.map((u) =>
          fetch(`/api/generate/${u.id}`)
            .then((r) => (r.ok ? (r.json() as Promise<{ uloha: UlohaPreWeb }>) : null))
            .catch(() => null),
        ),
      );
      if (zastav) return;

      const nove = new Map(
        odpovede.filter((o): o is { uloha: UlohaPreWeb } => Boolean(o)).map((o) => [o.uloha.id, o.uloha]),
      );
      if (nove.size === 0) return;

      setUlohy((stare) => stare.map((u) => nove.get(u.id) ?? u));

      // Keď niektorá dobehla, zostatok sa mohol zmeniť (vrátenie rozdielu).
      if ([...nove.values()].some((u) => !jeVBehu(u))) void obnovKredity();
    };

    const interval = setInterval(() => void tik(), 2000);
    return () => {
      zastav = true;
      clearInterval(interval);
    };
  }, [bezia.length]);

  const obnovKredity = useCallback(async () => {
    try {
      const res = await fetch('/api/credits');
      if (!res.ok) return;
      const d = (await res.json()) as { zostatok: number; drzane: number };
      setZostatok(d.zostatok);
      setDrzane(d.drzane);
    } catch {
      /* zostatok je len informácia, jeho výpadok nesmie nič rozbiť */
    }
  }, []);

  /* -------------------------------------------------------- cena */
  const cena = useMemo(
    () => (model ? spocitajCenu(model, hodnoty, katalog?.prirazka_pct ?? 0) : null),
    [model, hodnoty, katalog],
  );

  const staci = cena === null || zostatok >= cena.kredity;

  /* ---------------------------------------------------- odoslanie */
  async function odosli(e: React.FormEvent) {
    e.preventDefault();
    if (!model || odosielam) return;

    setOdosielam(true);
    setChybyPoli({});
    setHlaska(null);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.id,
          polia: hodnoty,
          // Chráni pred dvojklikom aj pred zopakovaním requestu pri
          // vypadnutej sieti — server druhýkrát nezaloží nič nové.
          idempotency_key: crypto.randomUUID(),
        }),
      });

      const data = (await res.json()) as {
        uloha?: UlohaPreWeb;
        zostatok?: number;
        drzane?: number;
        error?: string;
        sprava?: string;
        treba?: number;
        chyby?: { pole: string; sprava: string }[];
      };

      if (res.status === 422 && data.chyby) {
        setChybyPoli(Object.fromEntries(data.chyby.map((c) => [c.pole, c.sprava])));
        setHlaska({ druh: 'chyba', text: 'Skontroluj vyznačené polia.' });
        return;
      }

      if (!res.ok || !data.uloha) {
        setHlaska({
          druh: 'chyba',
          text: data.sprava ?? `Nepodarilo sa odoslať (${res.status}).`,
        });
        if (typeof data.zostatok === 'number') setZostatok(data.zostatok);
        return;
      }

      setUlohy((stare) => [data.uloha!, ...stare].slice(0, 40));
      if (typeof data.zostatok === 'number') setZostatok(data.zostatok);
      if (typeof data.drzane === 'number') setDrzane(data.drzane);
    } catch (err) {
      setHlaska({
        druh: 'chyba',
        text: `Spojenie zlyhalo: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setOdosielam(false);
    }
  }

  function vyberModel(m: ModelPreWeb) {
    setModelId(m.id);
    setHodnoty(predvoleneHodnoty(m));
    setChybyPoli({});
    setHlaska(null);
  }

  /* -------------------------------------------------------- render */
  const hlavicka = (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Štúdio</h1>
        <p className="mt-1.5 text-sm text-white/50">
          Pusti si koľko generovaní chceš naraz — nič nečaká na nič.
        </p>
      </div>

      <div className="flex items-center gap-3">
        {/* Zostatok je v klientovi zámerne: po dobehnutí úlohy sa vracia
            rozdiel medzi rezerváciou a skutočnou cenou, takže číslo v
            hlavičke sa musí vedieť zmeniť bez obnovenia stránky. */}
        <p className="rounded-xl border border-white/10 bg-ink-900 px-4 py-2.5 text-sm" aria-live="polite">
          <span className="font-medium tabular-nums text-white">{zostatok}</span>
          <span className="text-white/45"> kreditov</span>
          {drzane > 0 && <span className="text-white/35"> · {drzane} držaných</span>}
        </p>
        <Link
          href="/pricing#kredity"
          className="rounded-xl border border-white/12 px-4 py-2.5 text-sm text-white/85
                     transition hover:bg-white/5"
        >
          Dobiť
        </Link>
      </div>
    </header>
  );

  if (nacitavam) return <>{hlavicka}<Kostra /></>;

  if (chybaNacitania) {
    return (
      <>
      {hlavicka}
      <p className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-5 py-4 text-sm text-red-200">
        {chybaNacitania}
      </p>
      </>
    );
  }

  if (!katalog || katalog.modely.length === 0) {
    return (
      <>
      {hlavicka}
      <div className="rounded-2xl border border-white/10 bg-ink-900 px-5 py-6">
        <h2 className="font-medium text-white">Zatiaľ nie je čo generovať</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-white/50">
          Žiadny poskytovateľ nemá nastavené kľúče. Doplň <code className="text-brand-400">KIE_API_KEY</code>{' '}
          (prípadne <code className="text-brand-400">GOOGLE_API_KEY</code> alebo{' '}
          <code className="text-brand-400">OPENAI_API_KEY</code>) a stránku obnov.
        </p>
      </div>
      </>
    );
  }

  const vDruhu = katalog.modely.filter((m) => m.druh === druh);
  const zakladne = model?.polia.filter((p) => p.skupina !== 'pokrocile') ?? [];
  const pokrocile = model?.polia.filter((p) => p.skupina === 'pokrocile') ?? [];

  return (
    <>
    {hlavicka}
    <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
      {/* ---------------------------------------------- výber modelu */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div
          role="tablist"
          aria-label="Druh výstupu"
          className="mb-3 flex gap-1 rounded-xl border border-white/10 bg-ink-900 p-1"
        >
          {DRUHY.filter((d) => katalog.modely.some((m) => m.druh === d.id)).map((d) => (
            <button
              key={d.id}
              role="tab"
              type="button"
              aria-selected={druh === d.id}
              onClick={() => setDruh(d.id)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                druh === d.id ? 'bg-brand-500 text-white' : 'text-white/55 hover:text-white'
              }`}
            >
              {d.nazov}
            </button>
          ))}
        </div>

        <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1 lg:max-h-[calc(100vh-14rem)]">
          {vDruhu.map((m) => {
            const vybraty = m.id === modelId;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => vyberModel(m)}
                  aria-current={vybraty || undefined}
                  className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${
                    vybraty
                      ? 'border-brand-500/60 bg-brand-500/10'
                      : 'border-white/10 bg-ink-900 hover:border-white/20 hover:bg-ink-800'
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-white">{m.nazov}</span>
                    <span className="shrink-0 text-xs tabular-nums text-white/40">od {m.kredity} kr.</span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-white/45">{m.popis}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ------------------------------------------------- formulár */}
      <div className="min-w-0 space-y-6">
        {model && (
          <form onSubmit={odosli} className="rounded-2xl border border-white/10 bg-ink-900 p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-white">{model.nazov}</h2>
              {model.stitky.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-white/55"
                >
                  {s}
                </span>
              ))}
            </div>

            {model.moderacia_veta && (
              <p className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-xs leading-relaxed text-amber-100/80">
                {model.moderacia_veta}
              </p>
            )}

            <div className="space-y-5">
              {zakladne.map((p) => (
                <Pole
                  key={p.meno}
                  pole={p}
                  hodnota={hodnoty[p.meno]}
                  chyba={chybyPoli[p.meno]}
                  nahravanieDostupne={katalog.nahravanie}
                  onZmena={(h) => setHodnoty((s) => ({ ...s, [p.meno]: h }))}
                />
              ))}
            </div>

            {pokrocile.length > 0 && (
              <details className="group mt-5 border-t border-white/8 pt-4">
                <summary className="cursor-pointer text-sm text-white/55 transition hover:text-white">
                  Pokročilé nastavenia ({pokrocile.length})
                </summary>
                <div className="mt-4 space-y-5">
                  {pokrocile.map((p) => (
                    <Pole
                      key={p.meno}
                      pole={p}
                      hodnota={hodnoty[p.meno]}
                      chyba={chybyPoli[p.meno]}
                      nahravanieDostupne={katalog.nahravanie}
                      onZmena={(h) => setHodnoty((s) => ({ ...s, [p.meno]: h }))}
                    />
                  ))}
                </div>
              </details>
            )}

            {hlaska && (
              <p
                role="alert"
                className={`mt-5 rounded-xl px-4 py-3 text-sm ${
                  hlaska.druh === 'chyba'
                    ? 'border border-red-400/20 bg-red-400/[0.06] text-red-200'
                    : 'border border-white/10 bg-white/[0.03] text-white/70'
                }`}
              >
                {hlaska.text}
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/8 pt-5">
              <div className="text-sm">
                <p className="font-medium text-white">
                  {cena ? `${cena.kredity} kreditov` : '—'}
                  {cena?.odhad && <span className="ml-1.5 text-xs text-white/40">(rezervácia, zvyšok vrátime)</span>}
                </p>
                <p className="mt-0.5 text-xs text-white/40">
                  {staci ? `Po generovaní ostane ${zostatok - (cena?.kredity ?? 0)}.` : 'Nemáš dosť kreditov.'}
                  {cena?.poznamka ? ` ${cena.poznamka}` : ''}
                </p>
              </div>

              {staci ? (
                <button
                  type="submit"
                  disabled={odosielam}
                  className="rounded-xl bg-brand-500 px-5 py-2.5 font-medium text-white transition
                             hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {odosielam ? 'Odosielam…' : 'Generovať'}
                </button>
              ) : (
                <Link
                  href="/pricing#kredity"
                  className="rounded-xl bg-brand-500 px-5 py-2.5 font-medium text-white transition hover:bg-brand-600"
                >
                  Dobiť kredity
                </Link>
              )}
            </div>
          </form>
        )}

        {/* ----------------------------------------------- výsledky */}
        <section aria-labelledby="vysledky-nadpis">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="vysledky-nadpis" className="text-sm font-medium text-white/70">
              Tvoje generovania
            </h2>
            <p className="text-xs tabular-nums text-white/35" aria-live="polite">
              {bezia.length > 0 ? `${bezia.length} beží` : `${ulohy.length} spolu`}
              {drzane > 0 && ` · ${drzane} kr. držaných`}
            </p>
          </div>

          {ulohy.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center text-sm text-white/35">
              Zatiaľ nič. Vyber model, napíš zadanie a klikni Generovať.
            </p>
          ) : (
            <div className="space-y-4">
              {ulohy.map((u) => (
                <KartaUlohy key={u.id} uloha={u} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
    </>
  );
}

function predvoleneHodnoty(m: ModelPreWeb): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of m.polia) {
    if (p.predvolene !== undefined) out[p.meno] = p.predvolene;
  }
  return out;
}

function Kostra() {
  return (
    <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]" aria-busy>
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-ink-900" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-2xl bg-ink-900" />
      <span className="sr-only">Načítavam štúdio…</span>
    </div>
  );
}
