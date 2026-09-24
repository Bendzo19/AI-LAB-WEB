import { describe, expect, it } from 'vitest';
import { msg } from '@ns/protocol';
import { SimulateBackend } from '../src/executor/simulate.ts';

const ctx = () => ({ signal: new AbortController().signal });

describe('SimulateBackend — vstup a web.open', () => {
  it('web.open zaznamená adresu a vráti ju', async () => {
    const b = new SimulateBackend();
    const r = await b.run('web.open', { url: 'https://youtube.com' }, ctx()) as { opened: string };
    expect(r.opened).toBe('https://youtube.com');
    expect(b.lastUrl).toBe('https://youtube.com');
  });

  it('input() zaznamená poslednú udalosť myši aj klávesnice', async () => {
    const b = new SimulateBackend();
    await b.input!(msg('input.pointer', { x: 0.25, y: 0.75, action: 'click', button: 'right' }), ctx());
    expect(b.lastInput?.type).toBe('input.pointer');
    await b.input!(msg('input.key', { key: 'Enter', mods: ['ctrl'] }), ctx());
    expect(b.lastInput?.type).toBe('input.key');
    await b.input!(msg('input.text', { text: 'ahoj' }), ctx());
    expect(b.lastInput).toMatchObject({ type: 'input.text', text: 'ahoj' });
  });
});

describe('SimulateBackend — diagnostika (len čítanie)', () => {
  it('diag.sensors vráti jadrá CPU, GPU, RAM, teploty', async () => {
    const b = new SimulateBackend();
    const r = await b.run('diag.sensors', {}, ctx()) as { cpu: { cores: unknown[]; coreCount: number }; gpu: { vramTotalMb: number }; memory: { totalGb: number } };
    expect(Array.isArray(r.cpu.cores)).toBe(true);
    expect(r.cpu.cores.length).toBe(r.cpu.coreCount);
    expect(r.gpu.vramTotalMb).toBeGreaterThan(0);
    expect(r.memory.totalGb).toBe(16);
  });
  it('diag.disks vráti zdravie a opotrebenie', async () => {
    const b = new SimulateBackend();
    const r = await b.run('diag.disks', {}, ctx()) as { disks: { health: string; wearPct: number }[] };
    expect(r.disks[0]!.health).toBe('Healthy');
    expect(typeof r.disks[0]!.wearPct).toBe('number');
  });
  it('diag.battery vráti opotrebenie a kapacitu', async () => {
    const b = new SimulateBackend();
    const r = await b.run('diag.battery', {}, ctx()) as { wearPct: number; designMwh: number };
    expect(r.designMwh).toBeGreaterThan(0);
    expect(r.wearPct).toBeGreaterThanOrEqual(0);
  });
  it('všetky diag.* príkazy sú bezpečné (nevyžadujú potvrdenie)', async () => {
    const { COMMANDS } = await import('@ns/protocol');
    for (const n of ['diag.sensors','diag.gpu','diag.disks','diag.network','diag.battery','diag.report'] as const) {
      expect(COMMANDS[n].risk).toBe('safe');
    }
  });
});

describe('SimulateBackend — správa o zdraví', () => {
  it('diag.report vráti skóre, hodnotenie a nálezy', async () => {
    const b = new SimulateBackend();
    const r = await b.run('diag.report', {}, ctx()) as { score: number; rating: string; findings: unknown[] };
    expect(typeof r.score).toBe('number');
    expect(['výborné','dobré','zhoršené','zlé']).toContain(r.rating);
    expect(Array.isArray(r.findings)).toBe(true);
  });
})
