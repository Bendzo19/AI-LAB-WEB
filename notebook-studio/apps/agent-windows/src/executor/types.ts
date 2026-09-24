import type { CommandArgs, CommandName } from '@ns/protocol';

export interface ExecContext {
  signal: AbortSignal;
  onProgress?: (percent: number | undefined, text?: string) => void;
}

/** Backend, ktorý naozaj (alebo naoko) vykonáva príkazy notebooku. */
export interface Backend {
  readonly kind: 'windows' | 'simulate';
  readonly lenovo: boolean;
  readonly admin: boolean;
  run<N extends CommandName>(name: N, args: CommandArgs<N>, ctx: ExecContext): Promise<unknown>;
}

export class ExecError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'ExecError'; }
}
