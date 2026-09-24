import { createInterface } from 'node:readline/promises';
import { WebSocket } from 'ws';
import {
  type AppMessage, type CtlFrame, type E2EFrame, Frame, msg, sas, newId,
} from '@ns/protocol';
import { Agent as Brain } from '@ns/brain';
import { loadConfig, saveConfig, ensureKeyPair, type Config } from './config.ts';
import { SimulateBackend } from './executor/simulate.ts';
import { WindowsBackend } from './executor/windows.ts';
import type { Backend } from './executor/types.ts';
import { Runner, type ConfirmFn } from './runner.ts';
import { PhoneSession } from './session.ts';

const SIMULATE = process.argv.includes('--simulate') || process.platform !== 'win32';
/** Ako dlho platí povolené živé ovládanie, kým sa samo ukončí. */
const CONTROL_GRANT_MS = 15 * 60_000;

interface Pending { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
/** Všetko, čo agent drží pre jeden spárovaný telefón. */
interface PhonePeer {
  session: PhoneSession;
  runner: Runner;
  brain: Brain | null;
  chats: Map<string, AbortController>;   // podľa convId
  screen: ReturnType<typeof setInterval> | null;
  control: ControlGrant;                 // živé ovládanie: povolené len po potvrdení na notebooku
}

/** Stav udeleného control okna pre jeden telefón. */
interface ControlGrant { granted: boolean; pending: boolean; timer: ReturnType<typeof setTimeout> | null; }

class LaptopAgent {
  private ws: WebSocket | null = null;
  private peers = new Map<string, PhonePeer>();
  private pendingPairs = new Map<string, { phonePub: string; phoneName: string }>();
  private pendingConfirms = new Map<string, Pending>();
  private greeted = new Set<string>();
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1000;
  private stopped = false;

  constructor(private cfg: Config, private keyPair: Awaited<ReturnType<typeof ensureKeyPair>>['keyPair'], private backend: Backend) {}

  private caps() { return { devMode: this.cfg.devMode, lenovo: this.backend.lenovo, admin: this.backend.admin, hub: true }; }

  /** Zaregistruje notebook na relay a vypíše párovací kód.
   * `force` = vypýtať nový kód aj pri už spárovanom notebooku (--pair). */
  async pairIfNeeded(force = false): Promise<void> {
    const paired = !!(this.cfg.deviceId && this.cfg.laptopToken);
    if (paired && !force) return;
    const base = this.cfg.relayUrl.replace(/^ws/, 'http');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    // existujúci notebook sa musí preukázať tokenom; deviceId bez tokenu = neplatné, začni odznova
    const sendDeviceId = paired ? this.cfg.deviceId! : undefined;
    if (paired) headers.authorization = `Bearer ${this.cfg.laptopToken}`;
    const res = await fetch(`${base}/v1/pair/start`, { method: 'POST', headers, body: JSON.stringify({ deviceId: sendDeviceId, laptopPub: this.keyPair.publicRaw, name: this.cfg.name }) });
    if (!res.ok) throw new Error(`Párovanie s relay zlyhalo (${res.status}). Skontroluj adresu relaya (NS_RELAY) a či beží.`);
    const body = await res.json() as { deviceId: string; laptopToken?: string; code: string };
    this.cfg = { ...this.cfg, deviceId: body.deviceId, laptopToken: body.laptopToken ?? this.cfg.laptopToken };
    saveConfig(this.cfg);
    console.log('\n═══════════════════════════════════════');
    console.log(`  Párovací kód pre mobil:  ${body.code}`);
    console.log('  Zadaj ho v aplikácii Notebook Studio (platí 5 minút).');
    console.log('═══════════════════════════════════════\n');
  }

