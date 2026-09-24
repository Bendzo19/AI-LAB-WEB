import { spawn } from 'node:child_process';
import type { CommandArgs, CommandName } from '@ns/protocol';
import { ExecError, type Backend, type ExecContext, type InputEvent } from './types.ts';

/**
 * Skutočný backend pre Windows 11. Väčšina vecí ide cez PowerShell a WMI/CIM.
 * Funkcie špecifické pre Lenovo (režimy výkonu, šetrenie batérie, podsvietenie)
 * používajú WMI triedy Lenovo, ktoré nie sú verejne dokumentované a nemusia byť
 * na každom modeli — ak chýbajú, vráti `not_supported`, nič nehádže naslepo.
 *
 * Beží v relácii prihláseného používateľa (nie ako služba v relácii 0), aby
 * videl obrazovku a mohol posielať vstup. Admin oprávnenia sú potrebné len na
 * časť príkazov (reštart do BIOS-u, zapnutie WoL) — tie inak vrátia requires_admin.
 */
export class WindowsBackend implements Backend {
  readonly kind = 'windows' as const;
  lenovo = false;
  admin = false;
  private wmiNamespace: string | null = null;
  private known: Record<string, string>;

  constructor(opts: { apps?: Record<string, string> } = {}) {
    this.known = opts.apps ?? {};
  }

  /** Zistí prostredie: admin práva a dostupnosť Lenovo WMI. */
  async probe(): Promise<void> {
    this.admin = (await this.ps('[bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)')).trim() === 'True';
    for (const ns of ['root\\WMI', 'root\\Lenovo']) {
      const ok = await this.ps(`try { Get-CimInstance -Namespace ${ns} -ClassName Lenovo_GameZoneData -ErrorAction Stop | Out-Null; 'yes' } catch { 'no' }`).catch(() => 'no');
      if (ok.trim() === 'yes') { this.wmiNamespace = ns; this.lenovo = true; break; }
    }
  }

