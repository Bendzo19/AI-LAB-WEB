import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { NotebookClient, type WebSocketLike } from '../src/client.ts';

/** Overí knižnicu mobilu proti skutočnému relay a agentovi (--simulate). */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const PORT = 8792;
const HTTP = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}`;
let relay: ChildProcess, agent: ChildProcess, agentOut = '';

const run = (script: string, env: Record<string, string>) => spawn('npx', ['tsx', script], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
async function waitFor(fn: () => Promise<boolean> | boolean, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('časový limit'); }

// adaptér ws (Node) na rozhranie WebSocketLike (prehliadač)
const wsFactory = (url: string, protocols?: string[]): WebSocketLike => {
  const s = new WebSocket(url, protocols);
  return {
    get readyState() { return s.readyState; },
    send: (d) => s.send(d),
    close: (c, r) => s.close(c, r),
    addEventListener: (type, fn) => s.on(type === 'message' ? 'message' : type, (arg: unknown) => fn(type === 'message' ? { data: arg } : {})),
  };
};

beforeAll(async () => {
  relay = run('apps/relay/src/server.ts', { PORT: String(PORT) });
  await waitFor(async () => (await fetch(`${HTTP}/health`).catch(() => ({ ok: false }))).ok);
  const cfgDir = mkdtempSync(join(tmpdir(), 'ns-cli-'));
  agent = run('apps/agent-windows/src/main.ts', { NS_RELAY: WS, NS_CONFIG_DIR: cfgDir });
  agent.stdout?.on('data', d => { agentOut += String(d); });
  await waitFor(() => agentOut.includes('pripojený na relay'), 20000);
}, 40000);
afterAll(() => { agent?.kill(); relay?.kill(); });

describe('NotebookClient (mobil) ↔ agent', () => {
  it('spáruje, číta telemetriu, pošle bezpečný príkaz a potvrdí nebezpečný', async () => {
    let code = '';
    await waitFor(() => { const m = agentOut.match(/pre mobil:\s*([A-Z0-9]{8})/i); if (m) { code = m[1]!; return true; } return false; }, 20000);

    const telemetry: Record<string, unknown>[] = [];
    let helloHost = '';
    const confirms: { requestId: string; risk: string }[] = [];
    const client = new NotebookClient(HTTP, WS, null, {
      onTelemetry: (d) => telemetry.push(d),
      onHello: (i) => { helloHost = i.host; },
      onConfirmRequired: (r) => confirms.push(r),
    }, wsFactory);

    const pair = await client.pair(code, 'Test mobil');
    expect(pair.sas).toMatch(/^\d{6}$/);
    await client.connect();

    await waitFor(() => telemetry.length > 0, 15000);
    await waitFor(() => helloHost.length > 0, 5000);
    const status = telemetry[telemetry.length - 1] as { battery: { percent: number } };
    expect(status.battery.percent).toBe(86);

    // bezpečný príkaz
    const info = await client.command('system.info');
    expect(info.ok).toBe(true);
    expect((info.data as { model: string }).model).toContain('LOQ');

    // nebezpečný príkaz: príde žiadosť o potvrdenie, my schválime → vykoná sa
    const cleanupP = client.command('cleanup.run', { categories: ['temp'] });
    await waitFor(() => confirms.length > 0, 8000);
    expect(confirms[0]!.risk).toBe('danger');
    await client.confirm(confirms[0]!.requestId, true);
    const cleanup = await cleanupP;
    expect(cleanup.ok).toBe(true);
    expect((cleanup.data as { freedGb: number }).freedGb).toBeGreaterThan(0);

    client.disconnect();
  }, 40000);
});