  connect(): void {
    if (this.stopped) return;
    const url = `${this.cfg.relayUrl}/v1/ws?role=laptop&device=${encodeURIComponent(this.cfg.deviceId!)}`;
    const ws = new WebSocket(url, [`bearer.${this.cfg.laptopToken}`]);
    this.ws = ws;
    ws.on('open', () => { console.log('[agent] pripojený na relay'); this.reconnectDelay = 1000; this.startTelemetry(); this.startHeartbeat(ws); });
    ws.on('pong', () => { this.wsAlive = true; });
    ws.on('message', (raw, isBinary) => { if (!isBinary) void this.onFrame(String(raw)); });
    ws.on('close', (code) => {
      this.cleanupConnection();
      if (code === 4401) { console.error('[agent] relay odmietol token. Spusti agenta s --pair a spáruj znova.'); this.stopped = true; return; }
      const delay = this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      console.log(`[agent] spojenie zatvorené (${code}), skúšam o ${Math.round(delay / 1000)} s`);
      setTimeout(() => this.connect(), delay);
    });
    ws.on('error', (e) => console.error('[agent] chyba spojenia:', (e as Error).message));
  }

  /** Upratanie pri páde spojenia: timery telemetrie a obrazovky, watchdog,
   * a „pozdravené“ telefóny, aby po obnove dostali hello nanovo. */
  private cleanupConnection() {
    this.stopTelemetry();
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    for (const [phoneId, peer] of this.peers) { this.stopScreen(phoneId); if (peer.control.timer) clearTimeout(peer.control.timer); peer.control.timer = null; peer.control.granted = false; peer.control.pending = false; }
    this.greeted.clear();
  }

  /** Watchdog: ak relay neodpovie na ping, spojenie ukončíme (→ reconnect).
   * Chytí polomŕtve spojenie po uspaní notebooku alebo zmene siete. */
  private wsAlive = true;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private startHeartbeat(ws: WebSocket) {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.wsAlive = true;
    this.heartbeat = setInterval(() => {
      if (ws !== this.ws || ws.readyState !== ws.OPEN) return;
      if (!this.wsAlive) { console.log('[agent] relay neodpovedá, obnovujem spojenie'); ws.terminate(); return; }
      this.wsAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }, 25_000);
  }

  private send(frame: unknown) { if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(frame)); }
  private async sendTo(phoneId: string, message: AppMessage) {
    const peer = this.peers.get(phoneId); if (!peer) return;
    try {
      const { n, c } = await peer.session.sealFor(message);
      this.send({ v: 1, t: 'e2e', to: 'phone', peer: phoneId, n, c } satisfies E2EFrame);
    } catch { /* šifrovanie zlyhalo — spojenie sa čoskoro obnoví */ }
  }

  private async onFrame(raw: string) {
    let frame: Frame;
    try { frame = Frame.parse(JSON.parse(raw)); } catch { return; }
    if (frame.t === 'ctl') return this.onCtl(frame);
    if (frame.t === 'e2e' && frame.from === 'phone' && frame.peer) {
      const peer = this.peers.get(frame.peer); if (!peer) return;
      try {
        const message = await peer.session.openFrom(frame.n, frame.c);
        if (message) await this.onMessage(frame.peer, message);
      } catch { /* poškodená alebo podvrhnutá správa */ }
    }
  }

  private async onCtl(frame: CtlFrame) {
    if (frame.op === 'presence') {
      const online = new Set((frame.body.phones as string[] | undefined) ?? []);
      for (const phoneId of online) if (this.peers.has(phoneId) && !this.greeted.has(phoneId)) { this.greeted.add(phoneId); await this.sendHello(phoneId); }
      for (const phoneId of [...this.greeted]) if (!online.has(phoneId)) { this.greeted.delete(phoneId); this.stopScreen(phoneId); }
      return;
    }
    if (frame.op === 'pair.request') {
      const phoneId = String(frame.body.phoneId);
      const phonePub = String(frame.body.phonePub ?? '');
      const phoneName = String(frame.body.phoneName ?? 'mobil');
      if (!phonePub) return;
      this.pendingPairs.set(phoneId, { phonePub, phoneName });
      await this.confirmPairing(phoneId, phoneName, await sas(this.keyPair.publicRaw, phonePub));
    }
  }

