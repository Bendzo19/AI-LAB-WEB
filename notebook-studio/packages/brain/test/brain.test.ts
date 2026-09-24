import { describe, expect, it } from 'vitest';
import { COMMANDS, parseArgs, type CommandName } from '@ns/protocol';
import { allowedCommands, needsConfirm } from '../src/policy.ts';
import { FakeExecutor } from '../src/eval/fake-executor.ts';
import { CASES } from '../src/eval/cases.ts';

describe('pravidlá agenta', () => {
  it('vývojárske nástroje sú skryté bez dev režimu', () => {
    const off = allowedCommands({ devMode: false, lenovo: true, admin: true, hub: true });
    expect(off).not.toContain('terminal.run');
    expect(off).not.toContain('files.read');
    const on = allowedCommands({ devMode: true, lenovo: true, admin: true, hub: true });
    expect(on).toContain('terminal.run');
  });
  it('bez Lenovo/admin/hub sa príslušné nástroje nenaponúkajú', () => {
    const bare = allowedCommands({ devMode: false, lenovo: false, admin: false, hub: false });
    expect(bare).not.toContain('perf.set_mode');
    expect(bare).not.toContain('power.reboot_to_firmware');
    expect(bare).not.toContain('power.wake');
    expect(bare).toContain('system.status');
  });
  it('citlivé príkazy vyžadujú potvrdenie', () => {
    expect(needsConfirm('power.shutdown')).toBe(true);
    expect(needsConfirm('cleanup.run')).toBe(true);
    expect(needsConfirm('system.status')).toBe(false);
  });
});

describe('falošný vykonávač', () => {
  it('zaznamená volanie a vráti dáta', async () => {
    const fx = new FakeExecutor();
    const data = await fx.exec({ command: 'system.status', args: {} }, new AbortController().signal) as { battery: { percent: number } };
    expect(fx.used('system.status')).toBe(true);
    expect(data.battery.percent).toBe(86);
  });
  it('simuluje zamietnutie potvrdenia', async () => {
    const fx = new FakeExecutor();
    fx.denyConfirmFor.add('power.shutdown');
    await expect(fx.exec({ command: 'power.shutdown', args: {} }, new AbortController().signal)).rejects.toMatchObject({ code: 'denied_by_user' });
  });
});

describe('testovacia sada je konzistentná', () => {
  it('všetky prípady majú prompt a check', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(6);
    for (const c of CASES) { expect(c.prompt.length).toBeGreaterThan(3); expect(typeof c.check).toBe('function'); }
  });
  it('argumenty príkazov, ktoré agent volá, sedia s katalógom', () => {
    // pre istotu overíme, že názvy použité v checkoch existujú
    for (const n of ['system.status', 'cleanup.run', 'security.scan', 'perf.set_mode', 'display.set_brightness', 'app.launch', 'network.wol_status', 'terminal.run'] as CommandName[]) {
      expect(COMMANDS[n]).toBeTruthy();
    }
    expect(() => parseArgs('display.set_brightness', { percent: 40 })).not.toThrow();
  });
});
