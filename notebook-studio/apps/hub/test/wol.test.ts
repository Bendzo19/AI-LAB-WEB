import { describe, expect, it } from 'vitest';
import { magicPacket } from '../src/hub.ts';

describe('Wake-on-LAN magický paket', () => {
  it('má 102 bajtov: 6× 0xFF a 16× MAC', () => {
    const p = magicPacket('8c:16:45:aa:bb:cc');
    expect(p.length).toBe(102);
    expect([...p.subarray(0, 6)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect([...p.subarray(6, 12)]).toEqual([0x8c, 0x16, 0x45, 0xaa, 0xbb, 0xcc]);
    expect([...p.subarray(96, 102)]).toEqual([0x8c, 0x16, 0x45, 0xaa, 0xbb, 0xcc]);
  });
  it('prijme pomlčky aj dvojbodky', () => {
    expect(magicPacket('8c-16-45-aa-bb-cc').length).toBe(102);
  });
  it('odmietne neplatnú MAC', () => {
    expect(() => magicPacket('xx:yy')).toThrow();
  });
});
