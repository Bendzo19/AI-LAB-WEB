/**
 * lib/generation/verejne.ts
 *
 * Prevod úlohy na tvar, ktorý smie vidieť prehliadač.
 *
 * `callback_token` von nesmie NIKDY — kto ho má, vie poslať „hotovo" na
 * cudziu úlohu. Rovnako von nejde `provider_model`: ako sa model volá
 * u poskytovateľa je naša vec, nie vec klienta.
 */

import type { Uloha } from './jobs';
import { modelPodlaId } from './catalog';

export interface VerejnaUloha {
  id: string;
  stav: Uloha['status'];
  model: string;
  model_nazov: string;
  druh: string;
  kredity: number;
  uctovane: number | null;
  vstup: Record<string, unknown>;
  subory: { url: string; typ: string; nazov?: string }[];
  chyba: { kod: string; sprava: string } | null;
  pokusov: number;
  vytvorene: string;
  odoslane: string | null;
  dokoncene: string | null;
}

export function verejnaUloha(u: Uloha): VerejnaUloha {
  const model = modelPodlaId(u.model_id);
  return {
    id: u.id,
    stav: u.status,
    model: u.model_id,
    model_nazov: model?.nazov ?? u.model_id,
    druh: model?.druh ?? 'foto',
    kredity: u.price_credits,
    uctovane: u.charged_credits,
    vstup: u.input,
    subory: u.result?.subory ?? [],
    chyba: u.error_code ? { kod: u.error_code, sprava: u.error_message ?? '' } : null,
    pokusov: u.attempts,
    vytvorene: u.created_at,
    odoslane: u.dispatched_at,
    dokoncene: u.finished_at,
  };
}
