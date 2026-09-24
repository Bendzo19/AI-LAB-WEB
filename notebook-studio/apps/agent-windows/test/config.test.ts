import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, saveConfig, type Config } from '../src/config.ts';

const file = () => join(mkdtempSync(join(tmpdir(), 'ns-cfg-')), 'config.json');
const base = (): Config => ({ relayUrl: 'ws://localhost:8787', deviceId: 'd1', laptopToken: 't1', name: 'LOQ', devMode: false, apps: {}, phones: [], anthropicApiKey: null, privateJwk: null });

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
beforeEach(() => { delete process.env.NS_RELAY; delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_BASE_URL; });

describe('config — trvalosť a prostredie', () => {
  it('spárované telefóny prežijú reštart', () => {
    const f = file();
    const cfg = base();
    cfg.phones = [{ phoneId: 'p1', phonePub: 'PUB', phoneName: 'iPhone' }];
    saveConfig(cfg, f);
    const back = loadConfig(f);
    expect(back.deviceId).toBe('d1');
    expect(back.phones).toEqual([{ phoneId: 'p1', phonePub: 'PUB', phoneName: 'iPhone' }]);
  });

  it('premenné prostredia prekryjú uložený súbor', () => {
    const f = file();
    const cfg = base(); cfg.anthropicApiKey = null; cfg.relayUrl = 'ws://stare';
    saveConfig(cfg, f);
    // API kľúč sa neuložil ako null natrvalo — po nastavení env sa AI zapne
    process.env.ANTHROPIC_API_KEY = 'sk-neskor';
    process.env.NS_RELAY = 'wss://relay.novy';
    const back = loadConfig(f);
    expect(back.anthropicApiKey).toBe('sk-neskor');
    expect(back.relayUrl).toBe('wss://relay.novy');
  });

  it('hodnoty z prostredia sa nezapíšu do súboru', () => {
    const f = file();
    process.env.ANTHROPIC_API_KEY = 'sk-tajne';
    const cfg = loadConfig(f); // apiKey príde z env
    expect(cfg.anthropicApiKey).toBe('sk-tajne');
    saveConfig(cfg, f);
    // súbor tajomstvo z env neobsahuje
    const raw = require('node:fs').readFileSync(f, 'utf8');
    expect(raw).not.toContain('sk-tajne');
    // a po odobratí env je apiKey znova null
    delete process.env.ANTHROPIC_API_KEY;
    expect(loadConfig(f).anthropicApiKey).toBeNull();
  });

  it('poškodený súbor nezhodí štart (fallback na predvolené)', () => {
    const f = file();
    require('node:fs').mkdirSync(require('node:path').dirname(f), { recursive: true });
    require('node:fs').writeFileSync(f, '{nie json');
    expect(loadConfig(f).deviceId).toBeNull();
  });
});
