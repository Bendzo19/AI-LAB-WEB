import { z } from 'zod';

/**
 * HTTP rozhranie relay pre párovanie (JSON, POST).
 *
 * 1. Notebook: POST /v1/pair/start  { deviceId?, laptopPub, name }
 *    → { deviceId, laptopToken (len pri prvej registrácii), code, expiresAt }
 *    Notebook ukáže `code` (8 znakov) a čaká na ctl `pair.request`.
 * 2. Mobil:    POST /v1/pair/claim  { code, phonePub, phoneName }
 *    → { deviceId, laptopPub, phoneId, phoneToken, laptopName }
 *    Relay pošle notebooku ctl `pair.request` { phoneId, phonePub, phoneName }.
 * 3. Obe strany vypočítajú SAS z oboch verejných kľúčov a ukážu ho.
 *    Notebook potvrdí (používateľ klikne v okne agenta), pošle ctl
 *    `pair.accepted` { phoneId }. Až potom relay pustí e2e rámce od telefónu.
 * 4. Hub:      POST /v1/hub/register { deviceId, hubName } s tokenom notebooku
 *    → { hubToken }  (notebook odovzdá hubu MAC adresu pri jeho nastavení)
 *
 * WebSocket: GET /v1/ws?role=laptop|phone|hub&device=<deviceId>
 *   hlavička Authorization: Bearer <token>, alebo (prehliadač nevie hlavičky)
 *   subprotokol "ns.v1, bearer.<token>".
 */

export const PairStartReq = z.object({ deviceId: z.string().max(64).optional(), laptopPub: z.string().max(200), name: z.string().min(1).max(64) });
export const PairStartRes = z.object({ deviceId: z.string(), laptopToken: z.string().optional(), code: z.string().length(8), expiresAt: z.number().int() });
export const PairClaimReq = z.object({ code: z.string().length(8), phonePub: z.string().max(200), phoneName: z.string().min(1).max(64) });
export const PairClaimRes = z.object({ deviceId: z.string(), laptopPub: z.string(), laptopName: z.string(), phoneId: z.string(), phoneToken: z.string() });
export const HubRegisterReq = z.object({ deviceId: z.string(), hubName: z.string().min(1).max(64) });
export const HubRegisterRes = z.object({ hubToken: z.string() });

/** Kódy bez zameniteľných znakov (0/O, 1/I/L). */
export const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIR_TTL_MS = 5 * 60_000;

/** AAD pre šifrovanie: viaže správu na smer a zariadenie. */
export const aadFor = (deviceId: string, from: 'laptop' | 'phone', to: 'laptop' | 'phone', phoneId: string) => `${deviceId}|${phoneId}|${from}>${to}`;
