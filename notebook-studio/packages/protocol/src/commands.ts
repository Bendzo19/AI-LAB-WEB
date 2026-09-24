import { z } from 'zod';

/**
 * Katalóg príkazov — jediný zdroj pravdy pre agenta na notebooku (vykonanie),
 * AI mozog (nástroje) aj mobilnú aplikáciu (tlačidlá, potvrdenia).
 *
 * risk:
 *  - safe     vykoná sa hneď
 *  - confirm  používateľ musí potvrdiť v mobile
 *  - danger   potvrdenie + výrazné varovanie (strata dát, vypnutie, mazanie)
 *
 * requires:
 *  - admin    agent potrebuje zvýšené oprávnenia (pomocná služba)
 *  - dev      vývojársky režim musí byť zapnutý v konfigurácii notebooku
 *  - lenovo   funguje len na notebookoch Lenovo s rozhraním WMI (LOQ/Legion); experimentálne
 *  - hub      vykonáva zobúdzač v domácej sieti, nie notebook
 */
export type Risk = 'safe' | 'confirm' | 'danger';
export type Requirement = 'admin' | 'dev' | 'lenovo' | 'hub';

export interface CommandDef<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  risk: Risk;
  requires?: Requirement[];
  args: S;
}

const none = z.object({}).strict();
const pct = z.number().int().min(0).max(100);

function def<S extends z.ZodType>(d: CommandDef<S>): CommandDef<S> {
  return d;
}

