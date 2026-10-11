import type { RemoteSessionListData } from '@piwin/contracts';
import type { TuiHostLink } from './tui-host-link.js';

const SESSION_LOOKUP_LIMIT = 500;

/** The resume payload says "project" but not which one, nor which agent; the index does. */
export async function readTuiSessionIndex(
  link: TuiHostLink,
  sessionId: string,
): Promise<
  | {
      projectId?: string;
      agentId?: string;
      archived?: boolean;
    }
  | undefined
> {
  const response = await link.request({
    type: 'session/list',
    scopeRef: { kind: 'all-authorized' },
    order: 'updated',
    maxItems: SESSION_LOOKUP_LIMIT,
    includeArchived: true,
  });
  if (!response.success) return undefined;
  const session = (response.data as RemoteSessionListData).sessions.find(
    (item) => item.sessionId === sessionId,
  );
  if (session === undefined) return undefined;
  const agentId = session.backend?.agentId;
  return {
    ...(session.projectId === undefined ? {} : { projectId: session.projectId }),
    ...(agentId === undefined || agentId === 'pi' ? {} : { agentId }),
    ...(session.archived === true ? { archived: true } : {}),
  };
}
