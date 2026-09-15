/**
 * POST /api/generate   — založí a odošle generovanie
 * GET  /api/generate   — posledné úlohy prihláseného užívateľa
 *
 * Toto je celá „horúca cesta" a zámerne v nej NIE JE nič, čo by čakalo na
 * výsledok generovania:
 *
 *   overenie vstupu -> rezervácia kreditov -> createTask u poskytovateľa
 *   -> odpoveď s id úlohy
 *
 * Volanie u poskytovateľa trvá stovky milisekúnd (len prijatie zadania),
 * takže request sa vráti hneď a klient si stav dotiahne cez
 * GET /api/generate/<id>. Sto ľudí naraz = sto takýchto requestov vedľa
 * seba; nič sa nikde nezaraďuje do radu.
 */

import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { modelPodlaId } from '@/lib/generation/catalog';
import { skontrolujVstup } from '@/lib/generation/validate';
import { odosliUlohu, ulohaPodlaId, ulohyUzivatela, vytvorUlohu } from '@/lib/generation/jobs';
import { verejnaUloha } from '@/lib/generation/verejne';
import { stavUctu } from '@/lib/generation/credits';
import { kamSModelom, poskytovatel } from '@/lib/generation/providers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'neprihlaseny' }, { status: 401 });

  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 30);
  const ulohy = await ulohyUzivatela(userId, Number.isFinite(limit) ? limit : 30);
  return NextResponse.json({ ulohy: ulohy.map(verejnaUloha) });
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'neprihlaseny' }, { status: 401 });

  let telo: unknown;
  try {
    telo = await req.json();
  } catch {
    return NextResponse.json({ error: 'zle_telo', sprava: 'Očakávam JSON.' }, { status: 400 });
  }

  const { model: modelId, polia, idempotency_key } = (telo ?? {}) as {
    model?: string;
    polia?: unknown;
    idempotency_key?: string;
  };

  if (!modelId || typeof modelId !== 'string') {
    return NextResponse.json({ error: 'chyba_model', sprava: 'Chýba pole "model".' }, { status: 400 });
  }

  const model = modelPodlaId(modelId);
  if (!model) {
    return NextResponse.json({ error: 'neznamy_model', sprava: `Model "${modelId}" neexistuje.` }, { status: 404 });
  }

  const kontrola = skontrolujVstup(model, polia ?? {});
  if (!kontrola.ok) {
    return NextResponse.json({ error: 'zly_vstup', chyby: kontrola.chyby }, { status: 422 });
  }

  const vysledok = await vytvorUlohu({
    userId,
    modelId: model.id,
    vstup: kontrola.vstup,
    idempotencyKey: typeof idempotency_key === 'string' ? idempotency_key.slice(0, 120) : null,
  });

  if (!vysledok.ok) {
    const stav =
      vysledok.kod === 'nedostatok_kreditov' ? 402 :
      vysledok.kod === 'prilis_vela_poziadaviek' ? 429 :
      vysledok.kod === 'model_nedostupny' ? 503 : 400;

    return NextResponse.json(
      {
        error: vysledok.kod,
        sprava: vysledok.sprava,
        ...(vysledok.kod === 'nedostatok_kreditov'
          ? { zostatok: vysledok.zostatok, treba: vysledok.treba }
          : {}),
      },
      { status: stav },
    );
  }

  /* Odoslanie.
   *
   * Asynchrónny poskytovateľ (kie): počkáme — je to jedno krátke volanie
   * a užívateľ tak hneď vidí, či zadanie prešlo.
   *
   * Priamy poskytovateľ (Google, OpenAI): samotné generovanie trvá desiatky
   * sekúnd, takže ho pustíme až PO odoslaní odpovede. Keby beh na pozadí
   * neprešiel (serverless ho môže ukončiť), úlohu doženie cron — preto je
   * v oboch prípadoch bezpečné vrátiť sa hneď. */
  if (!vysledok.opakovane) {
    const smer = kamSModelom(model);
    const p = poskytovatel(smer.poskytovatel);

    if (p?.rezim === 'inline') {
      after(async () => {
        try {
          await odosliUlohu(vysledok.uloha.id);
        } catch (err) {
          console.error('[generate] odoslanie na pozadí zlyhalo:', err);
        }
      });
    } else {
      try {
        await odosliUlohu(vysledok.uloha.id);
      } catch (err) {
        // Úloha ostáva vo fronte a pustí ju cron — kredity sú rezervované,
        // takže sa nič nestratí. Do odpovede ide aktuálny stav.
        console.error('[generate] odoslanie zlyhalo, ostáva vo fronte:', err);
      }
    }
  }

  const aktualna = (await ulohaPodlaId(vysledok.uloha.id)) ?? vysledok.uloha;
  const ucet = await stavUctu(userId);

  return NextResponse.json(
    {
      uloha: verejnaUloha(aktualna),
      cena: vysledok.cena,
      zostatok: ucet.balance,
      drzane: ucet.reserved,
      opakovane: vysledok.opakovane,
    },
    { status: vysledok.opakovane ? 200 : 202 },
  );
}