  private async confirmPairing(phoneId: string, phoneName: string, code: string) {
    console.log(`\n[párovanie] „${phoneName}“ chce prístup. Overovací kód: ${code}`);
    let accept = SIMULATE;
    if (!SIMULATE && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ans = (await rl.question(`Zhoduje sa kód ${code} s mobilom? [a/N] `)).trim().toLowerCase();
      rl.close();
      accept = ans === 'a' || ans === 'y';
    }
    const pend = this.pendingPairs.get(phoneId);
    this.pendingPairs.delete(phoneId);
    if (!accept || !pend) { console.log('[párovanie] zamietnuté'); return; }
    await this.addPeer({ phoneId, phonePub: pend.phonePub, phoneName });
    // zapamätaj telefón, nech prežije reštart agenta
    this.cfg.phones = [...this.cfg.phones.filter(p => p.phoneId !== phoneId), { phoneId, phonePub: pend.phonePub, phoneName }];
    saveConfig(this.cfg);
    this.send({ v: 1, t: 'ctl', op: 'pair.accepted', body: { phoneId } } satisfies CtlFrame);
    console.log(`[párovanie] „${phoneName}“ pripojený.`);
  }

  /** Vytvorí spojenie s telefónom (session, runner, mozog). Používa sa pri
   * párovaní aj pri obnove spárovaných telefónov po reštarte. */
  private async addPeer(p: { phoneId: string; phonePub: string; phoneName: string }) {
    const session = await PhoneSession.create(this.keyPair, p.phonePub, this.cfg.deviceId!, p.phoneId);
    const runner = new Runner(this.backend, { devMode: this.cfg.devMode }, this.confirmFn(p.phoneId));
    const brain = this.cfg.anthropicApiKey
      ? new Brain(this.caps(), (call, signal) => runner.run(call.command, call.args, 'agent', { signal }), { apiKey: this.cfg.anthropicApiKey, baseURL: this.cfg.anthropicBaseUrl })
      : null;
    this.peers.set(p.phoneId, { session, runner, brain, chats: new Map(), screen: null, control: { granted: false, pending: false, timer: null } });
  }

  /** Obnoví spárované telefóny z konfigurácie (po štarte, pred pripojením). */
  async restorePeers() {
    for (const p of this.cfg.phones) await this.addPeer(p);
    if (this.cfg.phones.length) console.log(`[agent] obnovených spárovaných telefónov: ${this.cfg.phones.length}`);
  }

  private async sendHello(phoneId: string) {
    await this.sendTo(phoneId, msg('hello', {
      agentVersion: '0.1.0', os: SIMULATE ? 'simulácia' : process.platform, host: this.cfg.name,
      capabilities: [], devMode: this.cfg.devMode, lenovo: this.backend.lenovo, admin: this.backend.admin,
    }));
  }

  private confirmFn(phoneId: string): ConfirmFn {
    return ({ title, text, risk }) => new Promise<boolean>((resolve) => {
      const requestId = newId();
      const timer = setTimeout(() => { this.pendingConfirms.delete(requestId); resolve(false); }, 60_000);
      this.pendingConfirms.set(requestId, { resolve, timer });
      void this.sendTo(phoneId, msg('cmd.confirm_required', { requestId, title, text, risk, expiresAt: Date.now() + 60_000 }));
    });
  }

  private async onMessage(phoneId: string, m: AppMessage) {
    const peer = this.peers.get(phoneId); if (!peer) return;
    peer.runner.setDevMode(this.cfg.devMode);
    switch (m.type) {
      case 'cmd': return this.handleCmd(peer, phoneId, m.name, m.args, m.id);
      case 'cmd.confirm': { const p = this.pendingConfirms.get(m.requestId); if (p) { clearTimeout(p.timer); this.pendingConfirms.delete(m.requestId); p.resolve(m.approved); } return; }
      case 'chat.user': return this.handleChat(peer, phoneId, m.convId, m.text);
      case 'chat.cancel': { peer.chats.get(m.convId)?.abort(); return; }
      case 'screen.start': return this.startScreen(peer, phoneId, m);
      case 'screen.stop': return this.stopScreen(phoneId);
      case 'control.request': { void this.handleControlRequest(peer, phoneId); return; }
      case 'control.release': return this.releaseControl(peer, phoneId, 'Ovládanie ukončené z mobilu.');
      case 'input.pointer': case 'input.key': case 'input.text': return this.handleInput(peer, phoneId, m);
      default: return;
    }
  }

