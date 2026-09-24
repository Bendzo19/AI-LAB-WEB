import { describe, expect, it } from 'vitest';
import {
  AppMessage, COMMANDS, COMMAND_NAMES, Frame, ReplayGuard, aadFor, argsJsonSchema, deriveSessionKey, exportPrivateKey,
  fromToolName, generateKeyPair, importKeyPair, msg, open, parseArgs, sas, seal, toolName,
} from '../src/index.ts';

describe('katalóg príkazov', () => {
  it('má konzistentné názvy a JSON schémy pre AI', () => {
    for (const n of COMMAND_NAMES) {
      expect(COMMANDS[n].name).toBe(n);
      expect(fromToolName(toolName(n))).toBe(n);
      expect(toolName(n)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      const s = argsJsonSchema(n);
      expect(s.type).toBe('object');
    }
  });
  it('dopĺňa predvolené hodnoty a odmieta zlé argumenty', () => {
    expect(parseArgs('security.scan', {})).toEqual({ kind: 'quick' });
    expect(() => parseArgs('audio.set_volume', { percent: 140 })).toThrow(/percent/);
    expect(() => parseArgs('cleanup.run', { categories: [] })).toThrow();
    expect(() => parseArgs('power.lock', { extra: 1 })).toThrow();
  });
  it('nebezpečné príkazy vyžadujú potvrdenie', () => {
    for (const n of ['power.shutdown', 'power.restart', 'cleanup.run', 'process.kill', 'terminal.run'] as const) expect(COMMANDS[n].risk).toBe('danger');
    expect(COMMANDS['terminal.run'].requires).toContain('dev');
  });
});

describe('správy', () => {
  it('validuje rámce a správy', () => {
    expect(Frame.safeParse({ v: 1, t: 'e2e', to: 'laptop', n: 'x', c: 'y' }).success).toBe(true);
    expect(Frame.safeParse({ v: 1, t: 'e2e', to: 'server', n: 'x', c: 'y' }).success).toBe(false);
    const m = msg('cmd', { name: 'system.status', args: {} });
    expect(AppMessage.parse(m).type).toBe('cmd');
  });
  it('validuje živé ovládanie a vstup', () => {
    expect(AppMessage.parse(msg('control.request', {})).type).toBe('control.request');
    expect(AppMessage.parse(msg('control.state', { granted: true })).type).toBe('control.state');
    expect(AppMessage.parse(msg('input.pointer', { x: 0.5, y: 0.5, action: 'click', button: 'left' })).type).toBe('input.pointer');
    expect(AppMessage.parse(msg('input.key', { key: 'Enter', mods: ['ctrl'] })).type).toBe('input.key');
    expect(AppMessage.parse(msg('input.text', { text: 'ahoj' })).type).toBe('input.text');
    // súradnice mimo rozsahu a priveľký text sa odmietnu
    expect(AppMessage.safeParse({ ...msg('input.pointer', { x: 2, y: 0, action: 'move', button: 'left' }) }).success).toBe(false);
    expect(AppMessage.safeParse({ ...msg('input.text', { text: 'x'.repeat(2001) }) }).success).toBe(false);
  });
  it('web.open je príkaz s potvrdením a berie len platnú URL', () => {
    expect(COMMANDS['web.open'].risk).toBe('confirm');
    expect(parseArgs('web.open', { url: 'https://youtube.com' }).url).toBe('https://youtube.com');
    expect(() => parseArgs('web.open', { url: 'nie-url' })).toThrow();
  });
  it('ReplayGuard odmietne opakovanie a staré správy', () => {
    const g = new ReplayGuard(1000);
    expect(g.accept('a', 1000, 1000)).toBe(true);
    expect(g.accept('a', 1000, 1000)).toBe(false);
    expect(g.accept('b', 0, 5000)).toBe(false);
  });
});

describe('šifrovanie', () => {
  it('obe strany odvodia ten istý kľúč a SAS; AAD chráni smer', async () => {
    const laptop = await generateKeyPair();
    const phone = await generateKeyPair();
    const k1 = await deriveSessionKey(laptop, phone.publicRaw, 'dev1');
    const k2 = await deriveSessionKey(phone, laptop.publicRaw, 'dev1');
    expect(await sas(laptop.publicRaw, phone.publicRaw)).toBe(await sas(phone.publicRaw, laptop.publicRaw));
    expect(await sas(laptop.publicRaw, phone.publicRaw)).toMatch(/^\d{8}$/);
    const aad = aadFor('dev1', 'phone', 'laptop', 'p1');
    const box = await seal(k2, { hi: 'ahoj' }, aad);
    expect(await open(k1, box.n, box.c, aad)).toEqual({ hi: 'ahoj' });
    await expect(open(k1, box.n, box.c, aadFor('dev1', 'laptop', 'phone', 'p1'))).rejects.toBeTruthy();
    const other = await deriveSessionKey(laptop, phone.publicRaw, 'dev2');
    await expect(open(other, box.n, box.c, aad)).rejects.toBeTruthy();
  });
  it('kľúč sa dá uložiť a obnoviť', async () => {
    const kp = await generateKeyPair();
    const back = await importKeyPair(await exportPrivateKey(kp));
    expect(back.publicRaw).toBe(kp.publicRaw);
  });
});