  private ps(script: string, ctx?: ExecContext, timeoutMs = 60_000): Promise<string> {
    // vynútime UTF-8 na výstupe, inak sa slovenské znaky v názvoch súborov/procesov rozbijú
    const wrapped = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + script;
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-Command', wrapped], { windowsHide: true });
      let out = '', err = '';
      const timer = setTimeout(() => { child.kill(); reject(new ExecError('timeout', 'Príkaz PowerShell trval príliš dlho.')); }, timeoutMs);
      const onAbort = () => { child.kill(); reject(new ExecError('failed', 'Zrušené.')); };
      ctx?.signal.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(new ExecError('failed', e.message)); });
      child.on('close', (code) => { clearTimeout(timer); ctx?.signal.removeEventListener('abort', onAbort); code === 0 ? resolve(out) : reject(new ExecError('failed', err.trim() || `PowerShell skončil s kódom ${code}`)); });
    });
  }
  private async json<T>(script: string, ctx?: ExecContext): Promise<T> {
    const raw = await this.ps(`${script} | ConvertTo-Json -Depth 6 -Compress`, ctx);
    return JSON.parse(raw || 'null') as T;
  }
  private requireAdmin() { if (!this.admin) throw new ExecError('requires_admin', 'Táto akcia potrebuje agenta so zvýšenými oprávneniami.'); }
  private requireLenovo() { if (!this.lenovo || !this.wmiNamespace) throw new ExecError('not_supported', 'Rozhranie Lenovo WMI nie je na tomto notebooku dostupné.'); }
  /** Volanie WMI metódy Lenovo cez Invoke-CimMethod (objekty CimInstance nemajú volateľné metódy). */
  private lenovoMethod(method: string, args?: Record<string, number>): string {
    const inst = `(Get-CimInstance -Namespace ${this.wmiNamespace} -ClassName Lenovo_GameZoneData)`;
    const argStr = args ? ` -Arguments @{ ${Object.entries(args).map(([k, v]) => `${k} = ${v}`).join('; ')} }` : '';
    return `Invoke-CimMethod -InputObject ${inst} -MethodName ${method}${argStr}`;
  }

  async run<N extends CommandName>(name: N, args: CommandArgs<N>, ctx: ExecContext): Promise<unknown> {
    const a = args as Record<string, unknown>;
    switch (name as CommandName) {
      case 'system.status': return this.status(ctx);
      case 'system.info': return this.json('Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,@{n="ram";e={[math]::Round($_.TotalPhysicalMemory/1GB)}}', ctx);
      case 'security.status': return this.json('Get-MpComputerStatus | Select-Object AMRunningMode,RealTimeProtectionEnabled,AntivirusSignatureVersion,@{n="lastScan";e={$_.QuickScanEndTime}}', ctx);
      case 'security.scan': { void this.ps(`Start-MpScan -ScanType ${a.kind === 'full' ? 'FullScan' : 'QuickScan'}`, ctx, 3_600_000).catch(() => {}); return { started: true, kind: a.kind }; }
      case 'security.update_signatures': await this.ps('Update-MpSignature', ctx, 600_000); return { updated: true };
      case 'security.threats': return this.json('Get-MpThreatDetection | Select-Object ThreatID,@{n="status";e={$_.ThreatStatusID}} -First 20', ctx);

      case 'cleanup.analyze': return this.analyzeCleanup(ctx);
      case 'cleanup.run': return this.runCleanup(a.categories as string[], ctx);
      case 'startup.list': return this.json('Get-CimInstance Win32_StartupCommand | Select-Object @{n="id";e={$_.Command}},@{n="name";e={$_.Name}},Location', ctx);

      case 'process.list': return this.json(`Get-Process | Sort-Object ${a.sortBy === 'memory' ? 'WorkingSet64' : 'CPU'} -Descending | Select-Object -First ${a.limit} @{n="pid";e={$_.Id}},@{n="name";e={$_.ProcessName}},@{n="memMb";e={[math]::Round($_.WorkingSet64/1MB)}}`, ctx);
      case 'process.kill': await this.ps(`Stop-Process -Id ${Number(a.pid)} -Force`, ctx); return { pid: a.pid, killed: true };

      case 'app.list': return { apps: Object.keys(this.known) };
      case 'app.launch': { const path = this.known[String(a.app)]; if (!path) throw new ExecError('not_supported', `Aplikácia „${a.app}“ nie je v zozname povolených.`); await this.ps(`Start-Process -FilePath ${psQuote(path)}`, ctx); return { launched: a.app }; }
      case 'app.close': await this.ps(`Get-Process -Name ${psQuote(String(a.app))} -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }; $true`, ctx); return { closed: a.app };
      case 'web.open': { const u = String(a.url); if (!/^https?:\/\//i.test(u)) throw new ExecError('invalid_args', 'Otvoriť sa dá len http alebo https adresa.'); await this.ps(`Start-Process ${psQuote(u)}`, ctx); return { opened: u }; }

      case 'power.lock': await this.ps('rundll32.exe user32.dll,LockWorkStation', ctx); return { done: true };
      case 'power.sleep': await this.ps('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Suspend",$false,$false)', ctx); return { done: true };
      case 'power.hibernate': await this.ps('shutdown /h', ctx); return { done: true };
      case 'power.restart': await this.ps(`shutdown /r /t ${Number(a.delaySec ?? 0)}`, ctx); return { scheduled: true };
      case 'power.shutdown': await this.ps(`shutdown /s /t ${Number(a.delaySec ?? 0)}`, ctx); return { scheduled: true };
      case 'power.cancel': await this.ps('shutdown /a', ctx).catch(() => {}); return { cancelled: true };
      case 'power.reboot_to_firmware': this.requireAdmin(); await this.ps('shutdown /r /fw /t 0', ctx); return { done: true };

      // WMI metódy sa volajú cez Invoke-CimMethod (objekty z Get-CimInstance nemajú volateľné metódy)
      case 'perf.get': { this.requireLenovo(); const v = await this.ps(`(${this.lenovoMethod('GetSmartFanMode')}).Data`, ctx).catch(() => ''); return { mode: mapLenovoMode(v.trim()) }; }
      case 'perf.set_mode': { this.requireLenovo(); const code = { quiet: 1, balanced: 2, performance: 3 }[a.mode as 'quiet' | 'balanced' | 'performance']; await this.ps(this.lenovoMethod('SetSmartFanMode', { Data: code }), ctx); return { mode: a.mode }; }
      case 'battery.set_conservation': { this.requireLenovo(); await this.ps(this.lenovoMethod('SetBatteryChargeMode', { Mode: a.enabled ? 3 : 1 }), ctx); return { conservation: a.enabled }; }
      case 'keyboard.set_backlight': { this.requireLenovo(); const lvl = { off: 0, low: 1, high: 2 }[a.level as 'off' | 'low' | 'high']; await this.ps(this.lenovoMethod('SetKeyboardBackLightStatus', { Status: lvl }), ctx).catch(() => { throw new ExecError('not_supported', 'Ovládanie podsvietenia nie je dostupné cez WMI.'); }); return { level: a.level }; }

      case 'audio.set_volume': await this.setVolume(a.percent as number, ctx); return { percent: a.percent };
      case 'audio.mute': await this.ps(`(New-Object -ComObject WScript.Shell).SendKeys([char]173)`, ctx); return { toggled: true, note: 'Stlmenie je prepínač; appka zobrazuje želaný stav.' };
      case 'display.set_brightness': await this.ps(`$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods; Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]${Number(a.percent)} } | Out-Null`, ctx); return { percent: a.percent };
      case 'notify.show': await this.toast(String(a.title), String(a.text ?? ''), ctx); return { shown: true };

      case 'network.status': return this.json('Get-NetIPConfiguration | Select-Object InterfaceAlias,IPv4Address,@{n="mac";e={(Get-NetAdapter -InterfaceIndex $_.InterfaceIndex).MacAddress}}', ctx);
      case 'network.wol_status': return this.wolStatus(ctx);
      case 'network.wol_enable': this.requireAdmin(); await this.ps(`Enable-NetAdapterPowerManagement -Name ${psQuote(String(a.adapter))} -WakeOnMagicPacket; REG ADD "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f`, ctx); return { adapter: a.adapter, armed: true };
      case 'bios.info': return this.biosInfo(ctx);

      case 'screen.snapshot': return this.snapshot(Number(a.maxWidth ?? 1280), ctx);

      case 'files.list': return this.json(`Get-ChildItem -LiteralPath ${psQuote(String(a.path))} | Select-Object Name,@{n="dir";e={$_.PSIsContainer}},@{n="sizeKb";e={[math]::Round($_.Length/1KB)}}`, ctx);
      case 'files.read': { const t = await this.ps(`Get-Content -LiteralPath ${psQuote(String(a.path))} -TotalCount 4000 -Raw`, ctx); return { text: t.slice(0, Number(a.maxBytes ?? 65536)) }; }
      case 'terminal.run': { const shell = a.shell === 'cmd' ? 'cmd' : 'powershell'; const out = shell === 'cmd' ? await this.ps(`cmd /c ${psQuote(String(a.command))}`, ctx, Number(a.timeoutSec ?? 60) * 1000) : await this.ps(String(a.command), ctx, Number(a.timeoutSec ?? 60) * 1000); return { output: out.slice(0, 100_000) }; }

      default: throw new ExecError('not_supported', `Príkaz ${name} zatiaľ nie je implementovaný.`);
    }
  }

  private async status(ctx: ExecContext) {
    const [battery, temps] = await Promise.all([
      this.json<Record<string, unknown>>('$b = Get-CimInstance Win32_Battery; [pscustomobject]@{ percent = $b.EstimatedChargePercent; charging = ($b.BatteryStatus -eq 2) }', ctx).catch(() => ({})),
      this.ps('try { [math]::Round(((Get-CimInstance -Namespace root/WMI -ClassName MSAcpi_ThermalZoneTemperature).CurrentTemperature[0]/10)-273.15) } catch { 0 }', ctx).then(s => Number(s.trim()) || null).catch(() => null),
    ]);
    const disk = await this.json<Record<string, unknown>>('$d = Get-PSDrive C; [pscustomobject]@{ usedGb = [math]::Round($d.Used/1GB); totalGb = [math]::Round(($d.Used+$d.Free)/1GB) }', ctx).catch(() => ({}));
    return { battery, temps: { cpu: temps }, disk, mode: this.lenovo ? mapLenovoMode((await this.ps(`(${this.lenovoMethod('GetSmartFanMode')}).Data`, ctx).catch(() => '')).trim()) : null, note: temps == null ? 'Teplotu CPU nevie prečítať každý model priamo cez WMI.' : undefined };
  }
  private async analyzeCleanup(ctx: ExecContext) {
    const temp = await this.ps('(Get-ChildItem $env:TEMP -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum', ctx).then(s => bToGb(s)).catch(() => 0);
    return { temp, recycle_bin: null, browser_cache: null, windows_update: null, thumbnails: null, logs: null, unit: 'GB', note: 'Presné veľkosti pre kôš a cache zistí čistenie pri spustení.' };
  }
  private async runCleanup(categories: string[], ctx: ExecContext) {
    let freed = 0;
    if (categories.includes('temp')) { const before = await this.ps('(Get-ChildItem $env:TEMP -Recurse -File -EA SilentlyContinue|Measure-Object Length -Sum).Sum', ctx).then(Number).catch(() => 0); await this.ps('Get-ChildItem $env:TEMP -Recurse -File -EA SilentlyContinue | Remove-Item -Force -EA SilentlyContinue; $true', ctx); freed += before; }
    if (categories.includes('recycle_bin')) await this.ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', ctx).catch(() => {});
    return { freedGb: bToGb(String(freed)), categories };
  }
  private async setVolume(percent: number, ctx: ExecContext) {
    // bez externých závislostí: cez SendKeys volume-down na 0 a späť hore
    const steps = Math.round(percent / 2);
    const up = steps > 0 ? `1..${steps}` : '@()';
    await this.ps(`$w = New-Object -ComObject WScript.Shell; 1..50 | %{ $w.SendKeys([char]174) }; ${up} | %{ $w.SendKeys([char]175) }`, ctx);
  }
  private async toast(title: string, text: string, ctx: ExecContext) {
    await this.ps(`[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null; $t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $x=$t.GetElementsByTagName('text'); $x.Item(0).AppendChild($t.CreateTextNode(${psQuote(title)}))>$null; $x.Item(1).AppendChild($t.CreateTextNode(${psQuote(text)}))>$null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($t))`, ctx).catch(() => {});
  }
  private async wolStatus(ctx: ExecContext) {
    const fast = await this.ps('(Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power" -Name HiberbootEnabled -EA SilentlyContinue).HiberbootEnabled', ctx).then(s => s.trim()).catch(() => '?');
    const adapters = await this.json('Get-NetAdapter -Physical | Select-Object Name,@{n="wol";e={(Get-NetAdapterPowerManagement -Name $_.Name -EA SilentlyContinue).WakeOnMagicPacket}}', ctx).catch(() => []);
    return { fastStartupEnabled: fast === '1', adapters, reason: fast === '1' ? 'Zapni Wake-on-LAN na sieťovej karte a vypni rýchle spustenie. Zapnutie z úplného vypnutia navyše závisí od podpory v BIOS-e.' : undefined };
  }
  private async biosInfo(ctx: ExecContext) {
    return this.json('$b=Get-CimInstance Win32_BIOS; $s=Confirm-SecureBootUEFI -EA SilentlyContinue; [pscustomobject]@{ version=$b.SMBIOSBIOSVersion; date=$b.ReleaseDate; secureBoot=$s; uefi=($env:firmware_type -eq "UEFI") }', ctx);
  }
  private async snapshot(maxWidth: number, ctx: ExecContext): Promise<{ jpeg: string; w: number; h: number }> {
    // SetProcessDPIAware: bez neho by sa na škálovanom displeji (125/150 %) zachytil len výrez
    const script = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; Add-Type 'using System;using System.Runtime.InteropServices;public class DPI{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();}'; [DPI]::SetProcessDPIAware() | Out-Null; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object Drawing.Bitmap $b.Width,$b.Height; $g=[Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size); $scale=[math]::Min(1,${maxWidth}/$b.Width); $w=[int]($b.Width*$scale); $h=[int]($b.Height*$scale); $r=New-Object Drawing.Bitmap $w,$h; $g2=[Drawing.Graphics]::FromImage($r); $g2.DrawImage($bmp,0,0,$w,$h); $ms=New-Object IO.MemoryStream; $enc=[Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|?{$_.MimeType -eq 'image/jpeg'}; $p=New-Object Drawing.Imaging.EncoderParameters 1; $p.Param[0]=New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality),60; $r.Save($ms,$enc,$p); [pscustomobject]@{ jpeg=[Convert]::ToBase64String($ms.ToArray()); w=$w; h=$h } | ConvertTo-Json -Compress`;
    const r = JSON.parse((await this.ps(script, ctx, 15_000)) || 'null') as { jpeg: string; w: number; h: number } | null;
    if (!r || !r.jpeg) throw new ExecError('failed', 'Snímku obrazovky sa nepodarilo vytvoriť.');
    return r;
  }
  /**
   * Vzdialený vstup na obrazovku notebooku (myš, klávesnica). Rovnaký mechanizmus
   * ako pri diaľkovej ploche (AnyDesk/RDP): SetCursorPos + mouse_event pre myš,
   * SendKeys/keybd_event pre klávesy. Beží len počas control okna, ktoré povolí
   * používateľ na notebooku (rozhoduje main.ts). Súradnice sú 0..1 cez celú
   * virtuálnu plochu, takže sedia aj pri viacerých monitoroch a škálovaní.
   */
  async input(ev: InputEvent, ctx: ExecContext): Promise<void> {
    if (ev.type === 'input.pointer') {
      const abs = `$v=[System.Windows.Forms.SystemInformation]::VirtualScreen; $px=[int]($v.Left+${clamp01(ev.x)}*$v.Width); $py=[int]($v.Top+${clamp01(ev.y)}*$v.Height); [NsInput]::SetCursorPos($px,$py)|Out-Null;`;
      const M = { leftDown: 0x02, leftUp: 0x04, rightDown: 0x08, rightUp: 0x10, midDown: 0x20, midUp: 0x40, wheel: 0x0800 };
      const b = ev.button === 'right' ? { d: M.rightDown, u: M.rightUp } : ev.button === 'middle' ? { d: M.midDown, u: M.midUp } : { d: M.leftDown, u: M.leftUp };
      let act = '';
      if (ev.action === 'down') act = `[NsInput]::mouse_event(${b.d},0,0,0,[IntPtr]::Zero);`;
      else if (ev.action === 'up') act = `[NsInput]::mouse_event(${b.u},0,0,0,[IntPtr]::Zero);`;
      else if (ev.action === 'click') act = `[NsInput]::mouse_event(${b.d},0,0,0,[IntPtr]::Zero);[NsInput]::mouse_event(${b.u},0,0,0,[IntPtr]::Zero);`;
      else if (ev.action === 'dblclick') act = `[NsInput]::mouse_event(${b.d},0,0,0,[IntPtr]::Zero);[NsInput]::mouse_event(${b.u},0,0,0,[IntPtr]::Zero);[NsInput]::mouse_event(${b.d},0,0,0,[IntPtr]::Zero);[NsInput]::mouse_event(${b.u},0,0,0,[IntPtr]::Zero);`;
      else if (ev.action === 'scroll') { const d = Math.max(-30, Math.min(30, Math.round(ev.dy ?? 0))) * -4; act = `[NsInput]::mouse_event(${M.wheel},0,0,[uint32]${d >>> 0},[IntPtr]::Zero);`; }
      await this.ps(INPUT_PREAMBLE + abs + act, ctx, 8_000);
      return;
    }
    if (ev.type === 'input.text') {
      if (!ev.text) return;
      await this.ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psQuote(escapeSendKeys(ev.text))})`, ctx, 8_000);
      return;
    }
    // input.key: podrž modifikátory, stlač hlavnú klávesu, pusti.
    const mod: Record<string, number> = { ctrl: 0x11, alt: 0x12, shift: 0x10, win: 0x5B };
    const vk = keyToVk(ev.key);
    if (vk == null) return;                              // neznámu klávesu radšej zahodíme
    const KEYUP = 0x02;
    const downs = ev.mods.map(m => `[NsInput]::keybd_event([byte]${mod[m]},0,0,[IntPtr]::Zero);`).join('');
    const ups = [...ev.mods].reverse().map(m => `[NsInput]::keybd_event([byte]${mod[m]},0,${KEYUP},[IntPtr]::Zero);`).join('');
    const press = `[NsInput]::keybd_event([byte]${vk},0,0,[IntPtr]::Zero);[NsInput]::keybd_event([byte]${vk},0,${KEYUP},[IntPtr]::Zero);`;
    await this.ps(INPUT_PREAMBLE + downs + press + ups, ctx, 8_000);
  }

}

