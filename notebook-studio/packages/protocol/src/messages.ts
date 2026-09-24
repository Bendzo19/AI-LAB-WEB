import { z } from 'zod';

/**
 * Dve vrstvy správ.
 *
 * 1. RÁMEC (Frame) — to, čo vidí relay. Obsahuje smerovanie a buď riadiacu
 *    správu relay (`ctl`), alebo zašifrovaný obsah (`e2e`), ktorý relay nevie
 *    prečítať ani podvrhnúť.
 * 2. SPRÁVA APLIKÁCIE (AppMessage) — obsah e2e rámca po dešifrovaní, výmena
 *    medzi mobilom a notebookom.
 */

export const PROTOCOL_VERSION = 1;
export const Role = z.enum(['laptop', 'phone', 'hub']);
export type Role = z.infer<typeof Role>;

/* ---------- rámec ---------- */

export const E2EFrame = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('e2e'),
  to: Role,
  /** vyplní relay podľa overeného spojenia; odosielateľ ho neposiela */
  from: Role.optional(),
  /** identita konkrétneho telefónu (viac telefónov na jeden notebook) */
  peer: z.string().max(64).optional(),
  n: z.string().max(32), // IV, base64url
  c: z.string().max(8_000_000), // šifrový text, base64url
});
export type E2EFrame = z.infer<typeof E2EFrame>;

export const CtlFrame = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('ctl'),
  op: z.enum(['ping', 'pong', 'presence', 'wake', 'wake.result', 'pair.request', 'pair.accepted', 'error', 'revoked']),
  body: z.record(z.string(), z.unknown()).default({}),
});
export type CtlFrame = z.infer<typeof CtlFrame>;

export const Frame = z.discriminatedUnion('t', [E2EFrame, CtlFrame]);
export type Frame = z.infer<typeof Frame>;

/* ---------- správy aplikácie (vnútri e2e) ---------- */

const base = {
  /** jedinečné ID správy (ochrana proti opakovaniu) */
  id: z.string().min(8).max(64),
  /** čas odoslania v ms; príjemca odmietne správu s odchýlkou nad 5 minút */
  ts: z.number().int(),
};

export const Hello = z.object({ ...base, type: z.literal('hello'), agentVersion: z.string(), os: z.string(), host: z.string(), capabilities: z.array(z.string()), devMode: z.boolean(), lenovo: z.boolean(), admin: z.boolean() });
export const Telemetry = z.object({ ...base, type: z.literal('telemetry'), data: z.record(z.string(), z.unknown()) });

export const Cmd = z.object({ ...base, type: z.literal('cmd'), name: z.string(), args: z.unknown().optional() });
export const CmdConfirmRequired = z.object({ ...base, type: z.literal('cmd.confirm_required'), requestId: z.string(), title: z.string(), text: z.string(), risk: z.enum(['confirm', 'danger']), expiresAt: z.number().int() });
export const CmdConfirm = z.object({ ...base, type: z.literal('cmd.confirm'), requestId: z.string(), approved: z.boolean() });
export const CmdProgress = z.object({ ...base, type: z.literal('cmd.progress'), requestId: z.string(), percent: z.number().min(0).max(100).optional(), text: z.string().optional() });
export const CmdResult = z.object({ ...base, type: z.literal('cmd.result'), requestId: z.string(), ok: z.boolean(), data: z.unknown().optional(), error: z.object({ code: z.string(), message: z.string() }).optional() });

export const ChatUser = z.object({ ...base, type: z.literal('chat.user'), convId: z.string(), text: z.string().min(1).max(8000) });
export const ChatDelta = z.object({ ...base, type: z.literal('chat.delta'), convId: z.string(), text: z.string() });
export const ChatTool = z.object({ ...base, type: z.literal('chat.tool'), convId: z.string(), callId: z.string(), command: z.string(), label: z.string(), status: z.enum(['running', 'done', 'failed', 'denied']) });
export const ChatDone = z.object({ ...base, type: z.literal('chat.done'), convId: z.string(), text: z.string(), error: z.string().optional() });
export const ChatCancel = z.object({ ...base, type: z.literal('chat.cancel'), convId: z.string() });

export const ScreenStart = z.object({ ...base, type: z.literal('screen.start'), fps: z.number().min(0.2).max(15).default(4), quality: z.number().min(20).max(95).default(60), maxWidth: z.number().int().min(320).max(3840).default(1280), display: z.number().int().min(0).default(0) });
export const ScreenStop = z.object({ ...base, type: z.literal('screen.stop') });
export const ScreenFrame = z.object({ ...base, type: z.literal('screen.frame'), seq: z.number().int(), w: z.number().int(), h: z.number().int(), jpeg: z.string() });

export const InputPointer = z.object({ ...base, type: z.literal('input.pointer'), x: z.number().min(0).max(1), y: z.number().min(0).max(1), action: z.enum(['move', 'down', 'up', 'click', 'dblclick', 'scroll']), button: z.enum(['left', 'right', 'middle']).default('left'), dy: z.number().optional() });
export const InputKey = z.object({ ...base, type: z.literal('input.key'), key: z.string().max(32), mods: z.array(z.enum(['ctrl', 'alt', 'shift', 'win'])).default([]) });
export const InputText = z.object({ ...base, type: z.literal('input.text'), text: z.string().max(2000) });

export const AppMessage = z.discriminatedUnion('type', [
  Hello, Telemetry, Cmd, CmdConfirmRequired, CmdConfirm, CmdProgress, CmdResult,
  ChatUser, ChatDelta, ChatTool, ChatDone, ChatCancel,
  ScreenStart, ScreenStop, ScreenFrame, InputPointer, InputKey, InputText,
]);
export type AppMessage = z.infer<typeof AppMessage>;
export type AppMessageOf<T extends AppMessage['type']> = Extract<AppMessage, { type: T }>;

/** Ochrana proti opakovaniu a starým správam. */
export class ReplayGuard {
  private seen = new Map<string, number>();
  constructor(private maxAgeMs = 300_000, private maxEntries = 5000) {}
  accept(id: string, ts: number, now = Date.now()): boolean {
    if (Math.abs(now - ts) > this.maxAgeMs) return false;
    if (this.seen.has(id)) return false;
    this.seen.set(id, ts);
    if (this.seen.size > this.maxEntries) {
      for (const [k, t] of this.seen) { if (now - t > this.maxAgeMs || this.seen.size > this.maxEntries) this.seen.delete(k); else break; }
    }
    return true;
  }
}

/** Overí dešifrovanú správu podľa schémy. Neplatnú vráti ako null (nič nevyhadzuje). */
export function parseAppMessage(x: unknown): AppMessage | null {
  const r = AppMessage.safeParse(x);
  return r.success ? r.data : null;
}

export function newId(): string {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/** Pomocník na vytvorenie správy s id a časom. */
export function msg<T extends AppMessage['type']>(type: T, fields: Omit<AppMessageOf<T>, 'id' | 'ts' | 'type'>): AppMessageOf<T> {
  return { id: newId(), ts: Date.now(), type, ...fields } as AppMessageOf<T>;
}
