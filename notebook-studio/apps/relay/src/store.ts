import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomToken, sha256 } from '@ns/protocol';

/**
 * Úložisko relay. Relay nikdy nevidí obsah správ; drží len smerovanie:
 * zariadenia, hashe tokenov a stav párovania.
 *
 * Trvalosť: ak je zadaná cesta k súboru, zmeny sa zapisujú atomicky
 * (zápis do .tmp + premenovanie), aby reštart relay nezrušil párovania.
 * Párovacie kódy sú zámerne len v pamäti — po reštarte vypršia.
 */
export interface Device { deviceId: string; laptopPubRaw: string; laptopName: string; laptopTokenHash: string; hubTokenHash?: string; createdAt: number }
export interface Phone { phoneId: string; deviceId: string; phonePubRaw: string; phoneName: string; phoneTokenHash: string; approved: boolean; createdAt: number }
export interface PairCode { code: string; deviceId: string; expiresAt: number }

interface Snapshot { v: 1; devices: Device[]; phones: Phone[] }

/** Nepotvrdené telefóny starše ako toto sa zmažú (párovanie nedokončené). */
const PENDING_PHONE_TTL_MS = 30 * 60_000;
/** Na jedno zariadenie najviac toľko telefónov (ochrana pred zahltením). */
export const MAX_PHONES_PER_DEVICE = 8;

export class Store {
  private devices = new Map<string, Device>();
  private phones = new Map<string, Phone>();
  private codes = new Map<string, PairCode>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private file: string | null = null) {
    if (file) this.load();
  }

  private load() {
    try {
      const snap = JSON.parse(readFileSync(this.file!, 'utf8')) as Snapshot;
      for (const d of snap.devices ?? []) this.devices.set(d.deviceId, d);
      for (const p of snap.phones ?? []) this.phones.set(p.phoneId, p);
    } catch { /* prvý štart alebo prázdny súbor */ }
  }

  /** Zápis s krátkym oneskorením, aby sa viac zmien zlúčilo do jedného zápisu. */
  private persist() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush(); }, 50);
  }
  flush() {
    if (!this.file) return;
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const snap: Snapshot = { v: 1, devices: [...this.devices.values()], phones: [...this.phones.values()] };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(snap), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** Nový notebook (bez deviceId) — vytvorí zariadenie a vráti jeho token. */
  async createDevice(laptopPubRaw: string, name: string): Promise<{ deviceId: string; token: string }> {
    const deviceId = crypto.randomUUID();
    const token = randomToken();
    this.devices.set(deviceId, { deviceId, laptopPubRaw, laptopName: name, laptopTokenHash: await sha256(token), createdAt: Date.now() });
    this.persist();
    return { deviceId, token };
  }
  /** Existujúci notebook (už overený tokenom) si môže aktualizovať meno. Kľúč sa nemení. */
  updateDeviceName(deviceId: string, name: string) {
    const d = this.devices.get(deviceId); if (!d) return;
    d.laptopName = name; this.persist();
  }
  getDevice(deviceId: string) { return this.devices.get(deviceId); }

  makeCode(deviceId: string, ttlMs: number, alphabet: string): string {
    const now = Date.now();
    for (const [c, v] of this.codes) if (v.expiresAt < now || v.deviceId === deviceId) this.codes.delete(c); // jeden platný kód na zariadenie
    let code = '';
    const limit = 256 - (256 % alphabet.length); // bajty nad limitom zahodíme, aby boli znaky rovnomerné
    do {
      code = '';
      while (code.length < 8) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        for (const b of bytes) if (b < limit && code.length < 8) code += alphabet[b % alphabet.length];
      }
    } while (this.codes.has(code));
    this.codes.set(code, { code, deviceId, expiresAt: now + ttlMs });
    return code;
  }
  takeCode(code: string): PairCode | null {
    const v = this.codes.get(code);
    if (!v) return null;
    this.codes.delete(code);
    return v.expiresAt < Date.now() ? null : v;
  }

  async addPhone(deviceId: string, phonePubRaw: string, phoneName: string): Promise<{ phoneId: string; token: string } | null> {
    this.prunePending();
    if (this.phonesOf(deviceId).length >= MAX_PHONES_PER_DEVICE) return null;
    const phoneId = randomToken(9);
    const token = randomToken();
    this.phones.set(phoneId, { phoneId, deviceId, phonePubRaw, phoneName, phoneTokenHash: await sha256(token), approved: false, createdAt: Date.now() });
    this.persist();
    return { phoneId, token };
  }
  approvePhone(deviceId: string, phoneId: string): boolean {
    const p = this.phones.get(phoneId);
    if (!p || p.deviceId !== deviceId) return false;
    p.approved = true; this.persist();
    return true;
  }
  revokePhone(deviceId: string, phoneId: string): boolean {
    const p = this.phones.get(phoneId);
    if (!p || p.deviceId !== deviceId) return false;
    this.phones.delete(phoneId); this.persist();
    return true;
  }
  getPhone(phoneId: string) { return this.phones.get(phoneId); }
  phonesOf(deviceId: string) { return [...this.phones.values()].filter(p => p.deviceId === deviceId); }

  private prunePending() {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.phones) if (!p.approved && now - p.createdAt > PENDING_PHONE_TTL_MS) { this.phones.delete(id); changed = true; }
    if (changed) this.persist();
  }

  /** Overenie na pripojenie WS. Telefón sa smie pripojiť aj pred schválením,
   * aby dostal ctl `pair.accepted`; šifrované správy gatuje `isApproved`. */
  async checkToken(kind: 'laptop' | 'phone' | 'hub', deviceId: string, id: string | undefined, token: string): Promise<boolean> {
    const h = await sha256(token);
    if (kind === 'laptop') return safeEq(this.devices.get(deviceId)?.laptopTokenHash, h);
    if (kind === 'hub') return safeEq(this.devices.get(deviceId)?.hubTokenHash, h);
    const p = id ? this.phones.get(id) : undefined;
    return !!p && p.deviceId === deviceId && safeEq(p.phoneTokenHash, h);
  }
  isApproved(deviceId: string, phoneId: string | undefined): boolean {
    const p = phoneId ? this.phones.get(phoneId) : undefined;
    return !!p && p.deviceId === deviceId && p.approved;
  }
  async registerHub(deviceId: string): Promise<{ token: string } | null> {
    const d = this.devices.get(deviceId);
    if (!d) return null;
    const token = randomToken();
    d.hubTokenHash = await sha256(token);
    this.persist();
    return { token };
  }
}

/** Porovnanie v konštantnom čase (hash tokenu nesmie prezradiť zhodu podľa času). */
function safeEq(a: string | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
