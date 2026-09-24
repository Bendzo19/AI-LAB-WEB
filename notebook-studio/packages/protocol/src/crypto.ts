/**
 * Šifrovanie medzi mobilom a notebookom (end-to-end).
 *
 * - Párovanie: každá strana má pár kľúčov ECDH P-256 (podporovaný vo všetkých
 *   prehliadačoch aj v Node 22 cez WebCrypto).
 * - Spoločný kľúč: ECDH → HKDF-SHA-256 (salt = deviceId, info = "ns-e2e-v1")
 *   → AES-256-GCM.
 * - Overenie párovania: SAS (8 číslic z hashu oboch verejných kľúčov) sa
 *   zobrazí na notebooku aj v mobile. Zhodné číslo znamená, že obe strany
 *   pracujú s rovnakou dvojicou kľúčov — chráni pred zámenou kľúčov PASÍVNYM
 *   relayom aj pred prehodením kľúčov medzi paralelnými párovaniami.
 *
 *   OBMEDZENIE: samotný SAS bez „záväzku“ (commitment) plne nechráni pred
 *   AKTÍVNE zlomyseľným relayom — ten je koncovým bodom oboch výmen kľúčov a
 *   pri dostatočne krátkom SAS by vedel generovať náhradné kľúče, kým sa kódy
 *   na oboch obrazovkách nezhodnú. Preto platí predpoklad, že relay je pod
 *   kontrolou používateľa (self-hosted). Úplné riešenie (commit-reveal na
 *   efemérnych kľúčoch, prípadne PAKE nad párovacím kódom) je plánované
 *   spevnenie pred verejným vystavením relaya. Viď docs/SECURITY.md.
 * - AAD pri šifrovaní viaže správu na smer (napr. "phone>laptop") a identitu
 *   telefónu, takže relay nemôže správu presmerovať opačne ani medzi telefónmi.
 */

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface KeyPair { privateKey: CryptoKey; publicKey: CryptoKey; publicRaw: string }

export async function generateKeyPair(): Promise<KeyPair> {
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  return { privateKey: kp.privateKey, publicKey: kp.publicKey, publicRaw: b64u(await subtle.exportKey('raw', kp.publicKey)) };
}

/** Uloženie kľúča (notebook ho drží v chránenom súbore, mobil v IndexedDB). */
export async function exportPrivateKey(kp: KeyPair): Promise<JsonWebKey> {
  return subtle.exportKey('jwk', kp.privateKey);
}
export async function importKeyPair(jwk: JsonWebKey): Promise<KeyPair> {
  const privateKey = await subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubJwk: JsonWebKey = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
  const publicKey = await subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  return { privateKey, publicKey, publicRaw: b64u(await subtle.exportKey('raw', publicKey)) };
}

export async function deriveSessionKey(own: KeyPair, peerPublicRaw: string, deviceId: string): Promise<CryptoKey> {
  const peer = await subtle.importKey('raw', fromB64u(peerPublicRaw), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: peer }, own.privateKey, 256);
  const hk = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(deviceId), info: enc.encode('ns-e2e-v1') },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** Overovací kód (8 číslic) — rovnaký na oboch zariadeniach; porovná ho človek. */
export async function sas(pubA: string, pubB: string): Promise<string> {
  const [x, y] = [pubA, pubB].sort();
  const h = new Uint8Array(await subtle.digest('SHA-256', enc.encode(`ns-sas-v1|${x}|${y}`)));
  // 40 bitov z hashu → rovnomerné mapovanie na 8 číslic (10^8 < 2^40)
  const lo = (((h[1]! << 24) | (h[2]! << 16) | (h[3]! << 8) | h[4]!) >>> 0);
  const n = h[0]! * 2 ** 32 + lo;
  return String(n % 100_000_000).padStart(8, '0');
}

export async function seal(key: CryptoKey, payload: unknown, aad: string): Promise<{ n: string; c: string }> {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(payload)));
  return { n: b64u(iv), c: b64u(ct) };
}

export async function open(key: CryptoKey, n: string, c: string, aad: string): Promise<unknown> {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(n), additionalData: enc.encode(aad) }, key, fromB64u(c));
  return JSON.parse(dec.decode(pt));
}

/** Náhodný token (relay ukladá iba jeho SHA-256). */
export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return b64u(b);
}
export async function sha256(s: string): Promise<string> {
  return b64u(await subtle.digest('SHA-256', enc.encode(s)));
}
