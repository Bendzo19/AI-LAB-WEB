import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAIR_ALPHABET } from '@ns/protocol';
import { MAX_PHONES_PER_DEVICE, Store } from '../src/store.ts';

describe('relay store — párovanie a tokeny', () => {
  it('celý tok: notebook → kód → mobil → schválenie', async () => {
    const s = new Store();
    const { deviceId, token: laptopToken } = await s.createDevice('LPUB', 'Môj LOQ');
    expect(await s.checkToken('laptop', deviceId, undefined, laptopToken)).toBe(true);
    expect(await s.checkToken('laptop', deviceId, undefined, 'zlý')).toBe(false);

    const code = s.makeCode(deviceId, 60_000, PAIR_ALPHABET);
    expect(code).toMatch(new RegExp(`^[${PAIR_ALPHABET}]{8}$`));
    expect(s.takeCode(code)?.deviceId).toBe(deviceId);
    expect(s.takeCode(code)).toBeNull(); // jednorazový

    const added = (await s.addPhone(deviceId, 'PPUB', 'iPhone'))!;
    expect(await s.checkToken('phone', deviceId, added.phoneId, added.token)).toBe(true);
    expect(s.isApproved(deviceId, added.phoneId)).toBe(false);
    expect(s.approvePhone(deviceId, added.phoneId)).toBe(true);
    expect(s.isApproved(deviceId, added.phoneId)).toBe(true);
    expect(await s.checkToken('phone', 'iný', added.phoneId, added.token)).toBe(false);
  });

  it('nový kód pre zariadenie zruší predchádzajúci', async () => {
    const s = new Store();
    const { deviceId } = await s.createDevice('L', 'LOQ');
    const a = s.makeCode(deviceId, 60_000, PAIR_ALPHABET);
    const b = s.makeCode(deviceId, 60_000, PAIR_ALPHABET);
    expect(s.takeCode(a)).toBeNull();
    expect(s.takeCode(b)?.deviceId).toBe(deviceId);
  });

  it('vypršaný kód sa nedá uplatniť', async () => {
    const s = new Store();
    const { deviceId } = await s.createDevice('L', 'LOQ');
    expect(s.takeCode(s.makeCode(deviceId, -1, PAIR_ALPHABET))).toBeNull();
  });

  it('odvolanie telefónu zruší prístup', async () => {
    const s = new Store();
    const { deviceId } = await s.createDevice('L', 'LOQ');
    const p = (await s.addPhone(deviceId, 'P', 'iPhone'))!;
    s.approvePhone(deviceId, p.phoneId);
    expect(s.revokePhone(deviceId, p.phoneId)).toBe(true);
    expect(await s.checkToken('phone', deviceId, p.phoneId, p.token)).toBe(false);
  });

  it('limit telefónov na zariadenie', async () => {
    const s = new Store();
    const { deviceId } = await s.createDevice('L', 'LOQ');
    for (let i = 0; i < MAX_PHONES_PER_DEVICE; i++) expect(await s.addPhone(deviceId, 'P', 'm' + i)).not.toBeNull();
    expect(await s.addPhone(deviceId, 'P', 'navyše')).toBeNull();
  });

  it('zariadenia a telefóny prežijú reštart (súbor)', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ns-relay-')), 'data.json');
    const s1 = new Store(file);
    const { deviceId, token } = await s1.createDevice('L', 'LOQ');
    const p = (await s1.addPhone(deviceId, 'P', 'iPhone'))!;
    s1.approvePhone(deviceId, p.phoneId);
    s1.flush();
    const s2 = new Store(file);
    expect(await s2.checkToken('laptop', deviceId, undefined, token)).toBe(true);
    expect(s2.isApproved(deviceId, p.phoneId)).toBe(true);
  });
});
