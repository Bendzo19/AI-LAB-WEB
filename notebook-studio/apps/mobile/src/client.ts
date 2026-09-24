import {
  type AppMessage, type CtlFrame, type E2EFrame, type Frame, PROTOCOL_VERSION,
  aadFor, deriveSessionKey, exportPrivateKey, generateKeyPair, importKeyPair, msg, open, seal,
  type KeyPair, ReplayGuard,
} from '@ns/protocol';

/**
 * Klient pre mobilnú aplikáciu (PWA). Rieši párovanie, šifrované spojenie s
 * notebookom cez relay a odosielanie príkazov, chatu a čítanie telemetrie.
 * Nezávislý od DOM, aby sa dal testovať aj použiť v rôznych UI vrstvách.
 */

export interface StoredIdentity { deviceId: string; phoneId: string; phoneToken: string; laptopPub: string; laptopName: string; privateJwk: JsonWebKey }

export interface ClientEvents {
  onTelemetry?: (data: Record<string, unknown>) => void;
  onHello?: (info: { host: string; devMode: boolean; lenovo: boolean; admin: boolean }) => void;
  onConfirmRequired?: (req: { requestId: string; title: string; text: string; risk: 'confirm' | 'danger'; expiresAt: number }) => void;
  onChatDelta?: (convId: string, text: string) => void;
  onChatTool?: (convId: string, callId: string, command: string, label: string, status: string) => void;
  onChatDone?: (convId: string, text: string, error?: string) => void;
  onScreenFrame?: (jpeg: string, w: number, h: number) => void;
  onStatus?: (status: 'connecting' | 'online' | 'offline' | 'revoked') => void;
}

type WSFactory = (url: string, protocols?: string[]) => WebSocketLike;
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', fn: (ev: { data?: unknown }) => void): void;
}

const OPEN = 1;

export class NotebookClient {
  private ws: WebSocketLike | null = null;
  private keyPair!: KeyPair;
  private key: CryptoKey | null = null;
  private guard = new ReplayGuard();
  private pending = new Map<string, { resolve: (v: { ok: boolean; data?: unknown; error?: { code: string; message: string } }) => void }>();

  constructor(
    private relayHttp: string,
    private relayWs: string,
    private id: StoredIdentity | null,
    private ev: ClientEvents = {},
    private wsFactory: WSFactory = (u, p) => new WebSocket(u, p) as unknown as WebSocketLike,
    private fetchFn: typeof fetch = fetch,
  ) {}

  isPaired(): boolean { return this.id !== null; }

