import Anthropic from '@anthropic-ai/sdk';
import { COMMANDS, argsJsonSchema, fromToolName, parseArgs, toolName, type CommandName } from '@ns/protocol';
import { SYSTEM_PROMPT, allowedCommands, type Capabilities } from './policy.ts';

/**
 * AI mozog agenta. Beží NA NOTEBOOKU: API kľúč nikdy neopustí zariadenie.
 * Rozhoduje, ktorý príkaz z katalógu zavolať; samotné vykonanie robí executor,
 * ktorý mu odovzdá agent na notebooku (rovnaká cesta ako tlačidlá v mobile,
 * vrátane potvrdení).
 */

export interface ToolInvocation {
  command: CommandName;
  args: unknown;
}
/** Vykoná príkaz s plným potvrdzovaním. Vráti dáta, alebo vyhodí chybu. */
export type Executor = (call: ToolInvocation, signal: AbortSignal) => Promise<unknown>;

export interface AgentEvents {
  onText?: (delta: string, whole: string) => void;
  onTool?: (callId: string, command: CommandName, label: string, status: 'running' | 'done' | 'failed' | 'denied') => void;
}

export interface AgentTurnResult {
  text: string;
  toolCalls: number;
  stopReason: string | null;
}

const MODEL = 'claude-opus-4-8';
const MAX_ROUNDS = 8;

export class Agent {
  private client: Anthropic;
  private history: Anthropic.MessageParam[] = [];

  constructor(
    apiKey: string,
    private caps: Capabilities,
    private exec: Executor,
    opts: { baseURL?: string; model?: string } = {},
  ) {
    this.client = new Anthropic({ apiKey, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) });
    this.model = opts.model ?? MODEL;
  }
  private model: string;

  setCapabilities(caps: Capabilities) { this.caps = caps; }
  reset() { this.history = []; }

  private tools(): Anthropic.Tool[] {
    return allowedCommands(this.caps).map(name => ({
      name: toolName(name),
      description: `${COMMANDS[name].title}. ${COMMANDS[name].description}`,
      input_schema: argsJsonSchema(name) as Anthropic.Tool.InputSchema,
    }));
  }

  /** Jedno kolo konverzácie: používateľova správa → (nástroje) → odpoveď. */
  async send(userText: string, ev: AgentEvents = {}, signal = new AbortController().signal): Promise<AgentTurnResult> {
    this.history.push({ role: 'user', content: userText });
    const tools = this.tools();
    let whole = '';
    let toolCalls = 0;
    let stopReason: string | null = null;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal.aborted) throw new Error('cancelled');
      const stream = this.client.messages.stream(
        { model: this.model, max_tokens: 1024, system: SYSTEM_PROMPT, tools, messages: this.history },
        { signal },
      );
      stream.on('text', (delta) => { whole += delta; ev.onText?.(delta, whole); });
      const res = await stream.finalMessage();
      this.history.push({ role: 'assistant', content: res.content });
      stopReason = res.stop_reason;

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const finalText = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
        return { text: finalText || whole, toolCalls, stopReason };
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        toolCalls++;
        const command = fromToolName(tu.name);
        const callId = tu.id;
        if (!command) { ev.onTool?.(callId, 'system.status', tu.name, 'failed'); results.push({ type: 'tool_result', tool_use_id: callId, is_error: true, content: `Neznámy nástroj: ${tu.name}` }); continue; }
        const label = COMMANDS[command].title;
        ev.onTool?.(callId, command, label, 'running');
        try {
          const args = parseArgs(command, tu.input);
          const data = await this.exec({ command, args }, signal);
          ev.onTool?.(callId, command, label, 'done');
          results.push({ type: 'tool_result', tool_use_id: callId, content: JSON.stringify(clip(data)) });
        } catch (e) {
          const err = e as { code?: string; message?: string };
          const denied = err.code === 'denied_by_user' || err.code === 'confirm_timeout';
          ev.onTool?.(callId, command, label, denied ? 'denied' : 'failed');
          results.push({ type: 'tool_result', tool_use_id: callId, is_error: true, content: `Chyba (${err.code ?? 'failed'}): ${err.message ?? String(e)}` });
        }
      }
      this.history.push({ role: 'user', content: results });
      whole += whole && !whole.endsWith('\n') ? '\n' : '';
    }
    return { text: whole || 'Prekročil sa počet krokov. Skús úlohu rozdeliť na menšie časti.', toolCalls, stopReason };
  }
}

/** Výsledky nástrojov držíme malé, aby sa nezahltil kontext. */
function clip(data: unknown, max = 6000): unknown {
  const s = JSON.stringify(data);
  if (s.length <= max) return data;
  return { truncated: true, preview: s.slice(0, max) };
}
