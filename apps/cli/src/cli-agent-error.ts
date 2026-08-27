import type { AgentFailure } from '@piwin/contracts';
import { normalizeAgentFailure } from '@piwin/contracts';

export function formatCliAgentFailure(failure: AgentFailure): string {
  const normalized = normalizeAgentFailure(failure, failure.message);
  const status =
    normalized.httpStatus === undefined ? '' : ` http=${String(normalized.httpStatus)}`;
  return `[error] ${normalized.code} origin=${normalized.origin}${status} ${normalized.message}`;
}

export function formatCliAgentErrorEvent(event: {
  message: string;
  failure?: AgentFailure;
}): string {
  const failure =
    event.failure ??
    normalizeAgentFailure(undefined, event.message.trim() || 'Generation failed');
  return `\n${formatCliAgentFailure(failure)}\n`;
}
