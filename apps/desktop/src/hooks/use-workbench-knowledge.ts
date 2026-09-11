/**
 * Workbench knowledge wiring: Host capability, composer mounts, citation
 * opening, and the "use in chat" hand-off from the knowledge page.
 */
import { useCallback, useMemo } from 'react';
import {
  formatError,
  type HostCommand,
  type HostPush,
  type KnowledgeCitation,
} from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { KnowledgeCitationActions } from '../knowledge/knowledge-citation-actions.js';
import type { KnowledgeMountsValue } from '../knowledge/knowledge-mounts-context.js';
import { useSessionKnowledgeMounts } from '../knowledge/use-session-knowledge-mounts.js';

export type UseWorkbenchKnowledgeArgs = {
  hostClient: HostClient;
  supported: boolean;
  activeSessionId: string | null;
  sessionMountedIds: readonly string[] | undefined;
  openKnowledge: () => void;
  closeSubPage: () => void;
  focusComposer: () => void;
  /** Fallback when the Host cannot open the file itself (remote or mock Host). */
  openDocument: (input: { title: string; path: string }) => void;
  reportError: (message: string) => void;
};

export type WorkbenchKnowledge = {
  request: (command: HostCommand) => ReturnType<HostClient['request']>;
  subscribeKnowledgePush: (listener: (push: HostPush) => void) => () => void;
  mounts: KnowledgeMountsValue;
  citationActions: KnowledgeCitationActions;
  useInChat: (baseId: string) => void;
};

function readOpenSource(
  data: unknown,
): { kind: 'notes' } | { kind: 'folder'; absolutePath: string; opened: boolean } | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.kind === 'notes') return { kind: 'notes' };
  if (record.kind === 'folder' && typeof record.absolutePath === 'string') {
    return { kind: 'folder', absolutePath: record.absolutePath, opened: record.opened === true };
  }
  return null;
}

export function useWorkbenchKnowledge(args: UseWorkbenchKnowledgeArgs): WorkbenchKnowledge {
  const { hostClient, openKnowledge, closeSubPage, focusComposer, openDocument, reportError } = args;

  const request = useCallback((command: HostCommand) => hostClient.request(command), [hostClient]);
  const subscribeKnowledgePush = useCallback(
    (listener: (push: HostPush) => void) =>
      hostClient.subscribe((message) => {
        if (message.type === 'knowledge/bases-changed') listener(message);
      }),
    [hostClient],
  );

  const mounts = useSessionKnowledgeMounts({
    request,
    subscribePush: subscribeKnowledgePush,
    supported: args.supported,
    activeSessionId: args.activeSessionId,
    sessionMountedIds: args.sessionMountedIds,
    onOpenManager: openKnowledge,
  });

  const openCitation = useCallback(
    async (citation: KnowledgeCitation) => {
      try {
        const response = await hostClient.request({
          type: 'knowledge/open-source',
          citation,
          openFile: true,
        });
        if (!response.success) {
          reportError(response.error);
          return;
        }
        const source = readOpenSource(response.data);
        if (source?.kind === 'notes') {
          openKnowledge();
        } else if (source?.kind === 'folder' && !source.opened) {
          openDocument({ title: citation.title, path: source.absolutePath });
        }
      } catch (error) {
        reportError(formatError(error));
      }
    },
    [hostClient, openDocument, openKnowledge, reportError],
  );

  const citationActions = useMemo<KnowledgeCitationActions>(
    () => ({ openCitation: (citation) => void openCitation(citation) }),
    [openCitation],
  );

  const { mount } = mounts;
  const useInChat = useCallback(
    (baseId: string) => {
      mount(baseId);
      closeSubPage();
      window.setTimeout(focusComposer, 0);
    },
    [closeSubPage, focusComposer, mount],
  );

  return { request, subscribeKnowledgePush, mounts, citationActions, useInChat };
}
