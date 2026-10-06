import {
  AgentPluginProtocolError,
  type AgentPluginAgentEmission,
  type AgentPluginEmission,
  type AgentPluginOpenedSession,
} from '@piwin/contracts';

/** Replay remains provisional until the load response confirms the entire ordered stream. */
export class AgentPluginReplayCollector {
  private readonly events: AgentPluginAgentEmission[] = [];
  private closedReason: string | undefined;

  observe(emission: AgentPluginEmission): void {
    if (emission.type === 'agent') this.events.push(emission);
    if (emission.type === 'closed') this.closedReason = emission.reason;
  }

  finish(opened: AgentPluginOpenedSession, mode: 'new' | 'load' | 'resume'): AgentPluginOpenedSession {
    if (!Array.isArray(opened.replayEvents)) return fail('invalid replay array');
    if (this.closedReason !== undefined) return fail(`replay transport closed: ${this.closedReason}`);
    const count = opened.streamedReplayEventCount;
    if (count === undefined) {
      if (this.events.length !== 0) return fail('streamed replay has no completion count');
      return opened;
    }
    if (mode !== 'load') return fail('streamed replay is only valid for session/load');
    if (!Number.isSafeInteger(count) || count < 0) return fail('invalid streamed replay count');
    if (opened.replayEvents.length !== 0) return fail('mixed streamed and inline replay');
    if (count !== this.events.length) return fail(`incomplete streamed replay: expected ${count}, received ${this.events.length}`);
    return { ...opened, replayEvents: this.events };
  }
}

function fail(message: string): never {
  throw new AgentPluginProtocolError(`agent-plugin-protocol-error: ${message}`);
}
