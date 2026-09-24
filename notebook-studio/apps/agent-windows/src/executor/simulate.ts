import type { CommandArgs, CommandName } from '@ns/protocol';
import { ExecError, type Backend, type ExecContext, type InputEvent } from './types.ts';
import { buildHealthReport } from './health.ts';
import { SIM_SCREEN_H, SIM_SCREEN_JPEG, SIM_SCREEN_W } from './sim-screen.ts';

/**
 * Simulovaný backend: rovnaké tvary odpovedí ako Windows, ale nič nemení.
 * Slúži na vývoj a testy mimo Windowsu a ako „ukážkový režim“ v aplikácii.
 * Drží malý pohyblivý stav (teplota, batéria, procesy), aby dáta pôsobili živo.
 */
export class SimulateBackend implements Backend {
  readonly kind = 'simulate' as const;
  readonly lenovo: boolean;
  readonly admin = true;
  private t0 = Date.now();
  private mode: 'quiet' | 'balanced' | 'performance' = 'balanced';
  private load = false;
  private boost = false;
  private brightness = 70;
  private volume = 45;
  private running = new Set(['Chrome', 'Code', 'Discord', 'Steam', 'Spotify']);
  lastUrl: string | null = null;
  lastInput: InputEvent | null = null;
  private space = { temp: 2.4, recycle_bin: 1.1, browser_cache: 0.86, windows_update: 3.2, thumbnails: 0.21, logs: 0.38 };

  constructor(opts: { lenovo?: boolean } = {}) { this.lenovo = opts.lenovo ?? true; }

  private temp(): number {
    const base = this.load ? (this.mode === 'performance' ? 90 : this.mode === 'quiet' ? 82 : 86) : 46;
    return Math.round(base + Math.sin((Date.now() - this.t0) / 4000) * 2);
  }

