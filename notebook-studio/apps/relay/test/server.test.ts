import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { generateKeyPair } from '@ns/protocol';
import { createRelay } from '../src/server.ts';

let relay: ReturnType<typeof createRelay>;
let base = '', wsBase = '';

beforeAll(async () => {
  relay = createRelay({ log: () => {} });
  const port = await relay.listen(0);
  base = `http://127.0.0.1:${port}`; wsBase = `ws://127.0.0.1:${port}`;
});
afterAll(async () => { await relay.close(); });

const post = (path: string, body: unknown, token?: string) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
function openWs(q: string, token: string): Promise<{ ws: WebSocket; msgs: unknown[]; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/v1/ws?${q}`, [`bearer.${token}`]);
    const msgs: unknown[] = [];
    const closed = new Promise<number>(r => ws.on('close', (c) => r(c)));
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    ws.on('open', () => resolve({ ws, msgs, closed }));
    ws.on('error', reject);
  });
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('relay HTTP', () => {
  it('posiela CORS hlavičky a odpovedá na preflight', async () => {
    const r = await fetch(base + '/v1/pair/claim', { method: 'OPTIONS', headers: { origin: 'https://app.example' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('opätovné párovanie existujúceho notebooku vyžaduje jeho token', async () => {
    const kp = await generateKeyPair();
    const first = await (await post('/v1/pair/start', { laptopPub: kp.publicRaw, name: 'LOQ' })).json() as { deviceId: string; laptopToken: string };
    expect(first.laptopToken).toBeTruthy();
    // bez tokenu: útočník s deviceId nedostane kód
    const attacker = await generateKeyPair();
    expect((await post('/v1/pair/start', { deviceId: first.deviceId, laptopPub: attacker.publicRaw, name: 'x' })).status).toBe(401);
    // s tokenom: nový kód, kľúč notebooku sa nezmení
    const again = await post('/v1/pair/start', { deviceId: first.deviceId, laptopPub: attacker.publicRaw, name: 'LOQ' }, first.laptopToken);
    expect(again.status).toBe(200);
    expect(relay.store.getDevice(first.deviceId)!.laptopPubRaw).toBe(kp.publicRaw);
  });

  it('zlý kód a neplatné údaje vrátia chybu, nie pád', async () => {
    expect((await post('/v1/pair/claim', { code: 'AAAAAAAA', phonePub: 'x', phoneName: 'm' })).status).toBe(404);
    expect((await post('/v1/pair/claim', { code: 'krátky' })).status).toBe(400);
    const bad = await fetch(base + '/v1/pair/start', { method: 'POST', body: '{nie json' });
    expect(bad.status).toBe(400);
  });
});

describe('relay WebSocket', () => {
  it('neschválený telefón nemôže posielať ani budiť, schválený áno', async () => {
    const kp = await generateKeyPair();
    const dev = await (await post('/v1/pair/start', { laptopPub: kp.publicRaw, name: 'LOQ' })).json() as { deviceId: string; laptopToken: string; code: string };
    const laptop = await openWs(`role=laptop&device=${dev.deviceId}`, dev.laptopToken);
    const phone = await (await post('/v1/pair/claim', { code: dev.code, phonePub: kp.publicRaw, phoneName: 'm' })).json() as { phoneId: string; phoneToken: string };
    const ph = await openWs(`role=phone&device=${dev.deviceId}&phone=${phone.phoneId}`, phone.phoneToken);

    // pred schválením: e2e od telefónu sa zahodí
    ph.ws.send(JSON.stringify({ v: 1, t: 'e2e', to: 'laptop', n: 'a', c: 'b' }));
    await wait(100);
    expect(laptop.msgs.some((m) => (m as { t: string }).t === 'e2e')).toBe(false);

    // schválenie z notebooku
    laptop.ws.send(JSON.stringify({ v: 1, t: 'ctl', op: 'pair.accepted', body: { phoneId: phone.phoneId } }));
    await wait(100);
    ph.ws.send(JSON.stringify({ v: 1, t: 'e2e', to: 'laptop', n: 'a', c: 'b' }));
    await wait(100);
    const got = laptop.msgs.find((m) => (m as { t: string }).t === 'e2e') as { from: string; peer: string };
    expect(got.from).toBe('phone');
    expect(got.peer).toBe(phone.phoneId); // relay doplní overenú identitu

    // telefón sa nemôže vydávať za notebook ani písať iným telefónom
    ph.ws.send(JSON.stringify({ v: 1, t: 'e2e', to: 'phone', peer: 'iny', n: 'a', c: 'b' }));
    // wake bez zobúdzača vráti chybu
    ph.ws.send(JSON.stringify({ v: 1, t: 'ctl', op: 'wake', body: {} }));
    await wait(100);
    const wr = ph.msgs.find((m) => (m as { op?: string }).op === 'wake.result') as { body: { ok: boolean } };
    expect(wr.body.ok).toBe(false);

    // odvolanie zatvorí spojenie telefónu
    laptop.ws.send(JSON.stringify({ v: 1, t: 'ctl', op: 'revoked', body: { phoneId: phone.phoneId } }));
    expect(await ph.closed).toBe(4403);
    laptop.ws.close();
  });

  it('zlý token sa odmietne', async () => {
    const ws = new WebSocket(`${wsBase}/v1/ws?role=laptop&device=x`, ['bearer.zly']);
    const code = await new Promise<number>(r => ws.on('close', (c) => r(c)));
    expect(code).toBe(4401);
  });
});
