import type { SessionScope } from '@piwin/contracts';
import type { ChatUiState } from '../chat-reducer';

export function compactFailureMessage(error: string, locale: string): string {
  const lower = error.toLowerCase();
  if (lower.includes('nothing to compact') || lower.includes('session too small')) {
    return locale === 'zh-CN'
      ? '模型侧几乎没有可压缩的历史。如果刚恢复会话，先再发一轮再 /compact。'
      : 'Nothing to compact in the live model session. If this session was just restored, send another turn first.';
  }
  if (lower.includes('already compacted')) {
    return locale === 'zh-CN' ? '这段上下文已经压缩过了。' : 'This context is already compacted.';
  }
  if (lower.includes('session-busy') || lower.includes('foreground-run')) {
    return locale === 'zh-CN'
      ? '当前回合还在跑，没法压缩。等它结束或先 /stop。'
      : 'Cannot compact while a run is in progress. Wait or /stop first.';
  }
  return error;
}

export function resolveKnownSessionScope(state: ChatUiState, sessionId: string): SessionScope {
  for (const [projectPath, sessions] of Object.entries(state.projectSessionsByPath)) {
    const session = sessions.find((item) => item.id === sessionId);
    if (session) {
      return session.scope?.kind === 'project' ? session.scope : { kind: 'project', projectPath };
    }
  }
  const generalSession = state.generalSessions.find((item) => item.id === sessionId);
  if (generalSession?.scope) {
    return generalSession.scope;
  }
  if (generalSession) {
    return { kind: 'general' };
  }
  return state.activeScope;
}
