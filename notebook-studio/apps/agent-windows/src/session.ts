import { ReplayGuard, aadFor, deriveSessionKey, open, seal, type AppMessage, type KeyPair } from '@ns/protocol';

/**
 * Šifrované spojenie s jedným telefónom. Drží odvodený kľúč a ochranu proti
 * opakovaniu. Balí a rozbaľuje správy aplikácie (AppMessage) do/z e2e obsahu.
 */
export class PhoneSession {
  private guard = new ReplayGuard();
  constructor(
    public readonly phoneId: string,
    private readonly key: CryptoKey,
    private readonly deviceId: string,
  ) {}

  static async create(own: KeyPair, phonePubRaw: string, deviceId: string, phoneId: string): Promise<PhoneSession> {
    const key = await deriveSessionKey(own, phonePubRaw, deviceId);
    return new PhoneSession(phoneId, key, deviceId);
  }

  /** Zašifruje správu z notebooku pre tento telefón. */
  async sealFor(message: AppMessage): Promise<{ n: string; c: string }> {
    return seal(this.key, message, aadFor(this.deviceId, 'laptop', 'phone', this.phoneId));
  }

  /** Dešifruje a overí správu od tohto telefónu. Vráti null pri opakovaní/starej správe. */
  async openFrom(n: string, c: string): Promise<AppMessage | null> {
    const msg = await open(this.key, n, c, aadFor(this.deviceId, 'phone', 'laptop', this.phoneId)) as AppMessage;
    if (typeof msg?.id !== 'string' || typeof msg?.ts !== 'number') return null;
    if (!this.guard.accept(msg.id, msg.ts)) return null;
    return msg;
  }
}
