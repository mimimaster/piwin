/**
 * Pending PromptContextRef chips for the composer (CM context-menu surfaces).
 * Authoritative context list for session/prompt; UI never reads file bytes.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { PromptContextRef } from '@piwin/contracts';

export const MAX_PENDING_CONTEXT_REFS = 12;

export type PendingContextRefItem = {
  /** Instance identity for selective send consumption. */
  token: string;
  /** Semantic dedupe key (CM §9.3). */
  key: string;
  ref: PromptContextRef;
  label: string;
};

export type ContextRefSnapshot = {
  items: Array<{
    token: string;
    ref: PromptContextRef;
  }>;
};

export type AddContextRefResult =
  | { ok: true; item: PendingContextRefItem; deduped: boolean }
  | { ok: false; reason: 'cap' };

function simpleHash(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/** Stable dedupe key for a context ref (CM §9.3). */
export function contextRefKey(ref: PromptContextRef): string {
  switch (ref.kind) {
    case 'file':
      return `file:${ref.projectPath}:${ref.relativePath}:${ref.lineStart ?? ''}:${ref.lineEnd ?? ''}`;
    case 'folder':
      return `folder:${ref.projectPath}:${ref.relativePath}`;
    case 'selection':
      return `selection:${ref.relativePath ?? ''}:${ref.lineStart ?? ''}:${ref.lineEnd ?? ''}:${simpleHash(ref.snapshotText)}`;
    case 'diff':
      return `diff:${ref.projectPath}:${(ref.relativePaths ?? []).join(',')}:${simpleHash(ref.snapshotText)}`;
    case 'terminal-output':
      return `terminal:${simpleHash(ref.snapshotText)}`;
    case 'error':
      return `error:${simpleHash(`${ref.title}\n${ref.detail}`)}`;
    case 'main-message':
      return `main-message:${ref.sourceSessionId}:${ref.messageId}`;
    case 'side-chat-message':
      return `side-chat-message:${ref.sideChatSessionId}:${ref.messageId}`;
    case 'connected-source':
      return `connected-source:${ref.source}`;
    default: {
      const exhaustive: never = ref;
      return `unknown:${JSON.stringify(exhaustive)}`;
    }
  }
}

export function labelForContextRef(ref: PromptContextRef): string {
  if (ref.label.trim().length > 0) {
    return ref.label;
  }
  switch (ref.kind) {
    case 'file':
      return ref.relativePath;
    case 'folder':
      return ref.relativePath === '' ? '.' : ref.relativePath;
    case 'selection':
      return ref.relativePath ?? 'Selection';
    case 'diff':
      return 'Diff';
    case 'terminal-output':
      return 'Terminal';
    case 'error':
      return ref.title;
    case 'main-message':
      return 'Message';
    case 'side-chat-message':
      return 'Side chat';
    case 'connected-source':
      return ref.label;
    default: {
      const exhaustive: never = ref;
      return String(exhaustive);
    }
  }
}

export function useComposerContextRefs() {
  const [pendingContextRefs, setPendingContextRefs] = useState<PendingContextRefItem[]>([]);
  const pendingContextRefsRef = useRef(pendingContextRefs);
  pendingContextRefsRef.current = pendingContextRefs;

  const addContextRef = useCallback((ref: PromptContextRef): AddContextRefResult => {
    const key = contextRefKey(ref);
    const existing = pendingContextRefsRef.current.find((item) => item.key === key);
    if (existing) {
      return { ok: true, item: existing, deduped: true };
    }
    if (pendingContextRefsRef.current.length >= MAX_PENDING_CONTEXT_REFS) {
      return { ok: false, reason: 'cap' };
    }
    const item: PendingContextRefItem = {
      token: crypto.randomUUID(),
      key,
      ref,
      label: labelForContextRef(ref),
    };
    const next = [...pendingContextRefsRef.current, item];
    // Keep the ref authoritative synchronously so a preset auto-send in the
    // same tick (Explain / Fix) reads the just-added ref via snapshotContextRefs.
    pendingContextRefsRef.current = next;
    setPendingContextRefs(next);
    return { ok: true, item, deduped: false };
  }, []);

  const removeContextRef = useCallback((key: string): void => {
    const next = pendingContextRefsRef.current.filter((item) => item.key !== key);
    pendingContextRefsRef.current = next;
    setPendingContextRefs(next);
  }, []);

  const clearContextRefs = useCallback((): void => {
    pendingContextRefsRef.current = [];
    setPendingContextRefs([]);
  }, []);

  const snapshotContextRefs = useCallback((): PromptContextRef[] => {
    return pendingContextRefsRef.current.map((item) => item.ref);
  }, []);

  const snapshotContextRefTokens = useCallback((): ContextRefSnapshot => {
    return {
      items: pendingContextRefsRef.current.map((item) => ({
        token: item.token,
        ref: item.ref,
      })),
    };
  }, []);

  const replaceContextRefs = useCallback((refs: PromptContextRef[]): void => {
    const next: PendingContextRefItem[] = [];
    for (const ref of refs) {
      if (next.length >= MAX_PENDING_CONTEXT_REFS) break;
      const key = contextRefKey(ref);
      if (next.some((item) => item.key === key)) continue;
      next.push({
        token: crypto.randomUUID(),
        key,
        ref,
        label: labelForContextRef(ref),
      });
    }
    pendingContextRefsRef.current = next;
    setPendingContextRefs(next);
  }, []);

  const consumeContextRefSnapshot = useCallback((snapshot: ContextRefSnapshot): void => {
    if (snapshot.items.length === 0) return;
    const tokens = new Set(snapshot.items.map((item) => item.token));
    const next = pendingContextRefsRef.current.filter((item) => !tokens.has(item.token));
    pendingContextRefsRef.current = next;
    setPendingContextRefs(next);
  }, []);

  return useMemo(
    () => ({
      pendingContextRefs,
      pendingContextRefsRef,
      addContextRef,
      removeContextRef,
      clearContextRefs,
      snapshotContextRefs,
      snapshotContextRefTokens,
      replaceContextRefs,
      consumeContextRefSnapshot,
    }),
    [
      pendingContextRefs,
      addContextRef,
      removeContextRef,
      clearContextRefs,
      snapshotContextRefs,
      snapshotContextRefTokens,
      replaceContextRefs,
      consumeContextRefSnapshot,
    ],
  );
}