  private async handleCmd(peer: PhonePeer, phoneId: string, name: string, args: unknown, requestId: string) {
    const ctx = { signal: new AbortController().signal, onProgress: (percent?: number, text?: string) => void this.sendTo(phoneId, msg('cmd.progress', { requestId, percent, text })) };
    try {
      const data = await peer.runner.run(name, args, 'phone', ctx);
      await this.sendTo(phoneId, msg('cmd.result', { requestId, ok: true, data }));
    } catch (e) {
      const err = e as { code?: string; message?: string };
      await this.sendTo(phoneId, msg('cmd.result', { requestId, ok: false, error: { code: err.code ?? 'failed', message: err.message ?? String(e) } }));
    }
  }

  private async handleChat(peer: PhonePeer, phoneId: string, convId: string, text: string) {
    if (!peer.brain) { await this.sendTo(phoneId, msg('chat.done', { convId, text: '', error: 'AI agent nie je na notebooku nastavený (v konfigurácii chýba anthropicApiKey).' })); return; }
    peer.chats.get(convId)?.abort();               // nová správa ruší predchádzajúcu odpoveď v tej istej konverzácii
    const ctrl = new AbortController();
    peer.chats.set(convId, ctrl);
    peer.brain.setCapabilities(this.caps());
    try {
      const res = await peer.brain.send(convId, text, {
        onText: (delta) => void this.sendTo(phoneId, msg('chat.delta', { convId, text: delta })),
        onTool: (callId, command, label, status) => void this.sendTo(phoneId, msg('chat.tool', { convId, callId, command, label, status })),
      }, ctrl.signal);
      await this.sendTo(phoneId, msg('chat.done', { convId, text: res.text }));
    } catch (e) {
      const err = e as { code?: string; message?: string };
      await this.sendTo(phoneId, msg('chat.done', { convId, text: '', error: err.code === 'cancelled' ? 'Zastavené.' : (err.message ?? 'Chyba AI.') }));
    } finally {
      if (peer.chats.get(convId) === ctrl) peer.chats.delete(convId);
    }
  }

  private async startScreen(peer: PhonePeer, phoneId: string, m: Extract<AppMessage, { type: 'screen.start' }>) {
    this.stopScreen(phoneId);
    let seq = 0, busy = false;
    const period = Math.max(200, Math.round(1000 / m.fps));
    const grab = async () => {
      if (busy) return; busy = true;
      try {
        const shot = await this.backend.run('screen.snapshot', { maxWidth: m.maxWidth }, { signal: new AbortController().signal }) as { jpeg: string; w: number; h: number };
        if (shot.jpeg) await this.sendTo(phoneId, msg('screen.frame', { seq: seq++, w: shot.w, h: shot.h, jpeg: shot.jpeg }));
      } catch { /* snímka zlyhala — skúsi sa o interval neskôr */ } finally { busy = false; }
    };
    void grab();
    peer.screen = setInterval(grab, period);
  }
  private stopScreen(phoneId: string) { const peer = this.peers.get(phoneId); if (peer?.screen) { clearInterval(peer.screen); peer.screen = null; } }

  /** Živé ovládanie sa povolí len po jednom výslovnom potvrdení na notebooku.
   * Bez neho žiadna myš ani klávesa neprejde. Okno sa samo zavrie po čase. */
  private async handleControlRequest(peer: PhonePeer, phoneId: string) {
    if (peer.control.granted) { await this.sendControlState(phoneId, true); return; }
    if (peer.control.pending) return;                         // čaká sa na potvrdenie, druhú výzvu neotváraj
    if (!this.backend.input) { await this.sendControlState(phoneId, false, 'Tento notebook zatiaľ nevie prijímať vzdialený vstup.'); return; }
    peer.control.pending = true;
    const name = this.cfg.phones.find(p => p.phoneId === phoneId)?.phoneName ?? 'mobil';
    void this.backend.run('notify.show', { title: 'Notebook Studio', text: `„${name}“ žiada živé ovládanie (myš a klávesnica).` }, { signal: new AbortController().signal }).catch(() => {});
    const ok = await this.askDevice(`\n[ovládanie] „${name}“ žiada živé ovládanie (myš + klávesnica). Povoliť? [a/N] `);
    peer.control.pending = false;
    if (!this.peers.get(phoneId)) return;                     // telefón sa medzitým odpojil
    if (!ok) { console.log('[ovládanie] zamietnuté'); await this.sendControlState(phoneId, false, 'Ovládanie zamietnuté na notebooku.'); return; }
    peer.control.granted = true;
    if (peer.control.timer) clearTimeout(peer.control.timer);
    peer.control.timer = setTimeout(() => this.releaseControl(peer, phoneId, 'Ovládanie sa po čase automaticky ukončilo.'), CONTROL_GRANT_MS);
    console.log(`[ovládanie] „${name}“ povolené (max ${Math.round(CONTROL_GRANT_MS / 60000)} min).`);
    await this.sendControlState(phoneId, true);
  }

