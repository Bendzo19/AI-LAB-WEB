/**
 * scripts/verify-models.ts
 *
 *   npm run verify:models          # kontrola katalógu, nič sa nikam neposiela
 *   npm run verify:models -- --live  # overí názvy modelov priamo u kie.ai
 *
 * Načo to je:
 *
 * Katalóg si pri každom modeli drží `provider_model` — meno, pod ktorým ho
 * pozná poskytovateľ. Keď sa netrafí, generovanie zlyhá až u zákazníka.
 * Modely označené `"overit": true` sú tie, ktorých meno ešte nikto
 * neporovnal s dokumentáciou (docs.kie.ai/market).
 *
 * Živá kontrola posiela `createTask` s PRÁZDNYM vstupom, a to výhradne pri
 * modeloch, ktoré majú povinné polia — taká požiadavka musí skončiť chybou
 * o vstupe, takže sa nič nevygeneruje a nič sa nezaplatí. Rozlišujeme:
 *
 *   chyba o vstupe (400/422)  -> meno modelu je správne
 *   chyba o modeli (404)      -> meno modelu je zlé
 */

import { MODELY } from '../lib/generation/catalog';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

const ziva = process.argv.includes('--live');

interface KieOdpoved {
  code?: number;
  msg?: string;
}

async function skus(providerModel: string, kluc: string): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
    method: 'POST',
    headers: { Authorization: `Bearer ${kluc}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: providerModel, input: {} }),
  });

  const telo = (await res.json().catch(() => ({}))) as KieOdpoved;
  const code = telo.code ?? res.status;
  const sprava = telo.msg ?? `HTTP ${res.status}`;

  if (code === 200) {
    // Nemalo by nastať: prázdny vstup pri modeli s povinnými poľami.
    return { ok: true, detail: `POZOR: úloha sa naozaj založila (${sprava}) — skontroluj ju v kie.ai` };
  }
  if (code === 404 || /model.*(not found|neexistuje|invalid)/i.test(sprava)) {
    return { ok: false, detail: `model neznámy: ${sprava}` };
  }
  if (code === 401 || code === 403) {
    return { ok: false, detail: `kľúč odmietnutý: ${sprava}` };
  }
  return { ok: true, detail: `${sprava} (chyba o vstupe = meno modelu sedí)` };
}

async function main(): Promise<void> {
  console.log(`\n${B}Kontrola katalógu modelov${X}`);
  console.log(`  ${D}${MODELY.length} modelov, z toho ${MODELY.filter((m) => m.overit).length} neoverených${X}\n`);

  const podlaPoskytovatela = new Map<string, number>();
  for (const m of MODELY) {
    podlaPoskytovatela.set(m.poskytovatel, (podlaPoskytovatela.get(m.poskytovatel) ?? 0) + 1);
  }
  for (const [p, n] of podlaPoskytovatela) console.log(`  ${D}${p}: ${n} modelov${X}`);

  const neovereny = MODELY.filter((m) => m.overit);
  if (neovereny.length > 0) {
    console.log(`\n${Y}Neoverené názvy u poskytovateľa${X} — porovnaj s docs.kie.ai/market:`);
    for (const m of neovereny) {
      console.log(`  ${Y}?${X} ${m.id.padEnd(22)} -> ${m.provider_model}`);
    }
    console.log(
      `\n  ${D}Keď názov sedí, prepni v lib/generation/models.json "overit": false.${X}` +
        `\n  ${D}Keď nesedí, oprav "provider_model" — inak model spadne až zákazníkovi.${X}`,
    );
  }

  if (!ziva) {
    console.log(`\n${D}Živá kontrola: npm run verify:models -- --live${X}\n`);
    return;
  }

  const kluc = process.env.KIE_API_KEY?.trim();
  if (!kluc) {
    console.log(`\n${R}KIE_API_KEY nie je nastavený — živá kontrola sa nedá spustiť.${X}\n`);
    process.exit(1);
  }

  console.log(`\n${B}Živá kontrola u kie.ai${X}`);
  console.log(`  ${D}posielam createTask s prázdnym vstupom — nič sa nevygeneruje${X}\n`);

  let zle = 0;
  for (const m of MODELY.filter((x) => x.poskytovatel === 'kie')) {
    if (m.povinne.length === 0) {
      console.log(`  ${Y}—${X} ${m.id.padEnd(22)} preskakujem (model nemá povinné polia, hrozilo by spustenie)`);
      continue;
    }
    try {
      const v = await skus(m.provider_model, kluc);
      console.log(`  ${v.ok ? `${G}✓${X}` : `${R}✗${X}`} ${m.id.padEnd(22)} ${D}${v.detail}${X}`);
      if (!v.ok) zle += 1;
    } catch (err) {
      console.log(`  ${R}✗${X} ${m.id.padEnd(22)} ${D}${err instanceof Error ? err.message : String(err)}${X}`);
      zle += 1;
    }
  }

  console.log(zle === 0 ? `\n${G}Všetky názvy sedia.${X}\n` : `\n${R}${zle} modelov má zlý názov.${X}\n`);
  process.exit(zle === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
