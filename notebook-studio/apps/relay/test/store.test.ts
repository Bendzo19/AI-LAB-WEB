import { describe, expect, it } from 'vitest';
import { PAIR_ALPHABET } from '@ns/protocol';
import { Store } from '../src/store.ts';

describe('relay store — párovanie a tokeny', () => {
  it('celý tok párovania: notebook → kód → mobil → potvrdenie', async () => {
    const s = new Store();
    const { token: laptopToken } = await s.registerLaptop('dev1', 'LPUB', 'Môj LOQ');
    expect(laptopToken).toBeTruthy();
    expect(await s.checkToken('laptop', 'dev1', undefined, laptopToken!)).toBe(true);
    expect(await s.checkToken('laptop', 'dev1', undefined, 'zlý')).toBe(false);

    const code = s.makeCode('dev1', 60_000, PAIR_ALPHABET);
    expect(code).toHaveLength(8);
    const claimed = s.takeCode(code);
    expect(claimed?.deviceId).toBe('dev1');
    expect(s.takeCode(code)).toBeNull(); // kód je jednorazový

    const { phoneId, token: phoneToken } = await s.addPhone('dev1', 'PPUB', 'iPhone');
    // token platí na pripojenie hneď, ale schválený je až po potvrdení na notebooku
    expect(await s.checkToken('phone', 'dev1', phoneId, phoneToken)).toBe(true);
    expect(s.isApproved('dev1', phoneId)).toBe(false);
    expect(s.approvePhone('dev1', phoneId)).toBe(true);
    expect(s.isApproved('dev1', phoneId)).toBe(true);
    // zlý token neprejde a cudzie zariadenie tiež nie
    expect(await s.checkToken('phone', 'dev1', phoneId, 'zlý')).toBe(false);
    expect(await s.checkToken('phone', 'iný', phoneId, phoneToken)).toBe(false);
  });

  it('vypršaný kód sa nedá uplatniť', () => {
    const s = new Store();
    const code = s.makeCode('dev1', -1, PAIR_ALPHABET);
    expect(s.takeCode(code)).toBeNull();
  });

  it('odvolanie telefónu zruší jeho prístup', async () => {
    const s = new Store();
    await s.registerLaptop('dev1', 'LPUB', 'LOQ');
    const { phoneId, token } = await s.addPhone('dev1', 'PPUB', 'iPhone');
    s.approvePhone('dev1', phoneId);
    expect(s.isApproved('dev1', phoneId)).toBe(true);
    expect(s.revokePhone('dev1', phoneId)).toBe(true);
    expect(await s.checkToken('phone', 'dev1', phoneId, token)).toBe(false);
    expect(s.isApproved('dev1', phoneId)).toBe(false);
  });

  it('hub token platí až po registrácii', async () => {
    const s = new Store();
    await s.registerLaptop('dev1', 'LPUB', 'LOQ');
    const { token } = await s.registerHub('dev1');
    expect(await s.checkToken('hub', 'dev1', undefined, token)).toBe(true);
  });
});
