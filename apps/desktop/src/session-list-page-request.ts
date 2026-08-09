import type {
  HostCommand,
  HostResponse,
  SessionListPageData,
  SessionListPageQuery,
} from '@piwin/contracts';

type SessionListPageCommand = Extract<HostCommand, { type: 'session/list-page' }>;
type SessionListPage = Extract<SessionListPageData, { status: 'page' }>;

export type SessionListPageRequester = (command: SessionListPageCommand) => Promise<HostResponse>;

export type SessionListPageRequestResult =
  { success: true; data: SessionListPage } | { success: false; error: string };

/** Request one page and perform the single bounded restart required by stale cursors. */
export async function requestSessionListPage(
  request: SessionListPageRequester,
  query: SessionListPageQuery,
): Promise<SessionListPageRequestResult> {
  let response = await request({ type: 'session/list-page', query });
  if (!response.success) {
    return { success: false, error: response.error };
  }
  let data = response.data as SessionListPageData;
  if (data.status === 'stale-cursor') {
    const restartQuery: SessionListPageQuery = { ...query };
    delete restartQuery.cursor;
    response = await request({ type: 'session/list-page', query: restartQuery });
    if (!response.success) {
      return { success: false, error: response.error };
    }
    data = response.data as SessionListPageData;
  }
  if (data.status !== 'page') {
    return { success: false, error: 'Session list page remained stale after one restart' };
  }
  return { success: true, data };
}
