import Anthropic from '@anthropic-ai/sdk';
import { COMMANDS, argsJsonSchema, fromToolName, parseArgs, toolName, type CommandName } from '@ns/protocol';
import { SYSTEM_PROMPT, allowedCommands, type Capabilities } from './policy.ts';

/**
 * AI mozog agenta. Beží NA NOTEBOOKU: API kľúč nikdy neopustí zariadenie.
 * Rozhoduje, ktorý príkaz z katalógu zavolať; samotné vykonanie robí executor
 * (rovnaká cesta ako tlačidlá v mobile, vrátane potvrdení a auditu).
 *
 * Model: ak nie je nastavený, vyberie sa najnovší model rodiny Opus podľa
 * Models API. Premýšľanie je adaptívne, úsilie nastaviteľné (predvolene medium,
 * aby odpovede pri ovládaní notebooku neboli pomalé).
 */

export interface ToolInvocation { command: CommandName; args: unknown }
/** Vykoná príkaz s plným potvrdzovaním. Vráti dáta, alebo vyhodí chybu s `code`. */
export type Executor = (call: ToolInvocation, signal: AbortSignal) => Promise<unknown>;

export interface AgentEvents {
  onText?: (delta: string, whole: string) => void;
  onTool?: (callId: string, command: CommandName, label: string, status: 'running' | 'done' | 'failed' | 'denied') => void;
}
export interface AgentTurnResult { text: string; toolCalls: number; stopReason: string | null }

export interface AgentOptions {
  apiKey?: string;
  baseURL?: string;
  /** konkrétny model; bez neho sa zvolí najnovší Opus */
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** záložný model na strane servera pri odmietnutí (predvolene zapnuté) */
  fallbacks?: boolean;
  /** na testy: vlastný klient s rovnakým rozhraním */
  client?: Anthropic;
}

type Msg = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

