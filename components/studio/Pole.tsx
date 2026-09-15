'use client';

/**
 * components/studio/Pole.tsx
 *
 * Jedno pole formulára, nakreslené podľa popisu z katalógu.
 *
 * Toto je dôvod, prečo pridanie modelu nevyžaduje nové UI: server pošle
 * `polia` a tu sa z nich stane formulár. Keď pribudne model s posuvníkom
 * na dĺžku, posuvník sa objaví sám.
 */

import { useId, useRef, useState } from 'react';
import type { Pole as PoleSpec } from '@/lib/generation/catalog';

interface Props {
  pole: PoleSpec;
  hodnota: unknown;
  chyba?: string;
  nahravanieDostupne: boolean;
  onZmena: (hodnota: unknown) => void;
}

const vstupTriedy =
  'w-full rounded-xl border border-white/12 bg-ink-800 px-3.5 py-2.5 text-sm text-white ' +
  'placeholder:text-white/30 transition focus:border-brand-500 focus:outline-none ' +
  'focus:ring-2 focus:ring-brand-500/40 disabled:opacity-50';

export function Pole({ pole, hodnota, chyba, nahravanieDostupne, onZmena }: Props) {
  const id = useId();
  const popisId = `${id}-popis`;
  const chybaId = `${id}-chyba`;

  const popisany = [pole.napoveda ? popisId : null, chyba ? chybaId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-white/85">
          {pole.nadpis}
          {(pole.povinne) && <span className="ml-1 text-brand-400" aria-hidden>*</span>}
          {pole.povinne && <span className="sr-only"> (povinné)</span>}
        </label>
        {pole.cena && (
          <span className="shrink-0 text-[11px] text-brand-400/90">mení cenu</span>
        )}
      </div>

      <Vnutro
        id={id}
        pole={pole}
        hodnota={hodnota}
        onZmena={onZmena}
        popisany={popisany}
        chybne={Boolean(chyba)}
        nahravanieDostupne={nahravanieDostupne}
      />

      {pole.napoveda && (
        <p id={popisId} className="mt-1.5 text-xs leading-relaxed text-white/40">
          {pole.napoveda}
        </p>
      )}
      {chyba && (
        <p id={chybaId} className="mt-1.5 text-xs text-red-300">
          {chyba}
        </p>
      )}
    </div>
  );
}

