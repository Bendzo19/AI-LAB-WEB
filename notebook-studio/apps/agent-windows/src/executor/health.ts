/**
 * Čisté vyhodnotenie zdravia notebooku z už načítaných diagnostických dát.
 * Bez vedľajších účinkov — rovnaká logika pre Windows aj simuláciu, ľahko testovateľná.
 */
export type HealthLevel = 'ok' | 'warn' | 'crit';
export interface HealthFinding { area: string; level: HealthLevel; message: string }
export interface HealthReport { score: number; rating: 'výborné' | 'dobré' | 'zhoršené' | 'zlé'; findings: HealthFinding[] }

export interface HealthInputs {
  bat?: { wearPct?: number | null; cycles?: number | null } | null;
  disks?: { model?: string; health?: string | null; wearPct?: number | null; tempC?: number | null }[] | null;
  sensors?: { temps?: { zone?: string; tempC?: number | null }[]; gpu?: { tempC?: number | null } | null } | null;
  sec?: { RealTimeProtectionEnabled?: boolean | null; sig?: number | null } | null;
  updates?: number | null;
}

const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Najvyššia teplota naprieč zónami a GPU (°C), alebo null keď nič nemeriame. */
function maxTemp(sensors: HealthInputs['sensors']): number | null {
  const vals: number[] = [];
  for (const z of sensors?.temps ?? []) if (typeof z.tempC === 'number') vals.push(z.tempC);
  const g = sensors?.gpu?.tempC;
  if (typeof g === 'number') vals.push(g);
  return vals.length ? Math.max(...vals) : null;
}

export function buildHealthReport(inp: HealthInputs): HealthReport {
  const findings: HealthFinding[] = [];
  let score = 100;

  // Batéria
  const wear = inp.bat?.wearPct;
  if (typeof wear === 'number') {
    if (wear >= 30) { findings.push({ area: 'Batéria', level: 'crit', message: `Batéria je opotrebovaná na ${wear} %. Zváž výmenu.` }); score -= 22; }
    else if (wear >= 15) { findings.push({ area: 'Batéria', level: 'warn', message: `Batéria stratila ${wear} % kapacity. Sleduj výdrž.` }); score -= 10; }
    else findings.push({ area: 'Batéria', level: 'ok', message: `Batéria v dobrej kondícii (opotrebenie ${wear} %).` });
  }

  // Disk
  for (const d of inp.disks ?? []) {
    const name = d.model ?? 'Disk';
    if (d.health && d.health.toLowerCase() !== 'healthy') { findings.push({ area: 'Disk', level: 'crit', message: `${name}: SMART hlási stav „${d.health}“. Zálohuj dáta.` }); score -= 30; }
    else if (typeof d.wearPct === 'number' && d.wearPct >= 80) { findings.push({ area: 'Disk', level: 'warn', message: `${name}: opotrebenie ${d.wearPct} %, blíži sa koniec životnosti.` }); score -= 12; }
    else if (d.health) findings.push({ area: 'Disk', level: 'ok', message: `${name}: SMART v poriadku (${d.health}).` });
    if (typeof d.tempC === 'number' && d.tempC >= 70) { findings.push({ area: 'Disk', level: 'warn', message: `${name}: teplota ${d.tempC} °C je vysoká.` }); score -= 6; }
  }

  // Teploty
  const t = maxTemp(inp.sensors);
  if (typeof t === 'number') {
    if (t >= 95) { findings.push({ area: 'Teploty', level: 'crit', message: `Najvyššia teplota ${t} °C — hrozí throttling. Vyčisti ventilátory alebo zníž záťaž.` }); score -= 16; }
    else if (t >= 85) { findings.push({ area: 'Teploty', level: 'warn', message: `Teplota ${t} °C je zvýšená. Zváž tichší režim alebo čistenie.` }); score -= 7; }
    else findings.push({ area: 'Teploty', level: 'ok', message: `Teploty v norme (max ${t} °C).` });
  }

  // Ochrana
  if (inp.sec) {
    if (inp.sec.RealTimeProtectionEnabled === false) { findings.push({ area: 'Ochrana', level: 'crit', message: 'Ochrana v reálnom čase (Defender) je vypnutá.' }); score -= 20; }
    else if (typeof inp.sec.sig === 'number' && inp.sec.sig >= 3) { findings.push({ area: 'Ochrana', level: 'warn', message: `Definície hrozieb sú ${inp.sec.sig} dní staré. Aktualizuj ich.` }); score -= 6; }
    else if (inp.sec.RealTimeProtectionEnabled === true) findings.push({ area: 'Ochrana', level: 'ok', message: 'Defender je aktívny a aktuálny.' });
  }

  // Aktualizácie
  if (typeof inp.updates === 'number' && inp.updates > 0) {
    findings.push({ area: 'Aktualizácie', level: inp.updates >= 5 ? 'warn' : 'ok', message: `${inp.updates} čakajúcich aktualizácií Windows.` });
    if (inp.updates >= 5) score -= 5;
  }

  score = clampScore(score);
  const rating: HealthReport['rating'] = score >= 85 ? 'výborné' : score >= 70 ? 'dobré' : score >= 50 ? 'zhoršené' : 'zlé';
  // najzávažnejšie navrch
  const order = { crit: 0, warn: 1, ok: 2 } as const;
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return { score, rating, findings };
}