  async run<N extends CommandName>(name: N, args: CommandArgs<N>, ctx: ExecContext): Promise<unknown> {
    const a = args as Record<string, unknown>;
    switch (name as CommandName) {
      case 'system.status': {
        const t = this.temp();
        return { battery: { percent: 86, charging: true, health: 94, cycles: 112, wearWh: 56.4, designWh: 60 }, temps: { cpu: t, gpu: t - 6, ssd: 41 }, fanRpm: this.load ? 4200 : 0, powerW: this.load ? 165 : 12, load: { cpu: this.load ? 46 : 4, gpu: this.load ? 96 : 2, ramGb: this.load ? 13.1 : 9.8, ramTotalGb: 16 }, disk: { usedGb: 318, totalGb: 512, healthPct: 98 }, mode: this.mode, alerts: t > 88 ? ['Vysoká teplota, zváž tichší režim'] : ['Odporúčané čistenie ventilátorov'] };
      }
      case 'system.info': return { model: 'Lenovo LOQ 15IRX9 (83DV)', serial: 'PF-SIMUL', cpu: 'Intel Core i7-13650HX', gpu: 'NVIDIA GeForce RTX 4060 Laptop', ramGb: 16, disks: ['NVMe 512 GB'], os: 'Windows 11 Home 24H2', bios: 'M4CN35WW (simulácia)' };
      case 'security.status': return { defender: 'active', realtime: true, signatures: 'up_to_date', firewall: 'on', lastScan: 'pred 3 dňami', threats: 0 };
      case 'security.scan': { await this.tick(ctx, a.kind === 'full' ? 6 : 3); return { started: true, kind: a.kind, found: 0, note: 'Kontrola dokončená, žiadne hrozby (simulácia).' }; }
      case 'security.update_signatures': return { updated: true, version: '1.421.' + Math.floor(Math.random() * 900) };
      case 'security.threats': return { threats: [] };
      case 'cleanup.analyze': return { ...this.space, unit: 'GB' };
      case 'cleanup.run': {
        const cats = a.categories as (keyof typeof this.space)[];
        let freed = 0; for (const c of cats) { freed += this.space[c] ?? 0; this.space[c] = 0; }
        return { freedGb: Math.round(freed * 100) / 100, categories: cats };
      }
      case 'startup.list': return { items: [{ id: 'steam', name: 'Steam', impact: 'high', enabled: true }, { id: 'discord', name: 'Discord', impact: 'medium', enabled: true }, { id: 'spotify', name: 'Spotify', impact: 'medium', enabled: false }] };
      case 'startup.set': return { id: a.id, enabled: a.enabled };
      case 'process.list': { const p = [{ pid: 4210, name: 'chrome.exe', cpu: 3.4, memMb: 1830 }, { pid: 5120, name: 'Code.exe', cpu: 1.1, memMb: 780 }, { pid: 6001, name: 'Discord.exe', cpu: 0.8, memMb: 520 }]; if (this.load) p.unshift({ pid: 7700, name: 'game.exe', cpu: 38, memMb: 6200 }); return { processes: p.slice(0, a.limit as number) }; }
      case 'process.kill': if (a.pid === 7700) this.load = false; return { pid: a.pid, killed: true };
      case 'app.list': return { apps: [...this.running, 'Notepad'] };
      case 'app.launch': { const app = String(a.app); if (/game|hra/i.test(app)) this.load = true; this.running.add(app); return { launched: app }; }
      case 'app.close': { const app = String(a.app); if (/game|hra/i.test(app)) this.load = false; this.running.delete(app); return { closed: app }; }
      case 'web.open': { const u = String(a.url); this.lastUrl = u; return { opened: u, note: 'Simulácia: adresa by sa otvorila v prehliadači.' }; }
      case 'perf.get': return { mode: this.mode };
      case 'perf.set_mode': this.mode = a.mode as typeof this.mode; return { mode: this.mode };
      case 'battery.set_conservation': return { conservation: a.enabled };
      case 'keyboard.set_backlight': return { level: a.level };
      case 'fan.set_boost': { this.boost = !!a.enabled; return { boost: this.boost }; }
      case 'audio.set_volume': this.volume = a.percent as number; return { percent: this.volume };
      case 'audio.mute': return { muted: a.muted };
      case 'display.set_brightness': this.brightness = a.percent as number; return { percent: this.brightness };
      case 'notify.show': return { shown: true, title: a.title };
      case 'network.status': return { connected: true, type: 'Wi-Fi', ssid: 'Domov-5G', signalDbm: -54, speedMbps: 480, ip: '192.168.1.24', adapters: [{ name: 'Wi-Fi', mac: '8c-16-45-aa-bb-cc' }, { name: 'Ethernet', mac: '8c-16-45-aa-bb-cd' }] };
      case 'network.wol_status': return { supported: false, adapters: [{ name: 'Ethernet', wakeArmed: false }], reason: 'Rýchle spustenie Windows je zapnuté a v BIOS-e chýba voľba pre Wake-on-LAN. Zo spánku funguje spoľahlivejšie než z úplného vypnutia.' };
      case 'network.wol_enable': return { adapter: a.adapter, armed: true, fastStartupDisabled: true };
      case 'bios.info': return { version: 'M4CN35WW', date: '2024-03-12', uefi: true, secureBoot: true, tpm: '2.0', lenovoSettings: { wakeOnLan: 'unavailable', fnLock: true } };
      case 'diag.sensors': { const t=this.temp(); const base=this.load?38:5; const cores=Array.from({length:14},(_,i)=>({ core:i, loadPct: Math.max(0,Math.min(100, Math.round(base + Math.sin((Date.now()/700)+i)*base + (this.load&&i<6?40:0)))) })); return { cpu:{ name:'Intel Core i7-13650HX', clockMhz:this.load?4600:1300, maxClockMhz:4900, coreCount:14, threads:20, loadPct:Math.round(cores.reduce((a,c)=>a+c.loadPct,0)/cores.length), cores }, memory:{ freeGb:+(16-(this.load?13.1:9.8)).toFixed(1), totalGb:16 }, fans:{ rpm:[this.boost?5200:(this.load?4200:0),this.boost?5000:(this.load?4000:0)], fullSpeed:this.boost }, temps:[{ zone:'CPU', tempC:t },{ zone:'GPU', tempC:t-6 }], gpu:{ name:'NVIDIA GeForce RTX 4060 Laptop', driver:'552.44', utilizationPct:this.load?96:2, vramUsedMb:this.load?7100:900, vramTotalMb:8188, tempC:t-6, powerW:this.load?115:8, clockCoreMhz:this.load?2100:210, clockMemMhz:8000 } }; }
      case 'diag.gpu': { const t=this.temp()-6; return { source:'nvidia-smi', name:'NVIDIA GeForce RTX 4060 Laptop', driver:'552.44', utilizationPct:this.load?96:2, vramUsedMb:this.load?7100:900, vramTotalMb:8188, tempC:t, powerW:this.load?115:8, clockCoreMhz:this.load?2100:210, clockMemMhz:8000, note:'Simulované hodnoty.' }; }
      case 'diag.disks': return { disks:[{ name:'0', model:'SK hynix BC901 512GB', type:'SSD', sizeGb:512, health:'Healthy', tempC:41, wearPct:2, readErrors:0, powerOnHours:1180 }], volumes:[{ letter:'C', label:'Windows', usedGb:318, totalGb:476 }] };
      case 'diag.network': return { adapters:[{ name:'Wi-Fi', linkMbps:1200, mac:'8c-16-45-aa-bb-cc' }], wifi:'SSID: Domov-5G\nSignal: 92%', latencyToGatewayMs:3 };
      case 'diag.battery': return { percent:86, charging:true, estRuntimeMin:null, fullChargeMwh:56400, designMwh:60000, wearPct:6, rateMw:this.load?-42000:12000, voltageMv:12600 };
      case 'diag.report': return buildHealthReport({ bat:{ wearPct:6, cycles:112 }, disks:[{ model:'SK hynix BC901 512GB', health:'Healthy', wearPct:2, tempC:41 }], sensors:{ temps:[{ zone:'CPU', tempC:this.temp() }], gpu:{ tempC:this.temp()-6 } }, sec:{ RealTimeProtectionEnabled:true, sig:1 }, updates:2 });
      case 'power.wake': return { note: 'Zobúdzač pošle magický paket (simulácia).' };
      case 'power.lock': case 'power.sleep': case 'power.hibernate': return { done: true };
      case 'power.restart': case 'power.shutdown': return { scheduled: true, delaySec: a.delaySec ?? 0, note: 'Simulácia: notebook by sa teraz ' + (name === 'power.restart' ? 'reštartoval' : 'vypol') + '.' };
      case 'power.reboot_to_firmware': return { note: 'Simulácia: reštart do BIOS-u.' };
      case 'power.cancel': return { cancelled: true };
      case 'screen.snapshot': return { jpeg: SIM_SCREEN_JPEG, w: SIM_SCREEN_W, h: SIM_SCREEN_H, note: 'Simulovaná obrazovka (nie je to tvoj skutočný displej).' };
      case 'files.list': return { items: [{ name: 'Dokumenty', dir: true }, { name: 'poznamky.txt', dir: false, sizeKb: 3 }], note: 'Simulovaný obsah priečinka.' };
      case 'files.read': return { text: 'Simulovaný obsah súboru.', note: 'V simulácii sa nečítajú skutočné súbory.' };
      case 'terminal.run': return { output: `> ${String(a.command)}\n(simulácia: príkaz sa nevykonal)`, note: 'Simulovaný terminál.' };
      default: throw new ExecError('not_supported', `Príkaz ${name} nie je v simulácii podporovaný.`);
    }
  }

  async input(ev: InputEvent, _ctx: ExecContext): Promise<void> {
    // simulácia: vstup sa nikam nepošle, len sa zaznamená posledná udalosť
    this.lastInput = ev;
  }

  private async tick(ctx: ExecContext, steps: number) {
    for (let i = 0; i < steps; i++) {
      if (ctx.signal.aborted) throw new ExecError('failed', 'Zrušené.');
      ctx.onProgress?.(Math.round(((i + 1) / steps) * 100));
      await new Promise(r => setTimeout(r, 40));
    }
  }
}
