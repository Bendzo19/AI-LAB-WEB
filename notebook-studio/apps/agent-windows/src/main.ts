import { createInterface } from 'node:readline/promises';
import { WebSocket } from 'ws';
import {
  type AppMessage, type CtlFrame, type E2EFrame, Frame, newId, msg, sas, type CommandName,
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

class LaptopAgent {
  private ws: WebSocket | null = null;
  private sessions = new Map<string, PhoneSession>();
  private pendingPairs = new Map<string, { phonePub: string; phoneName: string }>();
  private pendingConfirms = new Map<string, Pending>();
  private brain: Brain | null = null;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private cfg: Config, private keyPair: Awaited<ReturnType<typeof ensureKeyPair>>['keyPair'], private backend: Backend, private runner: Runner) {}

  private caps() {
    return { devMode: this.cfg.devMode, lenovo: this.backend.lenovo, admin: this.backend.admin, hub: true };
  }

  async pairIfNeeded(): Promise<void> {
    if (this.cfg.deviceId && this.cfg.laptopToken) return;
    const base = this.cfg.relayUrl.replace(/^ws/, 'http');
    const res = await fetch(`${base}/v1/pair/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: this.cfg.deviceId ?? undefined, laptopPub: this.keyPair.publicRaw, name: this.cfg.name }) });
    const body = await res.json() as { deviceId: string; laptopToken?: string; code: string };
    this.cfg = { ...this.cfg, deviceId: body.deviceId, laptopToken: body.laptopToken ?? this.cfg.laptopToken };
    await saveConfig(this.cfg);
    console.log('\n═══════════════════════════════════════');
    console.log(`  Párovací kód pre mobil:  ${body.code}`);
    console.log('  Zadaj ho v aplikácii Notebook Studio.');
    console.log('═══════════════════════════════════════\n');
  }

  connect(): void {
    const url = `${this.cfg.relayUrl}/v1/ws?role=laptop&device=${encodeURIComponent(this.cfg.deviceId!)}`;
    const ws = new WebSocket(url, [`bearer.${this.cfg.laptopToken}`]);
    this.ws = ws;
    ws.on('open', () => { console.log('[agent] pripojený na relay'); this.startTelemetry(); });
    ws.on('message', (raw) => this.onFrame(String(raw)));
    ws.on('close', () => { console.log('[agent] spojenie zatvorené, skúšam o 5 s'); this.stopTelemetry(); setTimeout(() => this.connect(), 5000); });
    ws.on('error', (e) => console.error('[agent] chyba:', (e as Error).message));
  }

  private send(frame: unknown) { if (this.ws?.readyState === this.ws?.OPEN) this.ws!.send(JSON.stringify(frame)); }
  private async sendTo(phoneId: string, message: AppMessage) {
    const s = this.sessions.get(phoneId); if (!s) return;
    const { n, c } = await s.sealFor(message);
    this.send({ v: 1, t: 'e2e', to: 'phone', peer: phoneId, n, c } satisfies E2EFrame);
  }

  private async onFrame(raw: string) {
    let frame: Frame;
    try { frame = Frame.parse(JSON.parse(raw)); } catch { return; }
    if (frame.t === 'ctl') return this.onCtl(frame);
    if (frame.t === 'e2e' && frame.from === 'phone' && frame.peer) {
      const s = this.sessions.get(frame.peer); if (!s) return;
      try {
        const message = await s.openFrom(frame.n, frame.c);
        if (message) await this.onMessage(frame.peer, message);
      } catch { /* poškodená alebo podvrhnutá správa — ignoruj */ }
    }
  }

  private greeted = new Set<string>();
  private async onCtl(frame: CtlFrame) {
    if (frame.op === 'presence') {
      const online = new Set((frame.body.phones as string[] | undefined) ?? []);
      for (const phoneId of online) if (this.sessions.has(phoneId) && !this.greeted.has(phoneId)) { this.greeted.add(phoneId); await this.sendHello(phoneId); }
      for (const phoneId of [...this.greeted]) if (!online.has(phoneId)) this.greeted.delete(phoneId);
      return;
    }
    if (frame.op === 'pair.request') {
      const phoneId = String(frame.body.phoneId);
      const phonePub = String(frame.body.phonePub);
      const phoneName = String(frame.body.phoneName ?? 'mobil');
      this.pendingPairs.set(phoneId, { phonePub, phoneName });
      const code = await sas(this.keyPair.publicRaw, phonePub);
      await this.confirmPairing(phoneId, phoneName, code);
    }
  }

  /** Overenie párovania kódom SAS. V simulácii sa prijme automaticky. */
  private async confirmPairing(phoneId: string, phoneName: string, code: string) {
    console.log(`\n[párovanie] „${phoneName}“ chce prístup. Overovací kód: ${code}`);
    let accept = SIMULATE;
    if (!SIMULATE && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ans = (await rl.question(`Zhoduje sa kód ${code} s mobilom? [a/N] `)).trim().toLowerCase();
      rl.close();
      accept = ans === 'a' || ans === 'y';
    }
    if (!accept) { console.log('[párovanie] zamietnuté'); this.pendingPairs.delete(phoneId); return; }
    const pend = this.pendingPairs.get(phoneId); if (!pend) return;
    const session = await PhoneSession.create(this.keyPair, pend.phonePub, this.cfg.deviceId!, phoneId);
    this.sessions.set(phoneId, session);
    this.pendingPairs.delete(phoneId);
    this.send({ v: 1, t: 'ctl', op: 'pair.accepted', body: { phoneId } } satisfies CtlFrame);
    console.log(`[párovanie] „${phoneName}“ pripojený.`);
    // hello pošleme, keď relay potvrdí, že telefón je online (presence)
  }

  private async sendHello(phoneId: string) {
    await this.sendTo(phoneId, msg('hello', {
      agentVersion: '0.1.0', os: SIMULATE ? 'simulácia' : `${process.platform}`, host: this.cfg.name,
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
    switch (m.type) {
      case 'cmd': return this.handleCmd(phoneId, m.name, m.args, m.id);
      case 'cmd.confirm': { const p = this.pendingConfirms.get(m.requestId); if (p) { clearTimeout(p.timer); this.pendingConfirms.delete(m.requestId); p.resolve(m.approved); } return; }
      case 'chat.user': return this.handleChat(phoneId, m.convId, m.text);
      case 'chat.cancel': return; // TODO: prepojiť na AbortController konverzácie
      case 'screen.start': case 'screen.stop': return this.handleScreen(phoneId, m);
      case 'input.pointer': case 'input.key': case 'input.text': return; // vstup rieši Windows backend v ďalšej verzii
      default: return;
    }
  }

  private async handleCmd(phoneId: string, name: string, args: unknown, requestId: string) {
    const runner = new Runner(this.backend, { devMode: this.cfg.devMode }, this.confirmFn(phoneId));
    const ctx = { signal: new AbortController().signal, onProgress: (percent?: number, text?: string) => void this.sendTo(phoneId, msg('cmd.progress', { requestId, percent, text })) };
    try {
      // vývojársky režim aj audit zdieľame cez hlavný runner
      const data = await this.runnerFor(phoneId).run(name, args, 'phone', ctx);
      await this.sendTo(phoneId, msg('cmd.result', { requestId, ok: true, data }));
    } catch (e) {
      const err = e as { code?: string; message?: string };
      await this.sendTo(phoneId, msg('cmd.result', { requestId, ok: false, error: { code: err.code ?? 'failed', message: err.message ?? String(e) } }));
    }
    void runner;
  }

  /** Runner na telefón s jeho vlastnou funkciou potvrdenia. */
  private runnersByPhone = new Map<string, Runner>();
  private runnerFor(phoneId: string): Runner {
    let r = this.runnersByPhone.get(phoneId);
    if (!r) { r = new Runner(this.backend, { devMode: this.cfg.devMode }, this.confirmFn(phoneId), (e) => { void e; }); this.runnersByPhone.set(phoneId, r); }
    r.setDevMode(this.cfg.devMode);
    return r;
  }

  private async handleChat(phoneId: string, convId: string, text: string) {
    if (!this.brain) { await this.sendTo(phoneId, msg('chat.done', { convId, text: '', error: 'AI agent nie je na notebooku nastavený (chýba API kľúč v konfigurácii).' })); return; }
    this.brain.setCapabilities(this.caps());
    const runner = this.runnerFor(phoneId);
    const ctrl = new AbortController();
    try {
      const res = await this.brain.send(text, {
        onText: (delta) => void this.sendTo(phoneId, msg('chat.delta', { convId, text: delta })),
        onTool: (callId, command, label, status) => void this.sendTo(phoneId, msg('chat.tool', { convId, callId, command, label, status })),
      }, ctrl.signal);
      await this.sendTo(phoneId, msg('chat.done', { convId, text: res.text }));
    } catch (e) {
      await this.sendTo(phoneId, msg('chat.done', { convId, text: '', error: (e as Error).message }));
    }
    // executor mozgu smeruje na runner tohto telefónu
    void runner;
  }

  private async handleScreen(phoneId: string, m: AppMessage) {
    if (m.type === 'screen.start') {
      const shot = await this.backend.run('screen.snapshot', { maxWidth: m.maxWidth }, { signal: new AbortController().signal }) as { jpeg: string; w: number; h: number };
      await this.sendTo(phoneId, msg('screen.frame', { seq: 0, w: shot.w, h: shot.h ?? 720, jpeg: shot.jpeg }));
    }
  }

  private startTelemetry() {
    this.stopTelemetry();
    const tick = async () => {
      if (this.sessions.size === 0) return;
      try {
        const data = await this.backend.run('system.status', {}, { signal: new AbortController().signal });
        for (const phoneId of this.sessions.keys()) await this.sendTo(phoneId, msg('telemetry', { data: data as Record<string, unknown> }));
      } catch { /* ignore */ }
    };
    this.telemetryTimer = setInterval(tick, 3000);
  }
  private stopTelemetry() { if (this.telemetryTimer) clearInterval(this.telemetryTimer); this.telemetryTimer = null; }

  attachBrain() {
    if (!this.cfg.anthropicApiKey) return;
    const executor = (call: { command: CommandName; args: unknown }, signal: AbortSignal) => {
      // AI nástroje idú cez ten istý runner (potvrdenia, audit); potvrdenie
      // sa nasmeruje na telefón, ktorý práve chatuje — zjednodušene na prvý.
      const phoneId = [...this.sessions.keys()][0];
      const runner = phoneId ? this.runnerFor(phoneId) : new Runner(this.backend, { devMode: this.cfg.devMode }, async () => false);
      return runner.run(call.command, call.args, 'agent', { signal });
    };
    this.brain = new Brain(this.cfg.anthropicApiKey, this.caps(), executor, { baseURL: this.cfg.anthropicBaseUrl });
  }
}

async function main() {
  const loaded = await loadConfig();
  const { cfg, keyPair } = await ensureKeyPair(loaded);
  await saveConfig(cfg);

  let backend: Backend;
  if (SIMULATE) { backend = new SimulateBackend(); console.log('[agent] beží v SIMULOVANOM režime (nič sa na notebooku nemení)'); }
  else { const wb = new WindowsBackend({ apps: cfg.apps }); await wb.probe(); backend = wb; console.log(`[agent] Windows backend · admin=${wb.admin} · lenovo=${wb.lenovo}`); }

  const runner = new Runner(backend, { devMode: cfg.devMode }, async () => false);
  const agent = new LaptopAgent(cfg, keyPair, backend, runner);
  agent.attachBrain();
  await agent.pairIfNeeded();
  agent.connect();
}

if (process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });

export { LaptopAgent };
