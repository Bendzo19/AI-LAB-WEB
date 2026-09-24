import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  type CtlFrame, Frame, HubRegisterReq, PAIR_ALPHABET, PAIR_TTL_MS, PairClaimReq, PairStartReq, type Role,
} from '@ns/protocol';
import { Store } from './store.ts';

/**
 * Relay: HTTP párovanie + WebSocket smerovanie šifrovaných rámcov.
 * Obsah správ (e2e) nevie prečítať; číta iba adresáta na doručenie.
 *
 * Premenné prostredia:
 *   PORT                 port (predvolene 8787)
 *   NS_DATA_FILE         súbor so zariadeniami (bez neho sa po reštarte zabudnú)
 *   NS_ALLOWED_ORIGINS   povolené originy mobilnej PWA, oddelené čiarkou (predvolene *)
 *   NS_TRUST_PROXY=1     brať IP klienta z X-Forwarded-For (len za vlastnou proxy)
 */

export interface RelayOptions {
  port?: number;
  dataFile?: string | null;
  allowedOrigins?: string[];
  trustProxy?: boolean;
  heartbeatMs?: number;
  log?: (...a: unknown[]) => void;
}

interface Conn { ws: WebSocket; role: Role; deviceId: string; phoneId?: string; ip: string; alive: boolean; bucket: Bucket }

