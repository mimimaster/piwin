/**
 * On-demand recovery of a historical tool's output.
 *
 * Transcript hydrate slims bulk tool output to '' (@piwin/session
 * transcript-ui-projection), so an expanded historical bash row has nothing to
 * show until it asks the Host (`session/tool-output`). Two contexts carry what
 * the leaf card cannot know: the session-scoped reader (workbench) and the
 * owning message id (message row).
 */
import { createContext, useContext, useEffect, useState } from 'react';
import type { HostClient } from '../host/host-client';
import { toolOutputCache } from './tool-output-cache.js';

export type ToolOutputReadResult =
  | { status: 'ready'; output: string; truncated: boolean }
  /** The Host holds the tool and its persisted output is empty. */
  | { status: 'empty' }
  /** Not found, not readable, transport failure — nothing can be said. */
  | { status: 'unavailable' };

export type ToolOutputReader = (
  messageId: string,
  toolCallId: string,
) => Promise<ToolOutputReadResult>;

export const ToolOutputReaderContext = createContext<ToolOutputReader | null>(null);
export const ToolOutputMessageContext = createContext<string | null>(null);

/** Session-scoped reads share a bounded, reclaimable recent-output cache. */
export function createHostToolOutputReader(
  request: HostClient['request'],
  sessionId: string,
): ToolOutputReader {
  const readerId = toolOutputCache.allocateReaderId();
  const inFlight = new Map<string, Promise<ToolOutputReadResult>>();
  return (messageId, toolCallId) => {
    const key = `${readerId}\u0000${messageId}\u0000${toolCallId}`;
    const cached = toolOutputCache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const existing = inFlight.get(key);
    if (existing !== undefined) return existing;
    const generation = toolOutputCache.getGeneration();
    const pending = request({ type: 'session/tool-output', sessionId, messageId, toolCallId })
      .then((response): ToolOutputReadResult => {
        if (!response.success || !response.data) {
          return { status: 'unavailable' };
        }
        const data = response.data as {
          status?: string;
          output?: string;
          truncated?: boolean;
          reason?: string;
        };
        if (data.status === 'ready' && typeof data.output === 'string') {
          return { status: 'ready', output: data.output, truncated: data.truncated === true };
        }
        return data.reason === 'snapshot-unavailable' ? { status: 'empty' } : { status: 'unavailable' };
      })
      .catch((): ToolOutputReadResult => ({ status: 'unavailable' }));
    inFlight.set(key, pending);
    void pending.then((result) => {
      inFlight.delete(key);
      if (result.status !== 'unavailable') toolOutputCache.remember(key, result, generation);
    });
    return pending;
  };
}

export type LazyToolOutputState =
  | { status: 'idle' }
  | { status: 'loading' }
  | ToolOutputReadResult;

/**
 * Ask the Host for a tool's persisted output while `needed` holds. Without a
 * reader or message id (tests, older Hosts) it settles on `unavailable`.
 */
export function useLazyToolOutput(toolCallId: string, needed: boolean): LazyToolOutputState {
  const reader = useContext(ToolOutputReaderContext);
  const messageId = useContext(ToolOutputMessageContext);
  const canRead = needed && reader !== null && messageId !== null;
  const [state, setState] = useState<LazyToolOutputState>(() =>
    canRead ? { status: 'loading' } : needed ? { status: 'unavailable' } : { status: 'idle' },
  );

  useEffect(() => {
    if (!needed) {
      setState({ status: 'idle' });
      return;
    }
    if (!reader || messageId === null) {
      setState({ status: 'unavailable' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void reader(messageId, toolCallId).then((result) => {
      if (!cancelled) {
        setState(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [needed, reader, messageId, toolCallId]);

  return state;
}
