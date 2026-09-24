/**
 * Spustí testovaciu sadu proti skutočnému Claude API (výcvik/kontrola agenta).
 *   ANTHROPIC_API_KEY=... npm run eval -w @ns/brain
 * Voliteľne ANTHROPIC_BASE_URL, NS_MODEL. Bez kľúča iba vypíše, čo by testoval.
 */
import { Agent } from '../agent.ts';
import { CASES } from './cases.ts';
import { FakeExecutor } from './fake-executor.ts';

const CAPS = { devMode: false, lenovo: true, admin: true, hub: true };

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.log(`Bez ANTHROPIC_API_KEY. Testovacia sada má ${CASES.length} prípadov:`);
    for (const c of CASES) console.log('  •', c.name, '—', c.prompt);
    console.log('\nSpusti s kľúčom: ANTHROPIC_API_KEY=... npm run eval -w @ns/brain');
    return;
  }
  let passed = 0;
  const fails: string[] = [];
  for (const c of CASES) {
    const fx = new FakeExecutor();
    c.setup?.(fx);
    const agent = new Agent(CAPS, fx.exec, { apiKey: key, baseURL: process.env.ANTHROPIC_BASE_URL, model: process.env.NS_MODEL });
    try {
      const res = await agent.send('eval', c.prompt);
      const errs = c.check(fx, res.text);
      if (errs.length === 0) { passed++; console.log(`✓ ${c.name}`); }
      else { fails.push(c.name); console.log(`✗ ${c.name}\n   ${errs.join('\n   ')}\n   → ${res.text.slice(0, 160)}`); }
    } catch (e) {
      fails.push(c.name);
      console.log(`✗ ${c.name} — výnimka: ${(e as Error).message}`);
    }
  }
  console.log(`\n${passed}/${CASES.length} prešlo.`);
  if (fails.length) process.exitCode = 1;
}
main();
