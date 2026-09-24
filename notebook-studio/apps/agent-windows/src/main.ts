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

interface Pending { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
/** Všetko, čo agent drží pre jeden spárovaný telefón. */
interface PhonePeer {
  session: PhoneSession;
  runner: Runner;
  brain: Brain | null;
  chats: Map<string, AbortController>;   // podľa convId
  screen: ReturnType<typeof setInterval> | null;
}

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

  async pairIfNeeded(): Promise<void> {
    if (this.cfg.deviceId && this.cfg.laptopToken) return;
    const base = this.cfg.relayUrl.replace(/^ws/, 'http');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cfg.deviceId && this.cfg.laptopToken) headers.authorization = `Bearer ${this.cfg.laptopToken}`;
    const res = await fetch(`${base}/v1/pair/start`, { method: 'POST', headers, body: JSON.stringify({ deviceId: this.cfg.deviceId ?? undefined, laptopPub: this.keyPair.publicRaw, name: this.cfg.name }) });
    if (!res.ok) throw new Error(`Párovanie s relay zlyhalo (${res.status}). Skontroluj NS_RELAY.`);
    const body = await res.json() as { deviceId: string; laptopToken?: string; code: string };
    this.cfg = { ...this.cfg, deviceId: body.deviceId, laptopToken: body.laptopToken ?? this.cfg.laptopToken };
    await saveConfig(this.cfg);
    console.log('\n═══════════════════════════════════════');
    console.log(`  Párovací kód pre mobil:  ${body.code}`);
    console.log('  Zadaj ho v aplikácii Notebook Studio.');
    console.log('═══════════════════════════════════════\n');
  }

  connect(): void {
    if (this.stopped) return;
    const url = `${this.cfg.relayUrl}/v1/ws?role=laptop&device=${encodeURIComponent(this.cfg.deviceId!)}`;
    const ws = new WebSocket(url, [`bearer.${this.cfg.laptopToken}`]);
    this.ws = ws;
    ws.on('open', () => { console.log('[agent] pripojený na relay'); this.reconnectDelay = 1000; this.startTelemetry(); });
    ws.on('message', (raw, isBinary) => { if (!isBinary) void this.onFrame(String(raw)); });
    ws.on('close', (code) => {
      this.stopTelemetry();
      if (code === 4401) { console.error('[agent] relay odmietol token. Zmaž deviceId/laptopToken z konfigurácie a spáruj znova.'); this.stopped = true; return; }
      const delay = this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      console.log(`[agent] spojenie zatvorené (${code}), skúšam o ${Math.round(delay / 1000)} s`);
      setTimeout(() => this.connect(), delay);
    });
    ws.on('error', (e) => console.error('[agent] chyba spojenia:', (e as Error).message));
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
    const session = await PhoneSession.create(this.keyPair, pend.phonePub, this.cfg.deviceId!, phoneId);
    const confirm = this.confirmFn(phoneId);
    const runner = new Runner(this.backend, { devMode: this.cfg.devMode }, confirm);
    const brain = this.cfg.anthropicApiKey
      ? new Brain(this.caps(), (call, signal) => runner.run(call.command, call.args, 'agent', { signal }), { apiKey: this.cfg.anthropicApiKey, baseURL: this.cfg.anthropicBaseUrl })
      : null;
    this.peers.set(phoneId, { session, runner, brain, chats: new Map(), screen: null });
    this.send({ v: 1, t: 'ctl', op: 'pair.accepted', body: { phoneId } } satisfies CtlFrame);
    console.log(`[párovanie] „${phoneName}“ pripojený.`);
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
      case 'input.pointer': case 'input.key': case 'input.text': return; // vzdialený vstup pridá Windows backend v ďalšej verzii
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
  const loaded = await loadConfig();
  const { cfg, keyPair } = await ensureKeyPair(loaded);
  await saveConfig(cfg);

  let backend: Backend;
  if (SIMULATE) { backend = new SimulateBackend(); console.log('[agent] beží v SIMULOVANOM režime (nič sa na notebooku nemení)'); }
  else { const wb = new WindowsBackend({ apps: cfg.apps }); await wb.probe(); backend = wb; console.log(`[agent] Windows backend · admin=${wb.admin} · lenovo=${wb.lenovo}`); }
  if (!cfg.anthropicApiKey) console.log('[agent] bez API kľúča: AI agent je vypnutý, priame príkazy fungujú.');

  const agent = new LaptopAgent(cfg, keyPair, backend);
  await agent.pairIfNeeded();
  agent.connect();
}

if (process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });

export { LaptopAgent };