function Vnutro({
  id, pole, hodnota, onZmena, popisany, chybne, nahravanieDostupne,
}: {
  id: string;
  pole: PoleSpec;
  hodnota: unknown;
  onZmena: (h: unknown) => void;
  popisany?: string;
  chybne: boolean;
  nahravanieDostupne: boolean;
}) {
  const okraj = chybne ? ' border-red-400/60' : '';

  switch (pole.druh) {
    case 'plocha':
      return (
        <>
          <textarea
            id={id}
            rows={pole.riadky ?? 3}
            value={String(hodnota ?? '')}
            maxLength={pole.max_znakov}
            aria-describedby={popisany}
            aria-invalid={chybne || undefined}
            onChange={(e) => onZmena(e.target.value)}
            className={vstupTriedy + okraj + ' resize-y leading-relaxed'}
          />
          {pole.max_znakov && pole.max_znakov <= 20000 && (
            <p className="mt-1 text-right text-[11px] tabular-nums text-white/30">
              {String(hodnota ?? '').length} / {pole.max_znakov}
            </p>
          )}
        </>
      );

    case 'vyber':
      return (
        <select
          id={id}
          value={String(hodnota ?? pole.predvolene ?? '')}
          aria-describedby={popisany}
          aria-invalid={chybne || undefined}
          onChange={(e) => onZmena(e.target.value)}
          className={vstupTriedy + okraj}
        >
          {!pole.povinne && pole.predvolene === undefined && <option value="">—</option>}
          {pole.moznosti?.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      );

    case 'posuvnik': {
      const c = Number(hodnota ?? pole.predvolene ?? pole.min ?? 0);
      return (
        <div className="flex items-center gap-4">
          <input
            id={id}
            type="range"
            min={pole.min}
            max={pole.max}
            step={pole.krok ?? 1}
            value={c}
            aria-describedby={popisany}
            onChange={(e) => onZmena(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-ink-600
                       accent-brand-500"
          />
          <output
            htmlFor={id}
            className="w-16 shrink-0 rounded-lg bg-ink-800 px-2 py-1 text-center text-sm
                       tabular-nums text-white"
          >
            {c}
            {pole.jednotka ? ` ${pole.jednotka}` : ''}
          </output>
        </div>
      );
    }

    case 'prepinac':
      return (
        <label className="inline-flex cursor-pointer items-center gap-2.5">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(hodnota ?? pole.predvolene ?? false)}
            aria-describedby={popisany}
            onChange={(e) => onZmena(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-ink-800 accent-brand-500"
          />
          <span className="text-sm text-white/70">
            {Boolean(hodnota ?? pole.predvolene) ? 'áno' : 'nie'}
          </span>
        </label>
      );

    case 'seed':
      return (
        <input
          id={id}
          type="number"
          min={0}
          max={pole.max}
          value={hodnota === undefined || hodnota === null ? '' : String(hodnota)}
          placeholder="náhodný"
          aria-describedby={popisany}
          aria-invalid={chybne || undefined}
          onChange={(e) => onZmena(e.target.value === '' ? undefined : Number(e.target.value))}
          className={vstupTriedy + okraj}
        />
      );

    case 'subor':
      return (
        <PoleSuboru
          id={id}
          pole={pole}
          hodnota={hodnota}
          onZmena={onZmena}
          popisany={popisany}
          chybne={chybne}
          nahravanieDostupne={nahravanieDostupne}
        />
      );

    default:
      return (
        <input
          id={id}
          type="text"
          value={String(hodnota ?? '')}
          maxLength={pole.max_znakov}
          aria-describedby={popisany}
          aria-invalid={chybne || undefined}
          onChange={(e) => onZmena(e.target.value)}
          className={vstupTriedy + okraj}
        />
      );
  }
}

/**
 * Súbor sa dá buď nahrať (keď je nastavené úložisko), alebo vložiť
 * adresou. Adresa funguje vždy — poskytovateľ si súbor sťahuje sám,
 * takže musí byť verejná.
 */
function PoleSuboru({
  id, pole, hodnota, onZmena, popisany, chybne, nahravanieDostupne,
}: {
  id: string;
  pole: PoleSpec;
  hodnota: unknown;
  onZmena: (h: unknown) => void;
  popisany?: string;
  chybne: boolean;
  nahravanieDostupne: boolean;
}) {
  const adresy: string[] = Array.isArray(hodnota)
    ? (hodnota as string[])
    : hodnota
      ? [String(hodnota)]
      : [];

  const [nahravam, setNahravam] = useState(false);
  const [chybaNahrania, setChybaNahrania] = useState<string | null>(null);
  const vstupSuboru = useRef<HTMLInputElement>(null);

  const zapis = (nove: string[]) => {
    onZmena(pole.viac ? nove : (nove[0] ?? undefined));
  };

  const prijmi = (typy: string) =>
    typy === 'obrazok' ? 'image/*' : typy === 'video' ? 'video/*' : typy === 'zvuk' ? 'audio/*' : '*/*';

  async function nahraj(subory: FileList | null) {
    if (!subory?.length) return;
    setChybaNahrania(null);
    setNahravam(true);
    try {
      const nove: string[] = [];
      for (const s of Array.from(subory)) {
        const fd = new FormData();
        fd.append('file', s);
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = (await res.json()) as { url?: string; sprava?: string };
        if (!res.ok || !data.url) throw new Error(data.sprava ?? `Nahranie zlyhalo (${res.status}).`);
        nove.push(data.url);
      }
      zapis(pole.viac ? [...adresy, ...nove] : nove);
    } catch (err) {
      setChybaNahrania(err instanceof Error ? err.message : String(err));
    } finally {
      setNahravam(false);
      if (vstupSuboru.current) vstupSuboru.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      {adresy.length > 0 && (
        <ul className="space-y-1.5">
          {adresy.map((a, i) => (
            <li
              key={`${a}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-800/60 px-3 py-2"
            >
              {pole.co === 'obrazok' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
              ) : (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-ink-700 text-xs text-white/50">
                  {pole.co === 'video' ? '▶' : '♪'}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-white/50">{a}</span>
              <button
                type="button"
                onClick={() => zapis(adresy.filter((_, j) => j !== i))}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-white/50 transition
                           hover:bg-white/5 hover:text-white"
              >
                Odobrať
              </button>
            </li>
          ))}
        </ul>
      )}

      {(pole.viac || adresy.length === 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {nahravanieDostupne && (
            <>
              <input
                ref={vstupSuboru}
                id={id}
                type="file"
                accept={prijmi(pole.co ?? '')}
                multiple={pole.viac}
                className="sr-only"
                onChange={(e) => void nahraj(e.target.files)}
              />
              <label
                htmlFor={id}
                className="cursor-pointer rounded-lg border border-white/12 px-3 py-2 text-sm
                           text-white/80 transition hover:bg-white/5"
              >
                {nahravam ? 'Nahrávam…' : 'Nahrať súbor'}
              </label>
              <span className="text-xs text-white/30">alebo</span>
            </>
          )}
          <input
            id={nahravanieDostupne ? undefined : id}
            type="url"
            placeholder="https://adresa-suboru"
            aria-describedby={popisany}
            aria-invalid={chybne || undefined}
            aria-label={nahravanieDostupne ? `${pole.nadpis} — adresa súboru` : undefined}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const v = (e.target as HTMLInputElement).value.trim();
              if (!v) return;
              zapis(pole.viac ? [...adresy, v] : [v]);
              (e.target as HTMLInputElement).value = '';
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (!v) return;
              zapis(pole.viac ? [...adresy, v] : [v]);
              e.target.value = '';
            }}
            className={vstupTriedy + (chybne ? ' border-red-400/60' : '') + ' flex-1 min-w-[12rem]'}
          />
        </div>
      )}

      {chybaNahrania && <p className="text-xs text-red-300">{chybaNahrania}</p>}
    </div>
  );
}
