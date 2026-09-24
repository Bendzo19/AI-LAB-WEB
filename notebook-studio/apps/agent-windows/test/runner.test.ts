import { describe, expect, it, vi } from 'vitest';
import { SimulateBackend } from '../src/executor/simulate.ts';
import { Runner, type ConfirmFn } from '../src/runner.ts';

const ctx = () => ({ signal: new AbortController().signal });
const allow: ConfirmFn = async () => true;
const deny: ConfirmFn = async () => false;

describe('Runner — potvrdzovanie a oprávnenia', () => {
  it('bezpečný príkaz sa vykoná bez potvrdenia', async () => {
    const confirm = vi.fn(allow);
    const r = new Runner(new SimulateBackend(), { devMode: false }, confirm);
    const s = await r.run('system.status', {}, 'phone', ctx()) as { battery: { percent: number } };
    expect(s.battery.percent).toBe(86);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('nebezpečný príkaz vyžaduje potvrdenie a zamietnutie ho zastaví', async () => {
    const confirm = vi.fn(deny);
    const r = new Runner(new SimulateBackend(), { devMode: false }, confirm);
    await expect(r.run('power.shutdown', {}, 'phone', ctx())).rejects.toMatchObject({ code: 'denied_by_user' });
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0].risk).toBe('danger');
  });

  it('mazanie sa vykoná po potvrdení a uvoľní miesto', async () => {
    const r = new Runner(new SimulateBackend(), { devMode: false }, allow);
    const res = await r.run('cleanup.run', { categories: ['temp', 'recycle_bin'] }, 'phone', ctx()) as { freedGb: number };
    expect(res.freedGb).toBeGreaterThan(0);
  });

  it('vývojárske príkazy sú bez dev režimu zablokované', async () => {
    const r = new Runner(new SimulateBackend(), { devMode: false }, allow);
    await expect(r.run('terminal.run', { command: 'echo x' }, 'phone', ctx())).rejects.toMatchObject({ code: 'dev_mode_off' });
    r.setDevMode(true);
    // dev režim zapnutý → simulovaný terminál sa vykoná bez chyby
    const out = await r.run('terminal.run', { command: 'echo x' }, 'phone', ctx()) as { output: string };
    expect(out.output).toContain('simulácia');
  });

  it('funkcie Lenovo bez podpory vrátia not_supported', async () => {
    const r = new Runner(new SimulateBackend({ lenovo: false }), { devMode: false }, allow);
    await expect(r.run('perf.set_mode', { mode: 'quiet' }, 'phone', ctx())).rejects.toMatchObject({ code: 'not_supported' });
  });

  it('neznámy príkaz aj zlé argumenty sú odmietnuté', async () => {
    const r = new Runner(new SimulateBackend(), { devMode: false }, allow);
    await expect(r.run('nezmysel', {}, 'phone', ctx())).rejects.toMatchObject({ code: 'unknown_command' });
    await expect(r.run('audio.set_volume', { percent: 999 }, 'phone', ctx())).rejects.toMatchObject({ code: 'invalid_args' });
  });

  it('audit zaznamená úspech aj zamietnutie', async () => {
    const r = new Runner(new SimulateBackend(), { devMode: false }, deny);
    await r.run('system.status', {}, 'phone', ctx());
    await r.run('power.restart', {}, 'agent', ctx()).catch(() => {});
    const tail = r.auditTail();
    expect(tail).toHaveLength(2);
    expect(tail[0]).toMatchObject({ command: 'system.status', ok: true });
    expect(tail[1]).toMatchObject({ command: 'power.restart', ok: false, error: 'denied_by_user', source: 'agent' });
  });
});
