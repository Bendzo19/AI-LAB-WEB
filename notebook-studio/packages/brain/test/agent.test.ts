import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { Agent } from '../src/agent.ts';
import { FakeExecutor } from '../src/eval/fake-executor.ts';

/**
 * Falošný klient Anthropic: vracia vopred pripravené odpovede, zaznamenáva
 * požiadavky. Overuje slučku nástrojov bez volania skutočnej AI.
 */
type Reply = Partial<Anthropic.Beta.BetaMessage> & { content: Anthropic.Beta.BetaContentBlock[] } | Error;
function fakeClient(replies: Reply[], models = ['claude-haiku-x', 'claude-opus-x', 'claude-opus-older']) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    models: { async *list() { for (const id of models) yield { id }; } },
    beta: { messages: { stream(params: Record<string, unknown>) {
      requests.push(structuredClone(params));
      const r = replies.shift();
      const handlers: ((d: string) => void)[] = [];
      return {
        on(ev: string, fn: (d: string) => void) { if (ev === 'text') handlers.push(fn); return this; },
        async finalMessage() {
          if (!r) throw new Error('žiadna ďalšia odpoveď');
          if (r instanceof Error) throw r;
          for (const b of r.content) if (b.type === 'text') handlers.forEach(h => h(b.text));
          return { stop_reason: 'end_turn', ...r } as Anthropic.Beta.BetaMessage;
        },
      };
    } } },
  };
  return { client: client as unknown as Anthropic, requests };
}
const text = (t: string) => ({ type: 'text', text: t, citations: null } as Anthropic.Beta.BetaTextBlock);
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input } as Anthropic.Beta.BetaToolUseBlock);
const CAPS = { devMode: false, lenovo: true, admin: true, hub: true };

