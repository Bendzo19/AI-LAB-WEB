import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { exportPrivateKey, generateKeyPair, importKeyPair, type KeyPair } from '@ns/protocol';

/**
 * Konfigurácia a trvalé kľúče agenta. Uložené v profile používateľa
 * (%APPDATA%\NotebookStudio\config.json). Súkromný kľúč a tokeny neopúšťajú
 * notebook. Vývojársky režim je predvolene vypnutý.
 */
export interface Config {
  relayUrl: string;
  deviceId: string | null;
  laptopToken: string | null;
  name: string;
  devMode: boolean;
  apps: Record<string, string>;
  anthropicApiKey: string | null;
  anthropicBaseUrl?: string;
  privateJwk: JsonWebKey | null;
}

const DEFAULT: Config = {
  relayUrl: process.env.NS_RELAY ?? 'ws://localhost:8787',
  deviceId: null,
  laptopToken: null,
  name: 'Môj notebook',
  devMode: false,
  apps: {},
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
  privateJwk: null,
};

export function configPath(): string {
  const base = process.env.NS_CONFIG_DIR
    ?? (process.platform === 'win32' ? join(process.env.APPDATA ?? homedir(), 'NotebookStudio') : join(homedir(), '.config', 'notebook-studio'));
  return join(base, 'config.json');
}

export async function loadConfig(path = configPath()): Promise<Config> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    return { ...DEFAULT, ...raw };
  } catch {
    return { ...DEFAULT };
  }
}

export async function saveConfig(cfg: Config, path = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export async function ensureKeyPair(cfg: Config): Promise<{ cfg: Config; keyPair: KeyPair }> {
  if (cfg.privateJwk) return { cfg, keyPair: await importKeyPair(cfg.privateJwk) };
  const keyPair = await generateKeyPair();
  const next = { ...cfg, privateJwk: await exportPrivateKey(keyPair) };
  return { cfg: next, keyPair };
}
