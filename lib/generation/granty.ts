/**
 * lib/generation/granty.ts
 *
 * Mesačné kredity pre predplatiteľov.
 *
 * Naviazané na `v_active_subscribers` — ten istý pohľad, ktorý rozhoduje
 * o Discord role. Jedna pravda o tom, kto platí, nie dve.
 *
 * Idempotencia je v `ref` = `YYYY-MM`: cron môže bežať každú hodinu a
 * pridelí kredity najviac raz za mesiac na človeka.
 */

import { pool } from '@/lib/db';
import { GEN } from './config';
import { pripis } from './credits';

export async function pridelMesacneKredity(
  kredity = GEN.monthlySubscriberGrant,
): Promise<{ pridelene: number; preskocene: number }> {
  if (kredity <= 0) return { pridelene: 0, preskocene: 0 };

  const obdobie = new Date().toISOString().slice(0, 7); // 2026-09

  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM v_active_subscribers`,
  );

  let pridelene = 0;
  let preskocene = 0;

  for (const r of rows) {
    const v = await pripis(
      String(r.user_id),
      kredity,
      `subscription:${obdobie}`,
      'grant',
      `mesačné kredity predplatného (${obdobie})`,
    );
    if (v.pripisane) pridelene += 1;
    else preskocene += 1;
  }

  return { pridelene, preskocene };
}
