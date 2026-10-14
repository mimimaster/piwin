/**
 * Host-managed Desktop ↔ native CLI writer ownership for one product session.
 *
 * Scope is Host-internal only (not an OS-wide lease). Transitions that reserve
 * the writer do so synchronously so Desktop prompt admission and CLI open race
 * closed: either prompt registers first and CLI refuses, or CLI reserves first
 * and prompt refuses. Remote client disconnect never releases ownership.
 */
import type { AgentCliFailureCode, AgentCliOwnership, HostPush } from '@piwin/contracts';
import { isAgentCliDesktopWriterBlocked } from '@piwin/contracts';

export type AgentCliOwnershipListener = (ownership: AgentCliOwnership) => void;

export class AgentCliOwnershipController {
  private readonly states = new Map<string, AgentCliOwnership>();
  private readonly onChange: AgentCliOwnershipListener | undefined;

  constructor(options?: { onChange?: AgentCliOwnershipListener }) {
    this.onChange = options?.onChange;
  }

  get(sessionId: string): AgentCliOwnership {
    return this.states.get(sessionId) ?? { kind: 'desktop', sessionId };
  }

  /** Desktop prompt / queue admission must refuse while native owns the writer. */
  isDesktopWriterBlocked(sessionId: string): boolean {
    return isAgentCliDesktopWriterBlocked(this.get(sessionId));
  }

  /**
   * Reserve native handoff once the product session id is known.
   * Call before any await. Refuses an active Desktop Run or non-desktop owner.
   */
  tryBeginNative(sessionId: string, hasForegroundRun: boolean): AgentCliFailureCode | undefined {
    const current = this.get(sessionId);
    if (hasForegroundRun) {
      return 'writer-busy';
    }
    if (current.kind === 'native') {
      return undefined;
    }
    if (current.kind !== 'desktop') {
      return 'writer-busy';
    }
    this.set({ kind: 'switching', sessionId, target: 'native' });
    return undefined;
  }

  /** Confirm an attached native PTY after OS spawn succeeds. */
  confirmNative(sessionId: string, ptyId: string): void {
    this.set({ kind: 'native', sessionId, ptyId });
  }

  setNativeActivity(sessionId: string, activity: import('@piwin/contracts').AgentCliActivity): void {
    const current = this.get(sessionId);
    if (current.kind === 'native' && current.activity !== activity) this.set({ ...current, activity });
  }

  /**
   * Opening failed and no native actor was confirmed. Unlock Desktop only when
   * still switching toward native without a live pty id.
   */
  abortNativeOpen(sessionId: string): void {
    const current = this.get(sessionId);
    if (current.kind === 'switching' && current.target === 'native' && current.ptyId === undefined) {
      this.set({ kind: 'desktop', sessionId });
    }
  }

  /** Begin Desktop return. Keeps native pty id visible while closing. */
  tryBeginDesktop(sessionId: string): AgentCliFailureCode | undefined {
    const current = this.get(sessionId);
    if (current.kind === 'desktop') {
      return undefined;
    }
    if (current.kind === 'switching' && current.target === 'desktop') {
      return undefined;
    }
    if (current.kind !== 'native') {
      return 'writer-busy';
    }
    this.set({ kind: 'switching', sessionId, target: 'desktop', ptyId: current.ptyId });
    return undefined;
  }

  confirmDesktop(sessionId: string): void {
    this.set({ kind: 'desktop', sessionId });
  }

  /**
   * Unexpected native exit or failed history import: retain switching so Desktop
   * cannot send until an explicit successful sync unlocks it.
   */
  markRecovery(sessionId: string, ptyId?: string): void {
    this.set({
      kind: 'switching',
      sessionId,
      target: 'desktop',
      ...(ptyId !== undefined ? { ptyId } : {}),
    });
  }

  /** Drop state when the product session is deleted. */
  forget(sessionId: string): void {
    this.states.delete(sessionId);
  }

  private set(ownership: AgentCliOwnership): void {
    this.states.set(ownership.sessionId, ownership);
    this.onChange?.(ownership);
  }
}

export function ownershipPush(ownership: AgentCliOwnership): HostPush {
  return { type: 'agents/cli-ownership', ownership };
}