describe('Agent — slučka nástrojov', () => {
  it('zavolá nástroj, vráti výsledok modelu a dokončí odpoveď', async () => {
    const fx = new FakeExecutor();
    const { client, requests } = fakeClient([
      { content: [text('Pozriem stav. '), toolUse('t1', 'system__status', {})], stop_reason: 'tool_use' },
      { content: [text('Batéria má 86 %.')], stop_reason: 'end_turn' },
    ]);
    const tools: string[] = [];
    const agent = new Agent(CAPS, fx.exec, { client });
    const res = await agent.send('c1', 'Aký je stav?', { onTool: (_i, c, _l, s) => tools.push(`${c}:${s}`) });
    expect(res.text).toBe('Batéria má 86 %.');
    expect(fx.used('system.status')).toBe(true);
    expect(tools).toEqual(['system.status:running', 'system.status:done']);
    // model sa vybral automaticky: prvý Opus zo zoznamu
    expect(requests[0]!.model).toBe('claude-opus-x');
    expect(requests[0]!.thinking).toEqual({ type: 'adaptive' });
    expect(requests[0]!.fallbacks).toBe('default');
    // druhá požiadavka obsahuje výsledok nástroja
    const msgs = requests[1]!.messages as Anthropic.Beta.BetaMessageParam[];
    const last = msgs[msgs.length - 1]!;
    expect(Array.isArray(last.content) && (last.content[0] as { type: string }).type).toBe('tool_result');
  });

  it('neponúka zobudenie ani vývojárske nástroje bez dev režimu', async () => {
    const { client, requests } = fakeClient([{ content: [text('ok')] }]);
    await new Agent(CAPS, new FakeExecutor().exec, { client }).send('c', 'ahoj');
    const names = (requests[0]!.tools as { name: string }[]).map(t => t.name);
    expect(names).not.toContain('power__wake');
    expect(names).not.toContain('terminal__run');
    expect(names).toContain('system__status');
    expect((requests[0]!.tools as { eager_input_streaming: boolean }[])[0]!.eager_input_streaming).toBe(true);
  });

  it('zamietnutie od používateľa sa modelu vráti ako chyba a agent pokračuje', async () => {
    const fx = new FakeExecutor();
    fx.denyConfirmFor.add('power.shutdown');
    const { client, requests } = fakeClient([
      { content: [toolUse('t1', 'power__shutdown', {})], stop_reason: 'tool_use' },
      { content: [text('Vypnutie bolo zrušené.')] },
    ]);
    const statuses: string[] = [];
    const res = await new Agent(CAPS, fx.exec, { client }).send('c', 'vypni', { onTool: (_i, _c, _l, s) => statuses.push(s) });
    expect(statuses).toEqual(['running', 'denied']);
    expect(res.text).toContain('zrušené');
    const tr = ((requests[1]!.messages as Anthropic.Beta.BetaMessageParam[]).at(-1)!.content as { is_error: boolean; content: string }[])[0]!;
    expect(tr.is_error).toBe(true);
    expect(tr.content).toContain('denied_by_user');
  });

  it('neplatné argumenty od modelu sa nevykonajú', async () => {
    const fx = new FakeExecutor();
    const { client } = fakeClient([
      { content: [toolUse('t1', 'audio__set_volume', { percent: 900 })], stop_reason: 'tool_use' },
      { content: [text('Hodnota musí byť 0 až 100.')] },
    ]);
    await new Agent(CAPS, fx.exec, { client }).send('c', 'hlasitosť 900');
    expect(fx.used('audio.set_volume')).toBe(false);
  });

  it('pri chybe API sa nedokončené kolo zahodí a konverzácia ostane platná', async () => {
    const fx = new FakeExecutor();
    const { client, requests } = fakeClient([
      { content: [toolUse('t1', 'system__status', {})], stop_reason: 'tool_use' },
      new Error('výpadok siete'),
      { content: [text('Druhý pokus ok.')] },
    ]);
    const agent = new Agent(CAPS, fx.exec, { client });
    await expect(agent.send('c', 'prvá')).rejects.toThrow('výpadok');
    const res = await agent.send('c', 'druhá');
    expect(res.text).toBe('Druhý pokus ok.');
    // história začína druhou otázkou, bez rozpracovaného tool_use z prvej
    const msgs = requests[2]!.messages as Anthropic.Beta.BetaMessageParam[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe('druhá');
  });

  it('odmietnutie modelu vráti zrozumiteľnú správu', async () => {
    const { client } = fakeClient([{ content: [], stop_reason: 'refusal' }]);
    const res = await new Agent(CAPS, new FakeExecutor().exec, { client }).send('c', 'x');
    expect(res.stopReason).toBe('refusal');
    expect(res.text).toMatch(/nemôžem/);
  });

  it('keď záložný model nie je podporovaný, vypne ho a zopakuje požiadavku', async () => {
    const bad = Object.create(Anthropic.BadRequestError.prototype) as Error;
    const { client, requests } = fakeClient([bad, { content: [text('ok')] }]);
    const res = await new Agent(CAPS, new FakeExecutor().exec, { client }).send('c', 'x');
    expect(res.text).toBe('ok');
    expect(requests[0]!.fallbacks).toBe('default');
    expect(requests[1]!.fallbacks).toBeUndefined();
  });

  it('snímku obrazovky pošle modelu ako obrázok', async () => {
    const fx = new FakeExecutor();
    const origExec = fx.exec;
    const exec = async (call: Parameters<typeof origExec>[0], s: AbortSignal) => call.command === 'screen.snapshot' ? { jpeg: 'A'.repeat(200), w: 1280, h: 720 } : origExec(call, s);
    const { client, requests } = fakeClient([
      { content: [toolUse('t1', 'screen__snapshot', {})], stop_reason: 'tool_use' },
      { content: [text('Vidím plochu.')] },
    ]);
    await new Agent(CAPS, exec, { client }).send('c', 'čo je na obrazovke?');
    const tr = ((requests[1]!.messages as Anthropic.Beta.BetaMessageParam[]).at(-1)!.content as { content: { type: string }[] }[])[0]!;
    expect(tr.content[0]!.type).toBe('image');
  });

  it('konverzácie sú oddelené', async () => {
    const { client, requests } = fakeClient([{ content: [text('a')] }, { content: [text('b')] }]);
    const agent = new Agent(CAPS, new FakeExecutor().exec, { client });
    await agent.send('telefon1', 'prvý');
    await agent.send('telefon2', 'druhý');
    expect((requests[1]!.messages as unknown[])).toHaveLength(1);
  });

  it('zrušenie a hneď nová správa v tej istej konverzácii nepokazí históriu', async () => {
    const { client, requests } = fakeClient([{ content: [text('druhá ok')] }]);
    const agent = new Agent(CAPS, new FakeExecutor().exec, { client });
    const ctrl = new AbortController();
    const p1 = agent.send('c', 'prvá', {}, ctrl.signal);
    ctrl.abort();                                     // prvé kolo zrušené ešte pred volaním AI
    await expect(p1).rejects.toMatchObject({ code: 'cancelled' });
    const res = await agent.send('c', 'druhá');       // serializuje sa po prvej, s vlastnou históriou
    expect(res.text).toBe('druhá ok');
    const msgs = requests.at(-1)!.messages as { role: string; content: unknown }[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe('druhá');
  });
});