export const COMMANDS = {
  'system.status': def({
    name: 'system.status', title: 'Stav notebooku', risk: 'safe', args: none,
    description: 'Aktuálny stav: batéria (nabitie, zdravie, nabíjanie), teploty CPU/GPU, otáčky ventilátorov, príkon, vyťaženie CPU/GPU/RAM, disk, sieť, režim výkonu a upozornenia.',
  }),
  'system.info': def({
    name: 'system.info', title: 'Informácie o hardvéri', risk: 'safe', args: none,
    description: 'Model, sériové číslo, procesor, grafika, RAM, disky, verzia Windows a BIOS-u.',
  }),

  'power.lock': def({ name: 'power.lock', title: 'Zamknúť', risk: 'safe', args: none, description: 'Zamkne obrazovku Windows.' }),
  'power.sleep': def({ name: 'power.sleep', title: 'Uspať', risk: 'confirm', args: none, description: 'Uspí notebook. Otvorené programy zostanú v pamäti.' }),
  'power.hibernate': def({ name: 'power.hibernate', title: 'Hibernovať', risk: 'confirm', args: none, description: 'Uloží stav na disk a vypne napájanie.' }),
  'power.restart': def({ name: 'power.restart', title: 'Reštartovať', risk: 'danger', args: z.object({ delaySec: z.number().int().min(0).max(600).default(0) }).strict(), description: 'Reštartuje Windows. Neuložená práca sa stratí.' }),
  'power.shutdown': def({ name: 'power.shutdown', title: 'Vypnúť', risk: 'danger', args: z.object({ delaySec: z.number().int().min(0).max(600).default(0) }).strict(), description: 'Vypne notebook. Neuložená práca sa stratí.' }),
  'power.reboot_to_firmware': def({ name: 'power.reboot_to_firmware', title: 'Reštart do BIOS-u', risk: 'danger', requires: ['admin'], args: none, description: 'Reštartuje priamo do nastavení UEFI (BIOS). Neuložená práca sa stratí.' }),
  'power.cancel': def({ name: 'power.cancel', title: 'Zrušiť naplánované vypnutie', risk: 'safe', args: none, description: 'Zruší naplánovaný reštart alebo vypnutie.' }),
  'power.wake': def({ name: 'power.wake', title: 'Zapnúť (Wake-on-LAN)', risk: 'confirm', requires: ['hub'], args: none, description: 'Zobúdzač v domácej sieti pošle notebooku magický paket Wake-on-LAN.' }),

  'security.status': def({ name: 'security.status', title: 'Stav ochrany', risk: 'safe', args: none, description: 'Stav Microsoft Defender, definícií, firewallu a posledných kontrol.' }),
  'security.scan': def({ name: 'security.scan', title: 'Kontrola hrozieb', risk: 'safe', args: z.object({ kind: z.enum(['quick', 'full']).default('quick') }).strict(), description: 'Spustí kontrolu Microsoft Defender. Rýchla trvá minúty, úplná aj hodinu.' }),
  'security.update_signatures': def({ name: 'security.update_signatures', title: 'Aktualizovať definície', risk: 'safe', args: none, description: 'Stiahne najnovšie definície hrozieb pre Defender.' }),
  'security.threats': def({ name: 'security.threats', title: 'Nájdené hrozby', risk: 'safe', args: none, description: 'Zoznam hrozieb, ktoré Defender našiel, a ich stav.' }),

  'cleanup.analyze': def({ name: 'cleanup.analyze', title: 'Analýza miesta', risk: 'safe', args: none, description: 'Zistí, koľko miesta zaberajú dočasné súbory, kôš, cache a staré aktualizácie.' }),
  'cleanup.run': def({ name: 'cleanup.run', title: 'Vyčistiť', risk: 'danger', args: z.object({ categories: z.array(z.enum(['temp', 'recycle_bin', 'browser_cache', 'windows_update', 'thumbnails', 'logs'])).min(1) }).strict(), description: 'Natrvalo vymaže vybrané kategórie súborov.' }),

  'startup.list': def({ name: 'startup.list', title: 'Programy pri spustení', risk: 'safe', args: none, description: 'Programy, ktoré sa spúšťajú so systémom.' }),
  'startup.set': def({ name: 'startup.set', title: 'Zmeniť spúšťanie', risk: 'confirm', args: z.object({ id: z.string().min(1), enabled: z.boolean() }).strict(), description: 'Zapne alebo vypne spúšťanie programu so systémom.' }),

  'process.list': def({ name: 'process.list', title: 'Bežiace procesy', risk: 'safe', args: z.object({ sortBy: z.enum(['cpu', 'memory']).default('cpu'), limit: z.number().int().min(1).max(100).default(15) }).strict(), description: 'Procesy zoradené podľa vyťaženia CPU alebo pamäte.' }),
  'process.kill': def({ name: 'process.kill', title: 'Ukončiť proces', risk: 'danger', args: z.object({ pid: z.number().int().positive() }).strict(), description: 'Násilne ukončí proces. Neuložená práca v ňom sa stratí.' }),

  'app.list': def({ name: 'app.list', title: 'Známe aplikácie', risk: 'safe', args: none, description: 'Aplikácie, ktoré agent vie spustiť (nastavené v konfigurácii notebooku).' }),
  'app.launch': def({ name: 'app.launch', title: 'Spustiť aplikáciu', risk: 'safe', args: z.object({ app: z.string().min(1) }).strict(), description: 'Spustí aplikáciu zo zoznamu app.list podľa názvu.' }),
  'app.close': def({ name: 'app.close', title: 'Zavrieť aplikáciu', risk: 'confirm', args: z.object({ app: z.string().min(1) }).strict(), description: 'Slušne zavrie aplikáciu (ako krížik). Program sa môže spýtať na uloženie.' }),
  'web.open': def({ name: 'web.open', title: 'Otvoriť odkaz', risk: 'confirm', args: z.object({ url: z.string().url().max(2048) }).strict(), description: 'Otvorí adresu (http/https) v predvolenom prehliadači notebooku. Napr. video na YouTube.' }),

  'perf.get': def({ name: 'perf.get', title: 'Režim výkonu', risk: 'safe', requires: ['lenovo'], args: none, description: 'Aktuálny režim výkonu Lenovo (tichý, vyvážený, výkonný).' }),
  'perf.set_mode': def({ name: 'perf.set_mode', title: 'Nastaviť režim výkonu', risk: 'safe', requires: ['lenovo'], args: z.object({ mode: z.enum(['quiet', 'balanced', 'performance']) }).strict(), description: 'Prepne režim výkonu ako Fn+Q.' }),
  'battery.set_conservation': def({ name: 'battery.set_conservation', title: 'Šetrenie batérie', risk: 'confirm', requires: ['lenovo'], args: z.object({ enabled: z.boolean() }).strict(), description: 'Obmedzí nabíjanie batérie približne na 80 % a predĺži jej životnosť.' }),
  'fan.set_boost': def({ name: 'fan.set_boost', title: 'Ventilátory naplno', risk: 'confirm', requires: ['lenovo'], args: z.object({ enabled: z.boolean() }).strict(), description: 'Zapne alebo vypne maximálne otáčky ventilátorov (Lenovo fan boost). Overená funkcia Lenovo — hlučnejšie, ale chladnejšie. Nemení krivku natvrdo.' }),
  'keyboard.set_backlight': def({ name: 'keyboard.set_backlight', title: 'Podsvietenie klávesnice', risk: 'safe', requires: ['lenovo'], args: z.object({ level: z.enum(['off', 'low', 'high']) }).strict(), description: 'Nastaví jas podsvietenia klávesnice.' }),

  'audio.set_volume': def({ name: 'audio.set_volume', title: 'Hlasitosť', risk: 'safe', args: z.object({ percent: pct }).strict(), description: 'Nastaví hlasitosť systému v percentách.' }),
  'audio.mute': def({ name: 'audio.mute', title: 'Stlmiť zvuk', risk: 'safe', args: z.object({ muted: z.boolean() }).strict(), description: 'Stlmí alebo zapne zvuk.' }),
  'display.set_brightness': def({ name: 'display.set_brightness', title: 'Jas', risk: 'safe', args: z.object({ percent: pct }).strict(), description: 'Nastaví jas vstavaného displeja.' }),
  'notify.show': def({ name: 'notify.show', title: 'Upozornenie na notebooku', risk: 'safe', args: z.object({ title: z.string().min(1).max(64), text: z.string().max(240).default('') }).strict(), description: 'Zobrazí upozornenie na obrazovke notebooku.' }),

  'network.status': def({ name: 'network.status', title: 'Sieť', risk: 'safe', args: none, description: 'Pripojenie, sieťové karty, IP adresy a MAC adresy.' }),
  'network.wol_status': def({ name: 'network.wol_status', title: 'Stav Wake-on-LAN', risk: 'safe', args: none, description: 'Či sieťové karty a Windows dovoľujú zobudenie magickým paketom a čo treba zapnúť.' }),
  'network.wol_enable': def({ name: 'network.wol_enable', title: 'Zapnúť Wake-on-LAN', risk: 'confirm', requires: ['admin'], args: z.object({ adapter: z.string().min(1) }).strict(), description: 'Zapne zobudenie magickým paketom na sieťovej karte a vypne rýchle spustenie, ktoré WoL blokuje.' }),
  'bios.info': def({ name: 'bios.info', title: 'BIOS a firmvér', risk: 'safe', args: none, description: 'Verzia BIOS-u, režim UEFI, Secure Boot, TPM a nastavenia Lenovo, ktoré sa dajú prečítať.' }),

  'diag.sensors': def({ name: 'diag.sensors', title: 'Senzory naživo', risk: 'safe', args: none, description: 'Podrobné senzory: vyťaženie a takt jednotlivých jadier CPU, GPU (využitie, teplota, takty), RAM, otáčky ventilátorov a teploty zo všetkých dostupných zón. Len na čítanie.' }),
  'diag.gpu': def({ name: 'diag.gpu', title: 'Grafika (detail)', risk: 'safe', args: none, description: 'Grafická karta: model, ovládač, využitie jadra, obsadenie VRAM, teplota, príkon a takty. Len na čítanie.' }),
  'diag.disks': def({ name: 'diag.disks', title: 'Disky a zdravie', risk: 'safe', args: none, description: 'Každý disk: model, typ, teplota, zdravie a opotrebenie (SMART), obsadené a voľné miesto. Len na čítanie.' }),
  'diag.network': def({ name: 'diag.network', title: 'Sieť (priepustnosť)', risk: 'safe', args: none, description: 'Sieť: rýchlosť sťahovania a odosielania, kvalita signálu Wi-Fi, latencia k bráne a sieťové karty. Len na čítanie.' }),
  'diag.report': def({ name: 'diag.report', title: 'Správa o zdraví', risk: 'safe', args: none, description: 'Zhrnie zdravie notebooku do prehľadu: batéria, disk (SMART), teploty, ochrana a aktualizácie, s celkovým skóre a odporúčaniami. Len na čítanie.' }),
  'diag.battery': def({ name: 'diag.battery', title: 'Batéria (detail)', risk: 'safe', args: none, description: 'Batéria: návrhová a súčasná kapacita, opotrebenie, počet cyklov, aktuálny príkon/výkon, napätie a odhad výdrže. Len na čítanie.' }),

  'screen.snapshot': def({ name: 'screen.snapshot', title: 'Snímka obrazovky', risk: 'safe', args: z.object({ maxWidth: z.number().int().min(320).max(3840).default(1280) }).strict(), description: 'Jedna snímka obrazovky ako JPEG.' }),

  'files.list': def({ name: 'files.list', title: 'Súbory v priečinku', risk: 'confirm', requires: ['dev'], args: z.object({ path: z.string().min(1) }).strict(), description: 'Vypíše obsah priečinka na notebooku.' }),
  'files.read': def({ name: 'files.read', title: 'Prečítať súbor', risk: 'confirm', requires: ['dev'], args: z.object({ path: z.string().min(1), maxBytes: z.number().int().min(1).max(262144).default(65536) }).strict(), description: 'Prečíta textový súbor z notebooku.' }),
  'terminal.run': def({ name: 'terminal.run', title: 'Príkaz v termináli', risk: 'danger', requires: ['dev'], args: z.object({ shell: z.enum(['powershell', 'cmd']).default('powershell'), command: z.string().min(1).max(4000), timeoutSec: z.number().int().min(1).max(600).default(60) }).strict(), description: 'Spustí príkaz v PowerShelli alebo cmd s právami prihláseného používateľa.' }),
} as const;

