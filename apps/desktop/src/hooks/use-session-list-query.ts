/**
 * Session-list search / filter / grouping (extracted from App.tsx).
 *
 * Owns the debounced remote `session/search` query and the derived
 * filtered + grouped projections. Archive toggle and list-order hydration
 * stay in App — those mutate Host list pages, not this query surface.
 */
import { useEffect, useMemo, useState } from 'react';
import type { SessionScope, SessionSearchHit } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { SessionListItemUi } from '../chat-reducer';
import { groupSessionsByRecency, type SessionTimeGroup } from '../session-groups';
import { sessionScopeKey } from '../session-scope-key';

export type UseSessionListQueryInput = {
  hostClient: HostClient;
  sessionSearch: string;
  showArchivedSessions: boolean;
  activeScope: SessionScope;
  sessions: SessionListItemUi[];
  generalSessions: SessionListItemUi[];
};

export type UseSessionListQueryResult = {
  filteredSessions: SessionListItemUi[];
  filteredGeneralSessions: SessionListItemUi[];
  sessionGroups: SessionTimeGroup<SessionListItemUi>[];
  remoteSearchHitsByScope: Record<string, SessionSearchHit[]> | null;
};

export function projectSessionSearchHits(
  hits: readonly SessionSearchHit[],
  residentSessions: readonly SessionListItemUi[],
): SessionListItemUi[] {
  const residentById = new Map(residentSessions.map((session) => [session.id, session]));
  return hits
    .map((hit): SessionListItemUi => {
      const existing = residentById.get(hit.sessionId);
      return {
        ...(existing ?? { id: hit.sessionId, name: hit.name?.trim() ?? '' }),
        ...(hit.name?.trim() ? { name: hit.name.trim() } : {}),
        ...(hit.snippet ? { lastPreview: hit.snippet } : {}),
        ...(hit.updatedAt ? { updatedAt: hit.updatedAt } : {}),
        ...(hit.isPinned === true ? { isPinned: true } : {}),
        ...(hit.scope ? { scope: hit.scope } : {}),
      };
    })
    .filter((session) => session.name.trim().length > 0);
}

export function useSessionListQuery(input: UseSessionListQueryInput): UseSessionListQueryResult {
  const {
    hostClient,
    sessionSearch,
    showArchivedSessions,
    activeScope,
    sessions,
    generalSessions,
  } = input;
  const [remoteSearchHitsByScope, setRemoteSearchHitsByScope] = useState<Record<
    string,
    SessionSearchHit[]
  > | null>(null);

  useEffect(() => {
    const query = sessionSearch.trim();
    if (!query) {
      setRemoteSearchHitsByScope(null);
      return;
    }
    if (!hostClient.supportsCommand('session/search')) {
      // Keep filtering the bounded resident list. Treating an unsupported
      // remote search as an empty authoritative result hides every match.
      setRemoteSearchHitsByScope(null);
      return;
    }
    setRemoteSearchHitsByScope(null);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const scopes: SessionScope[] =
          activeScope.kind === 'general' ? [{ kind: 'general' }] : [activeScope, { kind: 'general' }];
        const results = await Promise.all(
          scopes.map(async (scope) => {
            const response = await hostClient.request({
              type: 'session/search',
              query: {
                query,
                scope,
                lifecycle: showArchivedSessions ? 'archived' : 'active',
                limit: 30,
              },
            });
            if (!response.success) {
              return [sessionScopeKey(scope), null] as const;
            }
            const data = response.data as { hits?: SessionSearchHit[] } | undefined;
            return [sessionScopeKey(scope), data?.hits ?? []] as const;
          }),
        );
        if (cancelled) return;
        const nextHits: Record<string, SessionSearchHit[]> = {};
        let searchFailed = false;
        for (const [scopeKey, hits] of results) {
          if (hits === null) {
            searchFailed = true;
            continue;
          }
          nextHits[scopeKey] = hits;
        }
        if (searchFailed && Object.keys(nextHits).length === 0) {
          setRemoteSearchHitsByScope(null);
          return;
        }
        setRemoteSearchHitsByScope(nextHits);
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeScope, hostClient, sessionSearch, showArchivedSessions]);

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) {
      return sessions;
    }
    const remoteSearchHits = remoteSearchHitsByScope?.[sessionScopeKey(activeScope)];
    if (remoteSearchHits !== undefined) {
      return projectSessionSearchHits(remoteSearchHits, sessions);
    }
    return sessions.filter((session) => {
      const haystack = `${session.name} ${session.lastPreview ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [activeScope, remoteSearchHitsByScope, sessionSearch, sessions]);

  const filteredGeneralSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) {
      return generalSessions;
    }
    const remoteGeneralHits = remoteSearchHitsByScope?.general;
    if (remoteGeneralHits !== undefined) {
      return projectSessionSearchHits(remoteGeneralHits, generalSessions);
    }
    return generalSessions.filter((session) => {
      const haystack = `${session.name} ${session.lastPreview ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [generalSessions, remoteSearchHitsByScope, sessionSearch]);

  const sessionGroups = useMemo(() => groupSessionsByRecency(filteredSessions), [filteredSessions]);

  return { filteredSessions, filteredGeneralSessions, sessionGroups, remoteSearchHitsByScope };
}
