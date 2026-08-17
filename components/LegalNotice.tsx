/**
 * components/LegalNotice.tsx
 *
 * Viditeľné upozornenie, že dokument je zatiaľ návrh. ZMAZ tento komponent
 * z /terms a /privacy až potom, ako texty prejde právnik a doplníš LEGAL
 * v lib/site.ts. Do vtedy tam nech zostane — je lepšie priznať návrh, než
 * tvrdiť užívateľom, že im ručíš za niečo, čo nikto neskontroloval.
 */

export function LegalNotice() {
  return (
    <div
      role="note"
      className="mb-10 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-5"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
        Návrh — pred spustením nechaj skontrolovať
      </p>
      <p className="mt-2 text-sm leading-relaxed text-white/60">
        Tento dokument je pripravený návrh, nie právne poradenstvo. Predávaš
        digitálne predplatné spotrebiteľom v EÚ, takže sa naň vzťahuje GDPR aj
        slovenský zákon o ochrane spotrebiteľa pri predaji na diaľku. Pred
        spustením ho nechaj prejsť právnikovi a doplň identifikačné údaje
        v <code className="font-mono text-[0.85em] text-white/75">lib/site.ts</code>.
      </p>
    </div>
  );
}
