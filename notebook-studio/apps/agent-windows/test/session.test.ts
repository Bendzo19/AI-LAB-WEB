import { describe, expect, it } from 'vitest';
import { aadFor, deriveSessionKey, generateKeyPair, msg, seal } from '@ns/protocol';
import { PhoneSession } from '../src/session.ts';

describe('PhoneSession — šifrovanie a ochrana proti opakovaniu', () => {
  it('notebook a mobil si rozumejú a opakovanie sa odmietne', async () => {
    const laptop = await generateKeyPair();
    const phone = await generateKeyPair();
    const session = await PhoneSession.create(laptop, phone.publicRaw, 'dev1', 'p1');

    // mobil pošle správu (zašifruje svojím kľúčom pre notebook)
    const phoneKey = await deriveSessionKey(phone, laptop.publicRaw, 'dev1');
    const m = msg('cmd', { name: 'system.status', args: {} });
    const box = await seal(phoneKey, m, aadFor('dev1', 'phone', 'laptop', 'p1'));

    const got = await session.openFrom(box.n, box.c);
    expect(got?.type).toBe('cmd');
    // to isté ešte raz → odmietnuté (replay)
    expect(await session.openFrom(box.n, box.c)).toBeNull();
  });

  it('správa notebooku sa dá na mobile dešifrovať', async () => {
    const laptop = await generateKeyPair();
    const phone = await generateKeyPair();
    const session = await PhoneSession.create(laptop, phone.publicRaw, 'dev1', 'p1');
    const phoneKey = await deriveSessionKey(phone, laptop.publicRaw, 'dev1');

    const out = await session.sealFor(msg('telemetry', { data: { cpu: 47 } }));
    const { open } = await import('@ns/protocol');
    const dec = await open(phoneKey, out.n, out.c, aadFor('dev1', 'laptop', 'phone', 'p1')) as { type: string; data: { cpu: number } };
    expect(dec.type).toBe('telemetry');
    expect(dec.data.cpu).toBe(47);
  });
});
