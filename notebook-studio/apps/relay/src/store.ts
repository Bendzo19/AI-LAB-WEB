import { randomToken, sha256 } from '@ns/protocol';

/**
 * Úložisko relay. Relay nikdy nevidí obsah správ; drží len smerovanie:
 * zariadenia, hashe tokenov a stav párovania. V pamäti (pre nasadenie stačí
 * jeden proces); rozhranie je pripravené na výmenu za databázu.
 */
export interface Device { deviceId: string; laptopPubRaw: string; laptopName: string; laptopTokenHash: string; hubTokenHash?: string; mac?: string; createdAt: number }
export interface Phone { phoneId: string; deviceId: string; phonePubRaw: string; phoneName: string; phoneTokenHash: string; approved: boolean; createdAt: number }
export interface PairCode { code: string; deviceId: string; expiresAt: number }

export class Store {
  private devices = new Map<string, Device>();
  private phones = new Map<string, Phone>();
  private codes = new Map<string, PairCode>();

  async registerLaptop(deviceId: string, laptopPubRaw: string, name: string): Promise<{ token?: string }> {
    const existing = this.devices.get(deviceId);
    if (existing) { existing.laptopPubRaw = laptopPubRaw; existing.laptopName = name; return {}; }
    const token = randomToken();
    this.devices.set(deviceId, { deviceId, laptopPubRaw, laptopName: name, laptopTokenHash: await sha256(token), createdAt: Date.now() });
    return { token };
  }
  getDevice(deviceId: string) { return this.devices.get(deviceId); }
  setMac(deviceId: string, mac: string) { const d = this.devices.get(deviceId); if (d) d.mac = mac; }

  makeCode(deviceId: string, ttlMs: number, alphabet: string): string {
    for (const [c, v] of this.codes) if (v.expiresAt < Date.now()) this.codes.delete(c);
    const code = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    this.codes.set(code, { code, deviceId, expiresAt: Date.now() + ttlMs });
    return code;
  }
  takeCode(code: string): PairCode | null {
    const v = this.codes.get(code);
    if (!v || v.expiresAt < Date.now()) return null;
    this.codes.delete(code);
    return v;
  }

  async addPhone(deviceId: string, phonePubRaw: string, phoneName: string): Promise<{ phoneId: string; token: string }> {
    const phoneId = randomToken(9);
    const token = randomToken();
    this.phones.set(phoneId, { phoneId, deviceId, phonePubRaw, phoneName, phoneTokenHash: await sha256(token), approved: false, createdAt: Date.now() });
    return { phoneId, token };
  }
  approvePhone(deviceId: string, phoneId: string): boolean { const p = this.phones.get(phoneId); if (!p || p.deviceId !== deviceId) return false; p.approved = true; return true; }
  revokePhone(deviceId: string, phoneId: string): boolean { const p = this.phones.get(phoneId); if (!p || p.deviceId !== deviceId) return false; return this.phones.delete(phoneId); }
  getPhone(phoneId: string) { return this.phones.get(phoneId); }
  phonesOf(deviceId: string) { return [...this.phones.values()].filter(p => p.deviceId === deviceId); }

  /** Overenie na pripojenie WS. Telefón sa smie pripojiť aj pred schválením,
   * aby dostal ctl `pair.accepted`; šifrované správy gatuje `isApproved`. */
  async checkToken(kind: 'laptop' | 'phone' | 'hub', deviceId: string, id: string | undefined, token: string): Promise<boolean> {
    const h = await sha256(token);
    if (kind === 'laptop') return this.devices.get(deviceId)?.laptopTokenHash === h;
    if (kind === 'hub') return this.devices.get(deviceId)?.hubTokenHash === h;
    const p = id ? this.phones.get(id) : undefined;
    return !!p && p.deviceId === deviceId && p.phoneTokenHash === h;
  }
  isApproved(deviceId: string, phoneId: string | undefined): boolean {
    const p = phoneId ? this.phones.get(phoneId) : undefined;
    return !!p && p.deviceId === deviceId && p.approved;
  }
  async registerHub(deviceId: string): Promise<{ token: string }> {
    const token = randomToken();
    const d = this.devices.get(deviceId);
    if (d) d.hubTokenHash = await sha256(token);
    return { token };
  }
}