const MAX_ROUNDS = 10;
const MAX_HISTORY = 60;       // pri dlhšej konverzácii sa začne nová (história sa needituje)
const MAX_CONVERSATIONS = 20;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class Agent {
  private client: Anthropic;
  private model: string | null;
  private effort: NonNullable<AgentOptions['effort']>;
  private fallbacks: boolean;
  private convs = new Map<string, Msg[]>();

  constructor(private caps: Capabilities, private exec: Executor, opts: AgentOptions = {}) {
    this.client = opts.client ?? new Anthropic({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      timeout: 180_000,
      maxRetries: 2,
    });
    this.model = opts.model ?? null;
    this.effort = opts.effort ?? 'medium';
    this.fallbacks = opts.fallbacks ?? true;
  }

  setCapabilities(caps: Capabilities) { this.caps = caps; }
  reset(convId?: string) { if (convId) this.convs.delete(convId); else this.convs.clear(); }

  /** Najnovší Opus z Models API (zoznam je zoradený od najnovšieho). */
  async resolveModel(): Promise<string> {
    if (this.model) return this.model;
    let first: string | null = null;
    for await (const m of this.client.models.list({ limit: 50 })) {
      first ??= m.id;
      if (m.id.startsWith('claude-opus')) { this.model = m.id; return m.id; }
    }
    if (!first) throw new Error('Models API nevrátilo žiadny model.');
    this.model = first;
    return first;
  }

  private tools(): Anthropic.Beta.BetaTool[] {
    // agent neponúka zobudenie notebooku (keď beží, notebook je zapnutý)
    const caps = { ...this.caps, hub: false };
    return allowedCommands(caps).map(name => ({
      name: toolName(name),
      description: `${COMMANDS[name].title}. ${COMMANDS[name].description}${COMMANDS[name].risk !== 'safe' ? ' Vyžaduje potvrdenie používateľa v mobile.' : ''}`,
      input_schema: argsJsonSchema(name) as Anthropic.Beta.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
  }

  private history(convId: string): Msg[] {
    let h = this.convs.get(convId);
    if (!h || h.length > MAX_HISTORY) { h = []; this.convs.set(convId, h); }
    // LRU: posledne použitá konverzácia na koniec
    this.convs.delete(convId); this.convs.set(convId, h);
    while (this.convs.size > MAX_CONVERSATIONS) this.convs.delete(this.convs.keys().next().value!);
    return h;
  }

  /** Jedno kolo konverzácie: správa používateľa → (nástroje) → odpoveď. */
  async send(convId: string, userText: string, ev: AgentEvents = {}, signal: AbortSignal = new AbortController().signal): Promise<AgentTurnResult> {
    const hist = this.history(convId);
    const start = hist.length;
    hist.push({ role: 'user', content: userText });
    try {
      return await this.loop(hist, ev, signal);
    } catch (e) {
      hist.length = start; // nedokončené kolo sa zahodí, história ostane platná
      throw e;
    }
  }

  private async loop(hist: Msg[], ev: AgentEvents, signal: AbortSignal): Promise<AgentTurnResult> {
    const model = await this.resolveModel();
    const tools = this.tools();
    const light = model.includes('haiku'); // Haiku nepoužíva adaptívne premýšľanie ani effort
    let whole = '';
    let toolCalls = 0;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal.aborted) throw Object.assign(new Error('Zrušené.'), { code: 'cancelled' });
      const res = await this.request(model, light, tools, hist, signal, (d) => { whole += d; ev.onText?.(d, whole); });
      hist.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] });

      if (res.stop_reason === 'refusal') {
        const t = 'Túto požiadavku nemôžem spracovať. Skús ju formulovať inak alebo ju sprav ručne.';
        ev.onText?.(t, whole + t);
        return { text: t, toolCalls, stopReason: 'refusal' };
      }
      if (res.stop_reason === 'model_context_window_exceeded') {
        return { text: 'Konverzácia je príliš dlhá. Začni prosím novú.', toolCalls, stopReason: res.stop_reason };
      }
      if (res.stop_reason === 'pause_turn') continue;

      const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('').trim();
        return { text: text || whole.trim(), toolCalls, stopReason: res.stop_reason };
      }

      // všetky výsledky nástrojov v jednej správe používateľa
      const results: ToolResult[] = [];
      for (const tu of toolUses) {
        toolCalls++;
        results.push(await this.runTool(tu, ev, signal));
      }
      hist.push({ role: 'user', content: results });
      if (whole && !whole.endsWith('\n')) { whole += '\n'; }
    }
    return { text: whole.trim() || 'Úloha má priveľa krokov. Rozdeľ ju prosím na menšie časti.', toolCalls, stopReason: 'max_rounds' };
  }

  private async request(model: string, light: boolean, tools: Anthropic.Beta.BetaTool[], hist: Msg[], signal: AbortSignal, onDelta: (d: string) => void): Promise<Anthropic.Beta.BetaMessage> {
    const attempt = async (withFallbacks: boolean) => {
      const params = {
        model,
        max_tokens: 16000,
        system: [{ type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } }],
        tools,
        messages: hist,
        ...(light ? {} : { thinking: { type: 'adaptive' as const }, output_config: { effort: this.effort } }),
        ...(withFallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      };
      const stream = this.client.beta.messages.stream(params as Anthropic.Beta.MessageCreateParamsStreaming, { signal });
      stream.on('text', onDelta);
      return stream.finalMessage();
    };
    if (!this.fallbacks) return attempt(false);
    try {
      return await attempt(true);
    } catch (e) {
      // niektoré modely/účty záložný model nepodporujú → natrvalo vypnúť a skúsiť bez neho
      if (e instanceof Anthropic.BadRequestError) { this.fallbacks = false; return attempt(false); }
      throw e;
    }
  }

  private async runTool(tu: Anthropic.Beta.BetaToolUseBlock, ev: AgentEvents, signal: AbortSignal): Promise<ToolResult> {
    const command = fromToolName(tu.name);
    if (!command) return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Neznámy nástroj: ${tu.name}` };
    const label = COMMANDS[command].title;
    ev.onTool?.(tu.id, command, label, 'running');
    try {
      // vstupy zo streamovania nie sú overené serverom — overíme ich podľa katalógu
      const args = parseArgs(command, tu.input);
      const data = await this.exec({ command, args }, signal);
      ev.onTool?.(tu.id, command, label, 'done');
      return { type: 'tool_result', tool_use_id: tu.id, content: toolContent(data) };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const denied = err.code === 'denied_by_user' || err.code === 'confirm_timeout';
      ev.onTool?.(tu.id, command, label, denied ? 'denied' : 'failed');
      return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Chyba (${err.code ?? 'failed'}): ${err.message ?? String(e)}` };
    }
  }
}

/** Výsledok nástroja pre model: snímku obrazovky ako obrázok, ostatné ako krátky JSON. */
function toolContent(data: unknown): ToolResult['content'] {
  const d = data as { jpeg?: unknown; w?: unknown; h?: unknown } | null;
  if (d && typeof d.jpeg === 'string' && d.jpeg.length > 100) {
    return [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d.jpeg } },
      { type: 'text', text: `Snímka obrazovky ${d.w}×${d.h}.` },
    ];
  }
  const s = JSON.stringify(data ?? null);
  return s.length <= 6000 ? s : JSON.stringify({ truncated: true, preview: s.slice(0, 6000) });
}