/** Jednoduchý token bucket na obmedzenie rýchlosti. */
class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(private rate: number, private burst: number) { this.tokens = burst; }
  take(n = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

const MAX_CONNS_PER_DEVICE = 24;
const MAX_CONNS_PER_IP = 40;

export function createRelay(opts: RelayOptions = {}) {
  const log = opts.log ?? ((...a: unknown[]) => console.log('[relay]', ...a));
  const store = new Store(opts.dataFile ?? null);
  const allowed = opts.allowedOrigins ?? ['*'];
  const rooms = new Map<string, Set<Conn>>();
  const room = (id: string) => rooms.get(id) ?? (rooms.set(id, new Set()), rooms.get(id)!);
  const ipBuckets = new Map<string, Bucket>();
  const ipConns = new Map<string, number>();
  const lastWake = new Map<string, number>();

  const clientIp = (req: IncomingMessage) => {
    if (opts.trustProxy) { const f = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim(); if (f) return f; }
    return req.socket.remoteAddress ?? '?';
  };
  const limitIp = (ip: string, cost = 1) => {
    let b = ipBuckets.get(ip);
    if (!b) { b = new Bucket(0.5, 20); ipBuckets.set(ip, b); } // 30 za minútu, nárazovo 20
    return b.take(cost);
  };
  // staré záznamy limitov sa pravidelne čistia
  const gc = setInterval(() => { if (ipBuckets.size > 5000) ipBuckets.clear(); }, 60_000);
  gc.unref();

  function send(ws: WebSocket, frame: unknown) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame)); }
  function deliver(deviceId: string, to: Role, frame: unknown, o: { phoneId?: string; onlyApproved?: boolean } = {}) {
    for (const c of room(deviceId)) {
      if (c.role !== to) continue;
      if (to === 'phone') {
        if (o.phoneId && c.phoneId !== o.phoneId) continue;
        if (o.onlyApproved && !store.isApproved(deviceId, c.phoneId)) continue;
      }
      send(c.ws, frame);
    }
  }
  function presence(deviceId: string) {
    const conns = [...room(deviceId)];
    const body = {
      laptop: conns.some(c => c.role === 'laptop'),
      hub: conns.some(c => c.role === 'hub'),
      phones: [...new Set(conns.filter(c => c.role === 'phone' && store.isApproved(deviceId, c.phoneId)).map(c => c.phoneId))],
    };
    const frame: CtlFrame = { v: 1, t: 'ctl', op: 'presence', body };
    for (const c of conns) if (c.role !== 'phone' || store.isApproved(deviceId, c.phoneId)) send(c.ws, frame);
  }

  /* ---------- HTTP ---------- */

  async function readJson(req: IncomingMessage, limit = 1 << 14): Promise<unknown> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const ch of req) { size += (ch as Buffer).length; if (size > limit) throw new HttpError(413, 'Požiadavka je príliš veľká.'); chunks.push(ch as Buffer); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Neplatný JSON.'); }
  }
  function headers(req: IncomingMessage, res: ServerResponse) {
    const origin = String(req.headers.origin ?? '');
    if (allowed.includes('*')) res.setHeader('access-control-allow-origin', '*');
    else if (origin && allowed.includes(origin)) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'origin'); }
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-max-age', '600');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');
  }
  function json(res: ServerResponse, code: number, body: unknown) { res.statusCode = code; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); }
  const bearer = (req: IncomingMessage) => { const h = req.headers['authorization']; return h && h.startsWith('Bearer ') ? h.slice(7) : null; };

  const http: Server = createServer(async (req, res) => {
    headers(req, res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    const ip = clientIp(req);
    const path = (req.url ?? '').split('?')[0];
    try {
      if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });
      if (!limitIp(ip, path === '/v1/pair/claim' ? 3 : 1)) throw new HttpError(429, 'Príliš veľa pokusov. Skús to o chvíľu.');

      if (req.method === 'POST' && path === '/v1/pair/start') {
        const b = PairStartReq.parse(await readJson(req));
        let deviceId: string; let laptopToken: string | undefined;
        if (b.deviceId) {
          // existujúci notebook musí dokázať, že je to on (inak by ktokoľvek s deviceId vyrobil kód)
          const tok = bearer(req);
          if (!tok || !store.getDevice(b.deviceId) || !(await store.checkToken('laptop', b.deviceId, undefined, tok))) throw new HttpError(401, 'Neplatný token notebooku.');
          deviceId = b.deviceId;
          store.updateDeviceName(deviceId, b.name);
        } else {
          const created = await store.createDevice(b.laptopPub, b.name);
          deviceId = created.deviceId; laptopToken = created.token;
        }
        const code = store.makeCode(deviceId, PAIR_TTL_MS, PAIR_ALPHABET);
        return json(res, 200, { deviceId, laptopToken, code, expiresAt: Date.now() + PAIR_TTL_MS });
      }

      if (req.method === 'POST' && path === '/v1/pair/claim') {
        const b = PairClaimReq.parse(await readJson(req));
        const pc = store.takeCode(b.code.toUpperCase());
        if (!pc) throw new HttpError(404, 'Kód je neplatný alebo vypršal.');
        const dev = store.getDevice(pc.deviceId);
        if (!dev) throw new HttpError(404, 'Zariadenie neexistuje.');
        const added = await store.addPhone(pc.deviceId, b.phonePub, b.phoneName);
        if (!added) throw new HttpError(429, 'Na notebook je spárovaných priveľa telefónov. Najprv niektorý odober.');
        deliver(pc.deviceId, 'laptop', { v: 1, t: 'ctl', op: 'pair.request', body: { phoneId: added.phoneId, phonePub: b.phonePub, phoneName: b.phoneName } } satisfies CtlFrame);
        return json(res, 200, { deviceId: pc.deviceId, laptopPub: dev.laptopPubRaw, laptopName: dev.laptopName, phoneId: added.phoneId, phoneToken: added.token });
      }

      if (req.method === 'POST' && path === '/v1/hub/register') {
        const b = HubRegisterReq.parse(await readJson(req));
        const tok = bearer(req);
        if (!tok || !(await store.checkToken('laptop', b.deviceId, undefined, tok))) throw new HttpError(401, 'Neplatný token notebooku.');
        const r = await store.registerHub(b.deviceId);
        if (!r) throw new HttpError(404, 'Zariadenie neexistuje.');
        return json(res, 200, { hubToken: r.token });
      }

      throw new HttpError(404, 'Nenájdené.');
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      if ((e as { name?: string }).name === 'ZodError') return json(res, 400, { error: 'Neplatné údaje.' });
      log('chyba HTTP', (e as Error).message);
      return json(res, 500, { error: 'Chyba servera.' });
    }
  });
  http.requestTimeout = 15_000;
  http.headersTimeout = 10_000;

  /* ---------- WebSocket ---------- */

  const wss = new WebSocketServer({ server: http, path: '/v1/ws', maxPayload: 8 << 20, perMessageDeflate: false });

  wss.on('connection', async (ws, req) => {
    const ip = clientIp(req);
    const url = new URL(req.url ?? '', 'http://x');
    const role = url.searchParams.get('role') as Role | null;
    const deviceId = url.searchParams.get('device') ?? '';
    const phoneId = url.searchParams.get('phone') ?? undefined;
    let token = bearer(req);
    const sub = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(s => s.trim());
    const bearerSub = sub.find(s => s.startsWith('bearer.'));
    if (!token && bearerSub) token = bearerSub.slice(7);

    const reject = (code: number, reason: string) => { send(ws, { v: 1, t: 'ctl', op: 'error', body: { reason } } satisfies CtlFrame); ws.close(code, reason); };
    if ((ipConns.get(ip) ?? 0) >= MAX_CONNS_PER_IP || !limitIp(ip)) return reject(4429, 'rate_limited');
    if (!role || !['laptop', 'phone', 'hub'].includes(role) || !deviceId || !token || !(await store.checkToken(role, deviceId, phoneId, token))) return reject(4401, 'unauthorized');
    if (room(deviceId).size >= MAX_CONNS_PER_DEVICE) return reject(4429, 'too_many_connections');

    // priepustnosť: obrazovka a vstup potrebujú viac správ; bežné ovládanie menej
    const conn: Conn = { ws, role, deviceId, phoneId, ip, alive: true, bucket: new Bucket(role === 'laptop' ? 200 : 60, role === 'laptop' ? 400 : 120) };
    room(deviceId).add(conn);
    ipConns.set(ip, (ipConns.get(ip) ?? 0) + 1);
    presence(deviceId);

    ws.on('pong', () => { conn.alive = true; });
    let dropped = 0;
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      if (!conn.bucket.take()) { if (++dropped > 500) ws.close(4429, 'rate_limited'); return; }
      let frame: Frame;
      try { frame = Frame.parse(JSON.parse(String(raw))); } catch { return; }
      if (frame.t === 'ctl') return onCtl(conn, frame);

      // e2e: kto smie komu posielať
      if (role === 'hub') return;
      if (role === 'phone') {
        if (frame.to !== 'laptop' || !store.isApproved(deviceId, phoneId)) return;
        return deliver(deviceId, 'laptop', { ...frame, from: 'phone', peer: phoneId });
      }
      // notebook → konkrétnemu schválenému telefónu
      if (frame.to !== 'phone' || !frame.peer) return;
      deliver(deviceId, 'phone', { ...frame, from: 'laptop' }, { phoneId: frame.peer, onlyApproved: true });
    });
    ws.on('close', () => {
      room(deviceId).delete(conn);
      if (room(deviceId).size === 0) rooms.delete(deviceId);
      const n = (ipConns.get(ip) ?? 1) - 1; if (n <= 0) ipConns.delete(ip); else ipConns.set(ip, n);
      presence(deviceId);
    });
    ws.on('error', () => { try { ws.terminate(); } catch { /* ignore */ } });
  });

  function onCtl(conn: Conn, frame: CtlFrame) {
    const { deviceId, role } = conn;
    if (frame.op === 'ping') return send(conn.ws, { v: 1, t: 'ctl', op: 'pong', body: {} } satisfies CtlFrame);
    if (role === 'phone' && !store.isApproved(deviceId, conn.phoneId)) return; // neschválený telefón smie len ping
    switch (frame.op) {
      case 'pair.accepted': {
        if (role !== 'laptop') return;
        const pid = String(frame.body.phoneId ?? '');
        if (store.approvePhone(deviceId, pid)) { deliver(deviceId, 'phone', frame, { phoneId: pid }); presence(deviceId); }
        return;
      }
      case 'revoked': {
        if (role !== 'laptop') return;
        const pid = String(frame.body.phoneId ?? '');
        deliver(deviceId, 'phone', frame, { phoneId: pid });
        if (store.revokePhone(deviceId, pid)) for (const c of room(deviceId)) if (c.phoneId === pid) c.ws.close(4403, 'revoked');
        return;
      }
      case 'wake': {
        if (role !== 'phone') return;
        const last = lastWake.get(deviceId) ?? 0;
        if (Date.now() - last < 10_000) return send(conn.ws, { v: 1, t: 'ctl', op: 'wake.result', body: { ok: false, error: 'Počkaj pár sekúnd pred ďalším pokusom.' } } satisfies CtlFrame);
        lastWake.set(deviceId, Date.now());
        const hubOnline = [...room(deviceId)].some(c => c.role === 'hub');
        if (!hubOnline) return send(conn.ws, { v: 1, t: 'ctl', op: 'wake.result', body: { ok: false, error: 'Zobúdzač v domácej sieti nie je pripojený.' } } satisfies CtlFrame);
        return deliver(deviceId, 'hub', { v: 1, t: 'ctl', op: 'wake', body: {} } satisfies CtlFrame);
      }
      case 'wake.result': {
        if (role !== 'hub') return;
        return deliver(deviceId, 'phone', { v: 1, t: 'ctl', op: 'wake.result', body: { ok: !!frame.body.ok, error: frame.body.error ? String(frame.body.error).slice(0, 200) : undefined } } satisfies CtlFrame, { onlyApproved: true });
      }
      default: return;
    }
  }

  // kontrola živosti: spojenie bez odpovede na ping sa ukončí
  const hb = setInterval(() => {
    for (const set of rooms.values()) for (const c of set) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* ignore */ }
    }
  }, opts.heartbeatMs ?? 25_000);
  hb.unref();

  function listen(port = opts.port ?? 8787): Promise<number> {
    return new Promise((resolve) => http.listen(port, () => {
      const addr = http.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    }));
  }
  async function close() {
    clearInterval(hb); clearInterval(gc);
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => http.close(() => r()));
    store.flush();
  }
  return { http, store, listen, close };
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

/* spustenie ako samostatný proces */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const relay = createRelay({
    dataFile: process.env.NS_DATA_FILE ?? null,
    allowedOrigins: (process.env.NS_ALLOWED_ORIGINS ?? '*').split(',').map(s => s.trim()).filter(Boolean),
    trustProxy: process.env.NS_TRUST_PROXY === '1',
  });
  relay.listen(Number(process.env.PORT ?? 8787)).then((p) => console.log(`[relay] počúva na :${p}${process.env.NS_DATA_FILE ? '' : ' (bez NS_DATA_FILE sa párovania po reštarte stratia)'}`));
  const stop = () => { relay.close().finally(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