export type CommandName = keyof typeof COMMANDS;
export type CommandArgs<N extends CommandName> = z.output<(typeof COMMANDS)[N]['args']>;
export const COMMAND_NAMES = Object.keys(COMMANDS) as CommandName[];

export function isCommandName(n: string): n is CommandName {
  return Object.prototype.hasOwnProperty.call(COMMANDS, n);
}

/** Overí a doplní predvolené hodnoty argumentov. Vyhodí chybu s čitateľnou správou. */
export function parseArgs<N extends CommandName>(name: N, args: unknown): CommandArgs<N> {
  const r = COMMANDS[name].args.safeParse(args ?? {});
  if (!r.success) {
    const msg = r.error.issues.map(i => (i.path.length ? i.path.join('.') + ': ' : '') + i.message).join('; ');
    throw new ProtocolError('invalid_args', `Neplatné argumenty pre ${name}: ${msg}`);
  }
  return r.data as CommandArgs<N>;
}

/** JSON Schema argumentov pre nástroje AI (Claude tool input_schema). */
export function argsJsonSchema(name: CommandName): Record<string, unknown> {
  const schema = z.toJSONSchema(COMMANDS[name].args, { io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** Názov nástroja pre AI: bodky nie sú v názvoch nástrojov povolené. */
export const toolName = (n: CommandName) => n.replace(/\./g, '__');
export const fromToolName = (t: string): CommandName | null => {
  const n = t.replace(/__/g, '.');
  return isCommandName(n) ? n : null;
};

export class ProtocolError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export type ErrorCode =
  | 'invalid_args'
  | 'unknown_command'
  | 'not_supported'
  | 'requires_admin'
  | 'dev_mode_off'
  | 'denied_by_user'
  | 'confirm_timeout'
  | 'failed'
  | 'timeout'
  | 'offline'
  | 'unauthorized'
  | 'rate_limited';
