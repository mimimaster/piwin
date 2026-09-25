import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostPush, WalkthroughArtifact } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { readWalkthroughArtifacts } from '../../mobile-host-readers.js';

/**
 * Walkthrough reports bound to assistant messages (`sessionId + messageId`).
 * The Host generates them; the phone lists, follows `walkthrough/updated`, and
 * can ask for one on a finished turn.
 */
export interface SessionWalkthroughs {
  byMessageId: ReadonlyMap<string, WalkthroughArtifact>;
  canGenerate: boolean;
  generate: (messageId: string, runId: string | undefined) => Promise<string | undefined>;
}

export function useSessionWalkthroughs(
  client: HostClient | undefined,
  sessionId: string | undefined,
): SessionWalkthroughs {
  const [byMessageId, setByMessageId] = useState<ReadonlyMap<string, WalkthroughArtifact>>(() => new Map());
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  useEffect(() => {
    setByMessageId(new Map());
    if (client === undefined || sessionId === undefined || !client.supportsCommand('walkthrough/list')) return;
    let cancelled = false;
    client
      .request({ type: 'walkthrough/list', sessionId })
      .then((response) => {
        if (cancelled) return;
        setByMessageId(new Map(readWalkthroughArtifacts(response).map((artifact) => [artifact.messageId, artifact])));
      })
      .catch((error: unknown) => console.warn('[mobile] walkthrough/list failed', error));
    return () => {
      cancelled = true;
    };
  }, [client, sessionId]);

  useEffect(() => {
    if (client === undefined) return undefined;
    return client.subscribePush((push: HostPush) => {
      if (push.type !== 'walkthrough/updated' || push.sessionId !== sessionRef.current) return;
      setByMessageId((current) => {
        const next = new Map(current);
        next.set(push.artifact.messageId, push.artifact);
        return next;
      });
    });
  }, [client]);

  const generate = useCallback(
    async (messageId: string, runId: string | undefined): Promise<string | undefined> => {
      if (client === undefined || sessionId === undefined) return '未连接 Host。';
      const response = await client.request({
        type: 'walkthrough/generate',
        sessionId,
        messageId,
        ...(runId === undefined ? {} : { runId }),
      });
      return response.success ? undefined : response.error;
    },
    [client, sessionId],
  );

  return {
    byMessageId,
    canGenerate: client?.supportsCommand('walkthrough/generate') === true,
    generate,
  };
}
