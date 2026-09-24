import { COMMANDS, ProtocolError, isCommandName, parseArgs, type CommandName } from '@ns/protocol';
import type { Backend, ExecContext } from './executor/types.ts';

/**
 * Spúšťač príkazov: jediná brána, cez ktorú prejde každý príkaz — či ho vyvolal
 * mobil tlačidlom, alebo AI agent nástrojom. Rieši:
 *  - overenie argumentov podľa katalógu,
 *  - kontrolu oprávnení (dev režim, admin, Lenovo),
 *  - vyžiadanie potvrdenia pri risk = confirm/danger,
 *  - audit každého vykonania.
 */

export interface RunnerConfig { devMode: boolean }

/** Požiada mobil o potvrdenie; vráti true/false. Implementuje main.ts. */
export type ConfirmFn = (req: { command: CommandName; title: string; text: string; risk: 'confirm' | 'danger' }) => Promise<boolean>;

export interface AuditEntry { ts: number; command: CommandName; source: 'phone' | 'agent'; ok: boolean; error?: string }

export class Runner {
  private log: AuditEntry[] = [];
  constructor(private backend: Backend, private cfg: RunnerConfig, private confirm: ConfirmFn, private onAudit?: (e: AuditEntry) => void) {}

  setDevMode(on: boolean) { this.cfg.devMode = on; }
  auditTail(n = 50): AuditEntry[] { return this.log.slice(-n); }

  private checkRequirements(name: CommandName) {
    const req = COMMANDS[name].requires ?? [];
    if (req.includes('dev') && !this.cfg.devMode) throw new ProtocolError('dev_mode_off', 'Táto funkcia je dostupná len vo vývojárskom režime, ktorý sa zapína na notebooku.');
    if (req.includes('lenovo') && !this.backend.lenovo) throw new ProtocolError('not_supported', 'Táto funkcia potrebuje rozhranie Lenovo, ktoré na tomto notebooku nie je dostupné.');
    if (req.includes('admin') && !this.backend.admin) throw new ProtocolError('requires_admin', 'Táto akcia potrebuje agenta so zvýšenými oprávneniami.');
    // req 'hub' vybavuje samostatná cesta cez zobúdzač, sem sa nedostane
  }

  async run(rawName: string, rawArgs: unknown, source: 'phone' | 'agent', ctx: ExecContext): Promise<unknown> {
    if (!isCommandName(rawName)) throw new ProtocolError('unknown_command', `Neznámy príkaz: ${rawName}`);
    const name: CommandName = rawName;
    const def = COMMANDS[name];
    this.checkRequirements(name);
    const args = parseArgs(name, rawArgs);

    if (def.risk !== 'safe') {
      const { title, text } = confirmText(name, args);
      const ok = await this.confirm({ command: name, title, text, risk: def.risk });
      if (!ok) { this.audit({ ts: Date.now(), command: name, source, ok: false, error: 'denied_by_user' }); throw new ProtocolError('denied_by_user', 'Používateľ akciu zamietol.'); }
    }

    try {
      const data = await this.backend.run(name, args, ctx);
      this.audit({ ts: Date.now(), command: name, source, ok: true });
      return data;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      this.audit({ ts: Date.now(), command: name, source, ok: false, error: err.code ?? err.message });
      throw new ProtocolError((err.code as never) ?? 'failed', err.message ?? String(e));
    }
  }

  private audit(e: AuditEntry) { this.log.push(e); if (this.log.length > 2000) this.log.shift(); this.onAudit?.(e); }
}

function confirmText(name: CommandName, args: Record<string, unknown>): { title: string; text: string } {
  const def = COMMANDS[name];
  const extra: Partial<Record<CommandName, string>> = {
    'power.shutdown': 'Neuložená práca sa stratí. Znova ho zapneš cez Wake-on-LAN alebo tlačidlom.',
    'power.restart': 'Neuložená práca vo všetkých programoch sa stratí.',
    'power.reboot_to_firmware': 'Notebook sa reštartuje priamo do nastavení BIOS-u. Neuložená práca sa stratí.',
    'cleanup.run': `Natrvalo sa vymažú: ${(args.categories as string[] | undefined)?.join(', ') ?? 'vybrané kategórie'}. Toto sa nedá vrátiť.`,
    'process.kill': `Ukončí sa proces ${args.pid}. Neuložená práca v ňom sa stratí.`,
    'terminal.run': `Spustí sa príkaz: ${String(args.command).slice(0, 120)}`,
    'files.read': `Prečíta sa súbor: ${args.path}`,
  };
  return { title: def.title + '?', text: extra[name] ?? def.description };
}
