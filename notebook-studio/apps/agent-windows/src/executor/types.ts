import type { AppMessageOf, CommandArgs, CommandName } from '@ns/protocol';

export interface ExecContext {
  signal: AbortSignal;
  onProgress?: (percent: number | undefined, text?: string) => void;
}

/** Živý vstup (myš/klávesnica) z mobilu. Prejde len počas udeleného control okna
 * (rozhoduje main.ts), backend ho už len vykoná na obrazovke notebooku. */
export type InputEvent =
  | AppMessageOf<'input.pointer'>
  | AppMessageOf<'input.key'>
  | AppMessageOf<'input.text'>;

/** Backend, ktorý naozaj (alebo naoko) vykonáva príkazy notebooku. */
export interface Backend {
  readonly kind: 'windows' | 'simulate';
  readonly lenovo: boolean;
  readonly admin: boolean;
  run<N extends CommandName>(name: N, args: CommandArgs<N>, ctx: ExecContext): Promise<unknown>;
  /** Vzdialený vstup — voliteľné; nie každý backend ho vie vykonať. */
  input?(ev: InputEvent, ctx: ExecContext): Promise<void>;
}

export class ExecError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'ExecError'; }
}
