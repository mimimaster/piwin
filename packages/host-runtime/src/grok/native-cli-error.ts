import type { AgentCliFailureCode } from '@piwin/contracts';

export class AgentCliError extends Error {
  public override readonly name = 'AgentCliError';
  constructor(
    public readonly code: AgentCliFailureCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}
