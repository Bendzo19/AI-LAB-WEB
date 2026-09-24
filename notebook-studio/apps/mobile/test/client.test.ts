import { describe, expect, it } from 'vitest';
import { exportPrivateKey, generateKeyPair } from '@ns/protocol';
import { NotebookClient, type StoredIdentity, type WebSocketLike } from '../src/client.ts';

/** Falošné WS, ktoré viem otvoriť aj zatvoriť ručne. */
class FakeWs implements WebSocketLike {
  readyState = 0;
  private h: Record<string, ((e: { data?: unknown }) => void)[]> = {};
  sent: string[] = [];
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; (this.h.close ?? []).forEach(f => f({})); }
  addEventListener(t: string, f: (e: { data?: unknown }) => void) { (this.h[t] ??= []).push(f); }
  fireOpen() { this.readyState = 1; (this.h.open ?? []).forEach(f => f({})); }
}

async function identity(): Promise<StoredIdentity> {
  const phone = await generateKeyPair();
  const laptop = await generateKeyPair();
  return { deviceId: 'd1', phoneId: 'p1', phoneToken: 'tok', laptopPub: laptop.publicRaw, laptopName: 'LOQ', privateJwk: await exportPrivateKey(phone) };
}

describe('NotebookClient — príkaz nevisí donekonečna', () => {
  it('pri odpojení sa čakajúci príkaz zamietne ako offline', async () => {
    const ws = new FakeWs();
    const client = new NotebookClient('http://x', 'ws://x', await identity(), {}, () => ws);
    await client.connect();
    ws.fireOpen();
    const p = client.command('system.status');
    await new Promise(r => setTimeout(r, 10)); // nech sa zašifruje a pošle
    ws.close();
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('offline');
  });

  it('po vypršaní limitu vráti timeout', async () => {
    const ws = new FakeWs();
    const client = new NotebookClient('http://x', 'ws://x', await identity(), {}, () => ws);
    await client.connect();
    ws.fireOpen();
    const res = await client.command('system.status', {}, 20); // 20 ms limit
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('timeout');
  });
});
