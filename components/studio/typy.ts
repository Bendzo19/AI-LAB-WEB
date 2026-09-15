/**
 * components/studio/typy.ts
 *
 * Tvar dát, ktoré chodia z `/api/models` a `/api/generate`. Presne
 * zodpovedá `verejnyKatalog()` a `verejnaUloha()` na serveri.
 */

import type { Pole } from '@/lib/generation/catalog';
import type { CenovyPopis } from '@/lib/generation/cena';

export interface ModelPreWeb extends CenovyPopis {
  id: string;
  druh: 'foto' | 'video' | 'zvuk' | 'upscale';
  rodina: string;
  nazov: string;
  popis: string;
  nsfw: boolean;
  moderacia: string;
  moderacia_veta: string;
  stitky: string[];
  povinne: string[];
  polia: Pole[];
}

export interface Katalog {
  kredit_usd: number;
  prirazka_pct: number;
  nahravanie: boolean;
  modely: ModelPreWeb[];
}

export interface UlohaPreWeb {
  id: string;
  stav: 'queued' | 'dispatching' | 'running' | 'succeeded' | 'failed' | 'canceled';
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

export interface StavKreditov {
  zostatok: number;
  drzane: number;
}

export const BEZI: UlohaPreWeb['stav'][] = ['queued', 'dispatching', 'running'];

export function jeVBehu(u: UlohaPreWeb): boolean {
  return BEZI.includes(u.stav);
}