const psQuote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const bToGb = (bytes: string) => Math.round((Number(bytes) || 0) / 1e9 * 100) / 100;
const mapLenovoMode = (data: string): 'quiet' | 'balanced' | 'performance' | null => ({ '1': 'quiet', '2': 'balanced', '3': 'performance' } as const)[data] ?? null;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
/** Escapovanie špeciálnych znakov SendKeys ({}()+^%~[]). */
const escapeSendKeys = (t: string) => t.slice(0, 2000).replace(/[+^%~(){}\[\]]/g, m => '{' + m + '}');
/** Add-Type s P/Invoke pre myš/klávesnicu + DPI awareness. Vloží sa pred každý vstup. */
const INPUT_PREAMBLE = `Add-Type -AssemblyName System.Windows.Forms; Add-Type 'using System;using System.Runtime.InteropServices;public class NsInput{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint data,IntPtr e);[DllImport("user32.dll")]public static extern void keybd_event(byte vk,byte scan,uint f,IntPtr e);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern short VkKeyScan(char ch);}' -ErrorAction SilentlyContinue; [NsInput]::SetProcessDPIAware()|Out-Null; `;
/** Názov klávesy → Windows virtual-key kód. Jeden znak sa preloží cez VkKeyScan pri behu. */
function keyToVk(key: string): number | null {
  const named: Record<string, number> = {
    enter: 0x0D, tab: 0x09, escape: 0x1B, esc: 0x1B, backspace: 0x08, delete: 0x2E, space: 0x20,
    up: 0x26, down: 0x28, left: 0x25, right: 0x27, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
    insert: 0x2D, f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75, f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7A, f12: 0x7B,
  };
  const k = key.toLowerCase();
  const hit = named[k];
  if (hit !== undefined) return hit;
  if (key.length === 1) { const c = key.toUpperCase().charCodeAt(0); if (c >= 0x30 && c <= 0x5A) return c; }
  return null;
}

