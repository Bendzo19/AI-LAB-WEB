import { describe, expect, it } from 'vitest';
import { buildHealthReport } from '../src/executor/health.ts';

describe('buildHealthReport — hodnotenie zdravia', () => {
  it('zdravý notebook má vysoké skóre a žiadne kritické nálezy', () => {
    const r = buildHealthReport({
      bat: { wearPct: 5 }, disks: [{ model: 'SSD', health: 'Healthy', wearPct: 2, tempC: 41 }],
      sensors: { temps: [{ zone: 'CPU', tempC: 47 }], gpu: { tempC: 41 } },
      sec: { RealTimeProtectionEnabled: true, sig: 1 }, updates: 0,
    });
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.rating).toBe('výborné');
    expect(r.findings.some(f => f.level === 'crit')).toBe(false);
  });

  it('chybný disk (SMART) je kritický a stlačí skóre', () => {
    const r = buildHealthReport({ disks: [{ model: 'SSD', health: 'Unhealthy' }] });
    const crit = r.findings.find(f => f.area === 'Disk');
    expect(crit?.level).toBe('crit');
    expect(r.score).toBeLessThan(80);
    // najzávažnejšie je navrchu
    expect(r.findings[0]!.level).toBe('crit');
  });

  it('vypnutý Defender a prehriatie znížia hodnotenie', () => {
    const r = buildHealthReport({
      sensors: { temps: [{ zone: 'CPU', tempC: 97 }] },
      sec: { RealTimeProtectionEnabled: false },
    });
    expect(r.findings.some(f => f.area === 'Ochrana' && f.level === 'crit')).toBe(true);
    expect(r.findings.some(f => f.area === 'Teploty' && f.level === 'crit')).toBe(true);
    expect(r.rating === 'zhoršené' || r.rating === 'zlé').toBe(true);
  });

  it('opotrebovaná batéria dá varovanie', () => {
    expect(buildHealthReport({ bat: { wearPct: 18 } }).findings.find(f => f.area === 'Batéria')?.level).toBe('warn');
    expect(buildHealthReport({ bat: { wearPct: 35 } }).findings.find(f => f.area === 'Batéria')?.level).toBe('crit');
  });

  it('bez dát nespadne a vráti neutrálne skóre', () => {
    const r = buildHealthReport({});
    expect(r.score).toBe(100);
    expect(r.findings).toEqual([]);
  });
});
