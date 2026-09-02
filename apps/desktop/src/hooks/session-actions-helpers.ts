import type { SessionScope } from '@piwin/contracts';
import { classifyCompactionNoOp } from '@piwin/contracts';
import type { ChatUiState } from '../chat-reducer';

export function compactFailureMessage(error: string, locale: string): string {
  const lower = error.toLowerCase();
  if (lower.includes('unknown session')) {
    return locale === 'zh-CN'
      ? '当前会话还没在 Host 里唤醒，没法压缩。'
      : 'This session is not live on the Host yet, so compact cannot run.';
  }
  if (lower.includes('nothing to compact') || lower.includes('session too small')) {
    return locale === 'zh-CN'
      ? '当前模型会话几乎没有可压缩的历史。界面上的对话可能还没灌进模型侧。'
      : 'The live model session has almost nothing to compact. On-screen history may not be loaded into the model session yet.';
  }
  if (lower.includes('already compacted')) {
    return locale === 'zh-CN' ? '这段上下文已经压缩过了。' : 'This context is already compacted.';
  }
  if (lower.includes('context-limit-exceeded')) {
    return locale === 'zh-CN'
      ? '压缩后上下文仍超过目标模型窗口。换一个更大窗口的模型，或开新会话。'
      : 'Compacted context still exceeds the target model window. Pick a larger-window model, or start a new session.';
  }
  if (lower.includes('session-busy') || lower.includes('foreground-run')) {
    return locale === 'zh-CN'
      ? '当前回合还在跑，没法压缩。等它结束或先 /stop。'
      : 'Cannot compact while a run is in progress. Wait or /stop first.';
  }
  return error;
}

/** Target-model compact no-ops are not blocked model switches. */
export function isTargetCompactNoOpFailure(error: string): boolean {
  return isCompactionNoOp(error);
}

/** Manual compact uses the same harmless Pi no-op classification. */
export function isCompactionNoOp(error: string): boolean {
  return classifyCompactionNoOp(error) !== undefined;
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
