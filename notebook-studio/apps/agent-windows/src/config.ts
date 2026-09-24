import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { exportPrivateKey, generateKeyPair, importKeyPair, type KeyPair } from '@ns/protocol';

/**
 * Konfigurácia a trvalé kľúče agenta. Uložené v profile používateľa
 * (%APPDATA%\NotebookStudio\config.json). Súkromný kľúč a tokeny neopúšťajú
 * notebook. Vývojársky režim je predvolene vypnutý.
 *
 * Trvalé sú identita a nastavenia (deviceId, token, kľúč, spárované telefóny,
 * apps, devMode). relayUrl a údaje k AI berieme prednostne z prostredia, aby
 * ich zmena zabrala aj pri už uloženej konfigurácii.
 */
export interface PairedPhone { phoneId: string; phonePub: string; phoneName: string }

export interface Config {
  relayUrl: string;
  deviceId: string | null;
  laptopToken: string | null;
  name: string;
  devMode: boolean;
  apps: Record<string, string>;
  phones: PairedPhone[];
  anthropicApiKey: string | null;
  anthropicBaseUrl?: string;
  privateJwk: JsonWebKey | null;
}

const DEFAULT: Config = {
  relayUrl: 'ws://localhost:8787',
  deviceId: null,
  laptopToken: null,
  name: 'Môj notebook',
  devMode: false,
  apps: {},
  phones: [],
  anthropicApiKey: null,
  anthropicBaseUrl: undefined,
  privateJwk: null,
};

/** Polia, ktoré sa berú z prostredia (a nezapisujú sa do súboru). */
function envOverrides(): Partial<Config> {
  const o: Partial<Config> = {};
  if (process.env.NS_RELAY) o.relayUrl = process.env.NS_RELAY;
  if (process.env.ANTHROPIC_API_KEY) o.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.ANTHROPIC_BASE_URL) o.anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;
  return o;
}

export function configPath(): string {
  const base = process.env.NS_CONFIG_DIR
    ?? (process.platform === 'win32' ? join(process.env.APPDATA ?? homedir(), 'NotebookStudio') : join(homedir(), '.config', 'notebook-studio'));
  return join(base, 'config.json');
}

export function loadConfig(path = configPath()): Config {
  let raw: Partial<Config> = {};
  try { raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>; } catch { /* prvý štart alebo poškodený súbor */ }
  // prostredie prekrýva súbor, takže nová hodnota zaberie aj pri uloženej konfigurácii
  return { ...DEFAULT, ...raw, ...envOverrides() };
}

/** Zapíše len trvalé polia (nie hodnoty z prostredia) atomicky (tmp + rename). */
export function saveConfig(cfg: Config, path = configPath()): void {
  const env = envOverrides();
  const persisted: Partial<Config> = { ...cfg };
  // hodnoty, ktoré prišli z prostredia, do súboru nedávame
  for (const k of Object.keys(env) as (keyof Config)[]) delete persisted[k];
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(persisted, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

export async function ensureKeyPair(cfg: Config): Promise<{ cfg: Config; keyPair: KeyPair }> {
  if (cfg.privateJwk) return { cfg, keyPair: await importKeyPair(cfg.privateJwk) };
  const keyPair = await generateKeyPair();
  const next = { ...cfg, privateJwk: await exportPrivateKey(keyPair) };
  return { cfg: next, keyPair };
}
