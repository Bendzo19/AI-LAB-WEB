import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CtlFrame, Frame, HubRegisterReq, PAIR_ALPHABET, PAIR_TTL_MS, PairClaimReq, PairStartReq, type Role,
} from '@ns/protocol';
import { Store } from './store.ts';

/**
 * Relay: HTTP párovanie + WebSocket smerovanie šifrovaných rámcov.
 * Obsah správ (e2e) nevie prečítať; číta iba `to` a `from` na doručenie.
 */

const PORT = Number(process.env.PORT ?? 8787);
const store = new Store();

/** živé spojenia podľa deviceId */
interface Conn { ws: WebSocket; role: Role; deviceId: string; phoneId?: string }
const rooms = new Map<string, Set<Conn>>();
const room = (id: string) => rooms.get(id) ?? (rooms.set(id, new Set()), rooms.get(id)!);

function send(ws: WebSocket, frame: unknown) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame)); }
function deliver(deviceId: string, to: Role, frame: unknown, opts: { phoneId?: string } = {}) {
  for (const c of room(deviceId)) {
    if (c.role !== to) continue;
    if (to === 'phone' && opts.phoneId && c.phoneId !== opts.phoneId) continue;
    send(c.ws, frame);
  }
}
function presence(deviceId: string) {
  const roles = new Set([...room(deviceId)].map(c => c.role));
  const body = { laptop: roles.has('laptop'), hub: roles.has('hub'), phones: [...room(deviceId)].filter(c => c.role === 'phone').map(c => c.phoneId) };
  const frame: CtlFrame = { v: 1, t: 'ctl', op: 'presence', body };
  for (const c of room(deviceId)) send(c.ws, frame);
}

/* ---------- HTTP: párovanie ---------- */

async function readJson(req: IncomingMessage, limit = 1 << 16): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const ch of req) { size += (ch as Buffer).length; if (size > limit) throw new Error('too large'); chunks.push(ch as Buffer); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function json(res: ServerResponse, code: number, body: unknown) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }

const http = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });

    if (req.method === 'POST' && req.url === '/v1/pair/start') {
      const b = PairStartReq.parse(await readJson(req));
      const deviceId = b.deviceId ?? crypto.randomUUID();
      const { token } = await store.registerLaptop(deviceId, b.laptopPub, b.name);
      const code = store.makeCode(deviceId, PAIR_TTL_MS, PAIR_ALPHABET);
      return json(res, 200, { deviceId, laptopToken: token, code, expiresAt: Date.now() + PAIR_TTL_MS });
    }

    if (req.method === 'POST' && req.url === '/v1/pair/claim') {
      const b = PairClaimReq.parse(await readJson(req));
      const pc = store.takeCode(b.code);
      if (!pc) return json(res, 404, { error: 'Kód je neplatný alebo vypršal.' });
      const dev = store.getDevice(pc.deviceId)!;
      const { phoneId, token } = await store.addPhone(pc.deviceId, b.phonePub, b.phoneName);
      // upozorni notebook, nech ukáže SAS a potvrdí
      deliver(pc.deviceId, 'laptop', { v: 1, t: 'ctl', op: 'pair.request', body: { phoneId, phonePub: b.phonePub, phoneName: b.phoneName } } satisfies CtlFrame);
      return json(res, 200, { deviceId: pc.deviceId, laptopPub: dev.laptopPubRaw, laptopName: dev.laptopName, phoneId, phoneToken: token });
    }

    if (req.method === 'POST' && req.url === '/v1/hub/register') {
      const auth = bearer(req);
      const b = HubRegisterReq.parse(await readJson(req));
      if (!auth || !(await store.checkToken('laptop', b.deviceId, undefined, auth))) return json(res, 401, { error: 'Neplatný token notebooku.' });
      const { token } = await store.registerHub(b.deviceId);
      return json(res, 200, { hubToken: token });
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 400, { error: (e as Error).message });
  }
});

function bearer(req: IncomingMessage): string | null {
  const h = req.headers['authorization'];
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}

/* ---------- WebSocket: smerovanie ---------- */

const wss = new WebSocketServer({ server: http, path: '/v1/ws', maxPayload: 8 << 20 });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url ?? '', 'http://x');
  const role = url.searchParams.get('role') as Role | null;
  const deviceId = url.searchParams.get('device') ?? '';
  const phoneId = url.searchParams.get('phone') ?? undefined;
  // token z hlavičky alebo zo subprotokolu "bearer.<token>"
  let token = bearer(req);
  const sub = (req.headers['sec-websocket-protocol'] ?? '').split(',').map(s => s.trim());
  const bearerSub = sub.find(s => s.startsWith('bearer.'));
  if (!token && bearerSub) token = bearerSub.slice(7);

  if (!role || !['laptop', 'phone', 'hub'].includes(role) || !deviceId || !token || !(await store.checkToken(role, deviceId, phoneId, token))) {
    send(ws, { v: 1, t: 'ctl', op: 'error', body: { reason: 'unauthorized' } } satisfies CtlFrame);
    return ws.close(4401, 'unauthorized');
  }

  const conn: Conn = { ws, role, deviceId, phoneId };
  room(deviceId).add(conn);
  presence(deviceId);

  ws.on('message', (raw) => {
    let frame;
    try { frame = Frame.parse(JSON.parse(String(raw))); } catch { return; }
    if (frame.t === 'ctl') return onCtl(conn, frame);
    // e2e pustíme len od schváleného telefónu (a k schválenému telefónu)
    if (role === 'phone' && !store.isApproved(deviceId, phoneId)) return;
    const out = { ...frame, from: role, ...(role === 'phone' && phoneId ? { peer: phoneId } : {}) };
    deliver(deviceId, frame.to, out, { phoneId: frame.to === 'phone' ? frame.peer : undefined });
  });
  ws.on('close', () => { room(deviceId).delete(conn); presence(deviceId); });
  ws.on('error', () => { try { ws.close(); } catch { /* ignore */ } });
});

function onCtl(conn: Conn, frame: CtlFrame) {
  const { deviceId, role } = conn;
  switch (frame.op) {
    case 'ping': return send(conn.ws, { v: 1, t: 'ctl', op: 'pong', body: {} } satisfies CtlFrame);
    case 'pair.accepted': {
      if (role !== 'laptop') return;
      const phoneId = String(frame.body.phoneId ?? '');
      if (store.approvePhone(deviceId, phoneId)) { deliver(deviceId, 'phone', frame, { phoneId }); presence(deviceId); }
      return;
    }
    case 'revoked': {
      if (role !== 'laptop') return;
      const phoneId = String(frame.body.phoneId ?? '');
      store.revokePhone(deviceId, phoneId);
      deliver(deviceId, 'phone', frame, { phoneId });
      for (const c of room(deviceId)) if (c.phoneId === phoneId) c.ws.close(4403, 'revoked');
      return;
    }
    case 'wake': {
      // mobil žiada zobudenie → prepošli hubu; hub odpovie wake.result
      if (role === 'phone') return deliver(deviceId, 'hub', frame);
      if (role === 'hub') return deliver(deviceId, 'phone', { ...frame, op: 'wake.result' });
      return;
    }
    default: return;
  }
}

http.listen(PORT, () => console.log(`[relay] počúva na :${PORT}`));

export { store, deliver, room };