  /** Krok 1: mobil zadá párovací kód z notebooku a odošle svoj verejný kľúč. */
  async pair(code: string, phoneName: string): Promise<{ deviceId: string; phoneId: string; sas: string }> {
    this.keyPair = await generateKeyPair();
    const res = await this.fetchFn(`${this.relayHttp}/v1/pair/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, phonePub: this.keyPair.publicRaw, phoneName }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Párovanie zlyhalo.');
    const b = await res.json() as { deviceId: string; laptopPub: string; laptopName: string; phoneId: string; phoneToken: string };
    this.id = { deviceId: b.deviceId, phoneId: b.phoneId, phoneToken: b.phoneToken, laptopPub: b.laptopPub, laptopName: b.laptopName, privateJwk: await exportPrivateKey(this.keyPair) };
    const { sas } = await import('@ns/protocol');
    return { deviceId: b.deviceId, phoneId: b.phoneId, sas: await sas(this.keyPair.publicRaw, b.laptopPub) };
  }

  /** Uloženie identity (mobil ju dá do IndexedDB/localStorage). */
  identity(): StoredIdentity | null { return this.id; }

  async connect(): Promise<void> {
    if (!this.id) throw new Error('Najprv spáruj notebook.');
    this.keyPair ??= await importKeyPair(this.id.privateJwk);
    this.key = await deriveSessionKey(this.keyPair, this.id.laptopPub, this.id.deviceId);
    this.ev.onStatus?.('connecting');
    const url = `${this.relayWs}/v1/ws?role=phone&device=${encodeURIComponent(this.id.deviceId)}&phone=${encodeURIComponent(this.id.phoneId)}`;
    const ws = this.wsFactory(url, [`bearer.${this.id.phoneToken}`]);
    this.ws = ws;
    ws.addEventListener('open', () => this.ev.onStatus?.('online'));
    ws.addEventListener('close', () => { this.ev.onStatus?.('offline'); });
    ws.addEventListener('error', () => { this.ev.onStatus?.('offline'); });
    ws.addEventListener('message', (e) => void this.onRaw(String(e.data)));
  }
  disconnect() { this.ws?.close(); this.ws = null; }

  private async onRaw(raw: string) {
    let frame: Frame;
    try { frame = JSON.parse(raw); } catch { return; }
    if (frame.t === 'ctl') {
      if (frame.op === 'revoked') { this.ev.onStatus?.('revoked'); this.disconnect(); }
      return;
    }
    if (frame.t === 'e2e' && this.key) {
      try {
        const m = await open(this.key, frame.n, frame.c, aadFor(this.id!.deviceId, 'laptop', 'phone', this.id!.phoneId)) as AppMessage;
        if (typeof m?.id !== 'string' || !this.guard.accept(m.id, m.ts)) return;
        this.onMessage(m);
      } catch { /* poškodená správa */ }
    }
  }

  private onMessage(m: AppMessage) {
    switch (m.type) {
      case 'telemetry': return this.ev.onTelemetry?.(m.data);
      case 'hello': return this.ev.onHello?.({ host: m.host, devMode: m.devMode, lenovo: m.lenovo, admin: m.admin });
      case 'cmd.confirm_required': return this.ev.onConfirmRequired?.({ requestId: m.requestId, title: m.title, text: m.text, risk: m.risk, expiresAt: m.expiresAt });
      case 'cmd.result': { const p = this.pending.get(m.requestId); if (p) { this.pending.delete(m.requestId); p.resolve({ ok: m.ok, data: m.data, error: m.error }); } return; }
      case 'chat.delta': return this.ev.onChatDelta?.(m.convId, m.text);
      case 'chat.tool': return this.ev.onChatTool?.(m.convId, m.callId, m.command, m.label, m.status);
      case 'chat.done': return this.ev.onChatDone?.(m.convId, m.text, m.error);
      case 'screen.frame': return this.ev.onScreenFrame?.(m.jpeg, m.w, m.h);
      default: return;
    }
  }

  private async sealSend(message: AppMessage) {
    if (!this.key || this.ws?.readyState !== OPEN) throw new Error('Nie je spojenie s notebookom.');
    const { n, c } = await seal(this.key, message, aadFor(this.id!.deviceId, 'phone', 'laptop', this.id!.phoneId));
    this.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'e2e', to: 'laptop', n, c } satisfies E2EFrame));
  }

  /** Odošle príkaz a počká na výsledok (potvrdenia rieši onConfirmRequired + confirm). */
  async command(name: string, args: unknown = {}): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }> {
    const m = msg('cmd', { name, args });
    const p = new Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }>((resolve) => this.pending.set(m.id, { resolve }));
    await this.sealSend(m);
    return p;
  }
  async confirm(requestId: string, approved: boolean) { await this.sealSend(msg('cmd.confirm', { requestId, approved })); }
  async chat(convId: string, text: string) { await this.sealSend(msg('chat.user', { convId, text })); }
  async cancelChat(convId: string) { await this.sealSend(msg('chat.cancel', { convId })); }
  async startScreen(opts: { fps?: number; maxWidth?: number } = {}) { await this.sealSend(msg('screen.start', { fps: opts.fps ?? 4, quality: 60, maxWidth: opts.maxWidth ?? 1280, display: 0 })); }
  async stopScreen() { await this.sealSend(msg('screen.stop', {})); }

  /** Požiadať zobúdzač o zapnutie notebooku (ctl mimo e2e). */
  async wake() { if (this.ws?.readyState === OPEN) this.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'ctl', op: 'wake', body: {} } satisfies CtlFrame)); }
}