  private releaseControl(peer: PhonePeer, phoneId: string, reason?: string) {
    if (peer.control.timer) { clearTimeout(peer.control.timer); peer.control.timer = null; }
    const was = peer.control.granted;
    peer.control.granted = false;
    if (was) console.log(`[ovládanie] ukončené (${phoneId}).`);
    void this.sendControlState(phoneId, false, reason);
  }

  private async handleInput(peer: PhonePeer, phoneId: string, m: Extract<AppMessage, { type: 'input.pointer' | 'input.key' | 'input.text' }>) {
    if (!peer.control.granted || !this.backend.input) { await this.sendControlState(phoneId, false, 'Vstup zahodený: ovládanie nie je povolené.'); return; }
    try { await this.backend.input(m, { signal: new AbortController().signal }); }
    catch { /* jednu neúspešnú udalosť vstupu ticho zahodíme */ }
  }

  private async sendControlState(phoneId: string, granted: boolean, reason?: string) {
    await this.sendTo(phoneId, msg('control.state', { granted, reason }));
  }

  /** Otázka na notebooku (áno/nie). V simulácii a bez terminálu automaticky povolí,
   * aby sa dalo testovať a ukázať ukážkový režim. */
  private async askDevice(question: string): Promise<boolean> {
    if (SIMULATE || !process.stdin.isTTY) return true;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question(question)).trim().toLowerCase();
    rl.close();
    return ans === 'a' || ans === 'y';
  }

  private startTelemetry() {
    this.stopTelemetry();
    let busy = false;
    const tick = async () => {
      if (busy || this.peers.size === 0) return;
      busy = true;
      try {
        const data = await this.backend.run('system.status', {}, { signal: new AbortController().signal }) as Record<string, unknown>;
        for (const phoneId of this.peers.keys()) await this.sendTo(phoneId, msg('telemetry', { data }));
      } catch { /* ignore */ } finally { busy = false; }
    };
    this.telemetryTimer = setInterval(tick, 3000);
  }
  private stopTelemetry() { if (this.telemetryTimer) clearInterval(this.telemetryTimer); this.telemetryTimer = null; }
}

async function main() {
  const forcePair = process.argv.includes('--pair');
  const loaded = loadConfig();
  // deviceId bez tokenu je neúplný stav (napr. po zlyhaní zápisu) → začni odznova
  if (loaded.deviceId && !loaded.laptopToken) { loaded.deviceId = null; loaded.phones = []; }
  const { cfg, keyPair } = await ensureKeyPair(loaded);
  saveConfig(cfg);

  let backend: Backend;
  if (SIMULATE) { backend = new SimulateBackend(); console.log('[agent] beží v SIMULOVANOM režime (nič sa na notebooku nemení)'); }
  else { const wb = new WindowsBackend({ apps: cfg.apps }); await wb.probe(); backend = wb; console.log(`[agent] Windows backend · admin=${wb.admin} · lenovo=${wb.lenovo}`); }
  if (!cfg.anthropicApiKey) console.log('[agent] bez API kľúča: AI agent je vypnutý, priame príkazy fungujú.');

  const agent = new LaptopAgent(cfg, keyPair, backend);
  await agent.restorePeers();
  await agent.pairIfNeeded(forcePair);
  agent.connect();
}

if (process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });

export { LaptopAgent };
