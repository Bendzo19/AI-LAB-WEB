'use client';

/**
 * components/studio/KartaUlohy.tsx
 *
 * Jedna úloha vo feede. Ukazuje presne jeden z piatich stavov — čaká,
 * beží, hotovo, zlyhalo, zrušené — a pri zlyhaní vždy aj to, že kredity
 * sú späť. To je informácia, kvôli ktorej ľudia inak píšu na podporu.
 */

import type { UlohaPreWeb } from './typy';

const STAVY: Record<UlohaPreWeb['stav'], { text: string; farba: string; bodka: string }> = {
  queued: { text: 'Čaká na miesto', farba: 'text-amber-300', bodka: 'bg-amber-400' },
  dispatching: { text: 'Odosielam', farba: 'text-brand-400', bodka: 'bg-brand-400 animate-pulse' },
  running: { text: 'Generujem', farba: 'text-brand-400', bodka: 'bg-brand-400 animate-pulse' },
  succeeded: { text: 'Hotovo', farba: 'text-emerald-300', bodka: 'bg-emerald-400' },
  failed: { text: 'Zlyhalo', farba: 'text-red-300', bodka: 'bg-red-400' },
  canceled: { text: 'Zrušené', farba: 'text-white/40', bodka: 'bg-white/30' },
};

function cas(od: string | null, do_: string | null): string | null {
  if (!od || !do_) return null;
  const s = (new Date(do_).getTime() - new Date(od).getTime()) / 1000;
  if (s < 0) return null;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

export function KartaUlohy({ uloha }: { uloha: UlohaPreWeb }) {
  const stav = STAVY[uloha.stav];
  const trvanie = cas(uloha.vytvorene, uloha.dokoncene);
  const prompt = typeof uloha.vstup.prompt === 'string'
    ? uloha.vstup.prompt
    : typeof uloha.vstup.text === 'string'
      ? uloha.vstup.text
      : null;

  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-ink-900">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-white/8 px-4 py-3">
        <span className={`inline-flex items-center gap-2 text-sm font-medium ${stav.farba}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${stav.bodka}`} aria-hidden />
          {stav.text}
        </span>
        <span className="text-sm text-white/45">{uloha.model_nazov}</span>
        <span className="ml-auto text-xs tabular-nums text-white/35">
          {uloha.stav === 'succeeded' && uloha.uctovane !== null
            ? `${uloha.uctovane} kr.`
            : uloha.stav === 'failed'
              ? '0 kr.'
              : `${uloha.kredity} kr. držaných`}
          {trvanie && ` · ${trvanie}`}
        </span>
      </header>

      {prompt && (
        <p className="border-b border-white/8 px-4 py-2.5 text-sm leading-relaxed text-white/50">
          {prompt.length > 220 ? `${prompt.slice(0, 220)}…` : prompt}
        </p>
      )}

      <div className="p-4">
        {uloha.stav === 'succeeded' && uloha.subory.length > 0 && (
          <div className={uloha.subory.length > 1 ? 'grid grid-cols-2 gap-3' : ''}>
            {uloha.subory.map((s, i) => (
              <figure key={`${s.url}-${i}`} className="overflow-hidden rounded-xl bg-ink-800">
                {s.typ === 'video' ? (
                  <video src={s.url} controls playsInline className="max-h-[70vh] w-full" />
                ) : s.typ === 'zvuk' ? (
                  <audio src={s.url} controls className="w-full p-3" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  // max-h: výstup s extrémnym pomerom strán (alebo drobný
                  // obrázok roztiahnutý na šírku) inak zaberie celú obrazovku
                  <img
                    src={s.url}
                    alt={`Výsledok ${i + 1}`}
                    loading="lazy"
                    className="max-h-[70vh] w-full bg-ink-800 object-contain"
                  />
                )}
                <figcaption className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate text-xs text-white/35">{s.nazov ?? `súbor ${i + 1}`}</span>
                  <a
                    href={s.url}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs text-brand-400 transition hover:text-brand-300"
                  >
                    Stiahnuť
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {(uloha.stav === 'queued' || uloha.stav === 'running' || uloha.stav === 'dispatching') && (
          <div
            className="flex h-28 items-center justify-center rounded-xl border border-dashed
                       border-white/10 bg-ink-800/40 text-sm text-white/35"
          >
            {uloha.stav === 'queued'
              ? 'Čaká na uvoľnenie miesta — nič nerob, pustí sa samo.'
              : 'Pracuje sa na tom…'}
          </div>
        )}

        {uloha.stav === 'failed' && (
          <div className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3">
            <p className="text-sm text-red-200">{uloha.chyba?.sprava ?? 'Generovanie zlyhalo.'}</p>
            <p className="mt-1.5 text-xs text-white/45">
              Kredity sú späť na účte. {uloha.chyba?.kod ? `Kód: ${uloha.chyba.kod}` : ''}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}
