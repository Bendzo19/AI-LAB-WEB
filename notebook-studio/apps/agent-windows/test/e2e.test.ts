import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  aadFor, deriveSessionKey, generateKeyPair, msg, open, seal, type AppMessage, type E2EFrame, type KeyPair,
} from '@ns/protocol';

/**
 * Celý reťazec cez skutočný relay a proces agenta (--simulate):
 * párovanie → šifrované spojenie → príkaz s výsledkom → potvrdenie zamietnutím.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const PORT = 8791;
const RELAY_HTTP = `http://127.0.0.1:${PORT}`;
const RELAY_WS = `ws://127.0.0.1:${PORT}`;
let relay: ChildProcess, agent: ChildProcess;
let agentOut = '';

const run = (script: string, env: Record<string, string>) =>
  spawn('npx', ['tsx', script], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

async function waitFor(fn: () => Promise<boolean>, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn().catch(() => false)) return; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('časový limit čakania');
}

beforeAll(async () => {
  relay = run('apps/relay/src/server.ts', { PORT: String(PORT) });
  await waitFor(async () => (await fetch(`${RELAY_HTTP}/health`)).ok);
  const cfgDir = mkdtempSync(join(tmpdir(), 'ns-agent-'));
  agent = run('apps/agent-windows/src/main.ts', { NS_RELAY: RELAY_WS, NS_CONFIG_DIR: cfgDir, NODE_ENV: 'test' });
  agent.stdout?.on('data', (d) => { agentOut += String(d); });
  agent.stderr?.on('data', (d) => { agentOut += String(d); });
  // počkaj, kým sa agent pripojí na relay
  await waitFor(async () => agentOut.includes('pripojený na relay'), 20000);
}, 40000);

afterAll(() => { agent?.kill(); relay?.kill(); });

// Pretože párovací kód agenta ide iba na jeho konzolu, odchytíme ho zo stdout.
async function readPairCode(): Promise<string> {
  let code = '';
  await waitFor(async () => { const m = agentOut.match(/pre mobil:\s*([A-Z0-9]{8})/i); if (m) { code = m[1]!; return true; } return false; }, 20000);
  return code;
}

describe('reťazec mobil ↔ relay ↔ agent', () => {
  it('spáruje sa, pošle príkaz a dostane výsledok; zamietnutie funguje', async () => {
    const code = await readPairCode();
    const phone = await generateKeyPair();

    const claim = await (await fetch(`${RELAY_HTTP}/v1/pair/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, phonePub: phone.publicRaw, phoneName: 'Test' }) })).json() as { deviceId: string; laptopPub: string; phoneId: string; phoneToken: string };
    expect(claim.phoneId).toBeTruthy();

    const key = await deriveSessionKey(phone, claim.laptopPub, claim.deviceId);
    const ws = new WebSocket(`${RELAY_WS}/v1/ws?role=phone&device=${claim.deviceId}&phone=${claim.phoneId}`, [`bearer.${claim.phoneToken}`]);
    const inbox: AppMessage[] = [];
    const decode = async (f: E2EFrame) => open(key, f.n, f.c, aadFor(claim.deviceId, 'laptop', 'phone', claim.phoneId)) as Promise<AppMessage>;
    ws.on('message', async (raw) => { const p = JSON.parse(String(raw)); if (p.t === 'e2e') inbox.push(await decode(p)); });
    await new Promise<void>((res, rej) => { ws.on('open', () => res()); ws.on('error', rej); });

    const sendMsg = async (m: AppMessage) => { const box = await seal(key, m, aadFor(claim.deviceId, 'phone', 'laptop', claim.phoneId)); ws.send(JSON.stringify({ v: 1, t: 'e2e', to: 'laptop', n: box.n, c: box.c })); };

    // agent po prijatí párovania (auto v simulácii) pošle hello
    await waitFor(async () => inbox.some(m => m.type === 'hello'));

    // bezpečný príkaz: stav
    const cmd = msg('cmd', { name: 'system.status', args: {} });
    await sendMsg(cmd);
    await waitFor(async () => inbox.some(m => m.type === 'cmd.result' && m.requestId === cmd.id));
    const result = inbox.find(m => m.type === 'cmd.result' && m.requestId === cmd.id) as Extract<AppMessage, { type: 'cmd.result' }>;
    expect(result.ok).toBe(true);
    expect((result.data as { battery: { percent: number } }).battery.percent).toBe(86);

    // nebezpečný príkaz: agent si vyžiada potvrdenie, my zamietneme
    const danger = msg('cmd', { name: 'power.shutdown', args: {} });
    await sendMsg(danger);
    await waitFor(async () => inbox.some(m => m.type === 'cmd.confirm_required'));
    const confirm = inbox.find(m => m.type === 'cmd.confirm_required') as Extract<AppMessage, { type: 'cmd.confirm_required' }>;
    expect(confirm.risk).toBe('danger');
    await sendMsg(msg('cmd.confirm', { requestId: confirm.requestId, approved: false }));
    await waitFor(async () => inbox.some(m => m.type === 'cmd.result' && m.requestId === danger.id));
    const denied = inbox.find(m => m.type === 'cmd.result' && m.requestId === danger.id) as Extract<AppMessage, { type: 'cmd.result' }>;
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe('denied_by_user');

    ws.close();
  }, 40000);
});
