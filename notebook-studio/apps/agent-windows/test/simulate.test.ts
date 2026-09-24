import { describe, expect, it } from 'vitest';
import { msg } from '@ns/protocol';
import { SimulateBackend } from '../src/executor/simulate.ts';

const ctx = () => ({ signal: new AbortController().signal });

describe('SimulateBackend — vstup a web.open', () => {
  it('web.open zaznamená adresu a vráti ju', async () => {
    const b = new SimulateBackend();
    const r = await b.run('web.open', { url: 'https://youtube.com' }, ctx()) as { opened: string };
    expect(r.opened).toBe('https://youtube.com');
    expect(b.lastUrl).toBe('https://youtube.com');
  });

  it('input() zaznamená poslednú udalosť myši aj klávesnice', async () => {
    const b = new SimulateBackend();
    await b.input!(msg('input.pointer', { x: 0.25, y: 0.75, action: 'click', button: 'right' }), ctx());
    expect(b.lastInput?.type).toBe('input.pointer');
    await b.input!(msg('input.key', { key: 'Enter', mods: ['ctrl'] }), ctx());
    expect(b.lastInput?.type).toBe('input.key');
    await b.input!(msg('input.text', { text: 'ahoj' }), ctx());
    expect(b.lastInput).toMatchObject({ type: 'input.text', text: 'ahoj' });
  });
});
