import { parseArgs, type CommandName } from '@ns/protocol';
import { needsConfirm } from '../policy.ts';
import type { Executor, ToolInvocation } from '../agent.ts';

/**
 * Falošný vykonávač na testy a tréning: nič reálne nespraví, iba zaznamená
 * volania a vráti hodnoverné dáta. Vie simulovať aj zamietnutie potvrdenia,
 * aby sme overili, že agent to rešpektuje.
 */
export class FakeExecutor {
  calls: { command: CommandName; args: unknown }[] = [];
  /** príkazy, ktoré „používateľ“ zamietne pri potvrdení */
  denyConfirmFor = new Set<CommandName>();
  /** príkazy, ktoré zlyhajú danou chybou */
  failWith = new Map<CommandName, string>();

  readonly exec: Executor = async (call: ToolInvocation) => {
    const args = parseArgs(call.command, call.args);
    this.calls.push({ command: call.command, args });
    if (this.failWith.has(call.command)) {
      const code = this.failWith.get(call.command)!;
      throw Object.assign(new Error(`simulovaná chyba ${code}`), { code });
    }
    if (needsConfirm(call.command) && this.denyConfirmFor.has(call.command)) {
      throw Object.assign(new Error('Používateľ akciu zamietol'), { code: 'denied_by_user' });
    }
    return this.sample(call.command, args as Record<string, unknown>);
  };

  used(command: CommandName): boolean { return this.calls.some(c => c.command === command); }
  countOf(command: CommandName): number { return this.calls.filter(c => c.command === command).length; }
  argsOf(command: CommandName): Record<string, unknown> | undefined { return this.calls.find(c => c.command === command)?.args as Record<string, unknown> | undefined; }

  private sample(command: CommandName, args: Record<string, unknown>): unknown {
    switch (command) {
      case 'system.status': return { battery: { percent: 86, charging: true, health: 94, cycles: 112 }, temps: { cpu: 47, gpu: 41 }, fanRpm: 0, powerW: 12, load: { cpu: 4, gpu: 2, ramGb: 9.8, ramTotalGb: 16 }, disk: { usedGb: 318, totalGb: 512 }, mode: 'balanced', alerts: ['Odporúčané čistenie ventilátorov'] };
      case 'system.info': return { model: 'Lenovo LOQ 15IRX9 (83DV)', cpu: 'Intel Core i7-13650HX', gpu: 'NVIDIA GeForce RTX 4060 Laptop', ramGb: 16, os: 'Windows 11 Home 24H2', bios: 'M4CN...' };
      case 'security.status': return { defender: 'active', signatures: 'up_to_date', firewall: 'on', lastScan: 'pred 3 dňami' };
      case 'security.scan': return { started: true, kind: args.kind, note: 'Kontrola beží na pozadí.' };
      case 'cleanup.analyze': return { temp: 2.4, recycle_bin: 1.1, browser_cache: 0.86, windows_update: 3.2, thumbnails: 0.21, logs: 0.38, unit: 'GB' };
      case 'cleanup.run': return { freedGb: 3.5, categories: args.categories };
      case 'process.list': return { processes: [{ pid: 4210, name: 'chrome.exe', cpu: 3.4, memMb: 1830 }, { pid: 5120, name: 'Code.exe', cpu: 1.1, memMb: 780 }] };
      case 'process.kill': return { pid: args.pid, killed: true };
      case 'app.list': return { apps: ['Steam', 'Chrome', 'Discord', 'Spotify', 'Code'] };
      case 'app.launch': return { launched: args.app };
      case 'app.close': return { closed: args.app };
      case 'perf.set_mode': return { mode: args.mode };
      case 'perf.get': return { mode: 'balanced' };
      case 'battery.set_conservation': return { conservation: args.enabled };
      case 'keyboard.set_backlight': return { level: args.level };
      case 'audio.set_volume': return { percent: args.percent };
      case 'display.set_brightness': return { percent: args.percent };
      case 'power.wake': return { sent: true };
      case 'network.wol_status': return { supported: false, reason: 'Rýchle spustenie Windows je zapnuté; BIOS voľbu WoL neponúka.' };
      case 'bios.info': return { version: 'M4CN35WW', uefi: true, secureBoot: true, tpm: '2.0' };
      case 'screen.snapshot': return { jpeg: '<base64>', w: 1280, h: 720 };
      case 'diag.sensors': return { cpu: { loadPct: 6, coreCount: 14, cores: [{ core: 0, loadPct: 8 }] }, memory: { totalGb: 16 }, gpu: { utilizationPct: 2, vramUsedMb: 900, vramTotalMb: 8188, tempC: 41 }, temps: [{ zone: 'CPU', tempC: 47 }], fans: { rpm: [0, 0] } };
      case 'diag.gpu': return { source: 'nvidia-smi', name: 'RTX 4060 Laptop', utilizationPct: 2, vramUsedMb: 900, vramTotalMb: 8188, tempC: 41 };
      case 'diag.disks': return { disks: [{ model: 'BC901 512GB', type: 'SSD', health: 'Healthy', wearPct: 2, tempC: 41 }], volumes: [{ letter: 'C', usedGb: 318, totalGb: 476 }] };
      case 'diag.network': return { adapters: [{ name: 'Wi-Fi', linkMbps: 1200 }], latencyToGatewayMs: 3 };
      case 'diag.battery': return { percent: 86, charging: true, fullChargeMwh: 56400, designMwh: 60000, wearPct: 6, cycles: 112 };
      case 'diag.report': return { score: 88, rating: 'výborné', findings: [{ area: 'Teploty', level: 'ok', message: 'Teploty v norme.' }, { area: 'Ventilátory', level: 'warn', message: 'Odporúčané čistenie.' }] };

      default: return { ok: true, command, args };
    }
  }
}
