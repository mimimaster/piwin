import { readSessionListPage } from './mobile-session-list.js';
import { useState, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import type {
  KnowledgeBaseSummary,
  KnowledgeSearchResult,
  RemoteSessionSummary,
  WikiConceptDetail,
  WikiOverviewResult,
  KnowledgeCitation,
} from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { isRecord, toError } from '../mobile-host-helpers.js';
import {
  readKnowledgeBases,
  readKnowledgeBase,
  readKnowledgeSearchResult,
  readWikiConcept,
  readWikiOverview,
} from '../mobile-host-readers.js';
import { createMobileIdempotencyKey, executeMobileMutation } from '../mobile-prompt-send.js';

export interface UseMobileKnowledgeOptions {
  clientRef: MutableRefObject<HostClient | undefined>;
  setSessions: Dispatch<SetStateAction<RemoteSessionSummary[]>>;
  sessionListCommand: () => {
    type: 'session/list';
    allScopes: true;
    order: 'updated';
    maxItems: number;
  };
}

export function useMobileKnowledge({
  clientRef,
  setSessions,
  sessionListCommand,
}: UseMobileKnowledgeOptions) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [wikiOverview, setWikiOverview] = useState<WikiOverviewResult | undefined>();
  const [knowledgeError, setKnowledgeError] = useState<string | undefined>();

  const refreshKnowledge = async (client: HostClient): Promise<void> => {
    if (!client.supportsCommand('knowledge/bases/list')) {
      setKnowledgeBases([]);
      setWikiOverview(undefined);
      return;
    }
    try {
      const [basesResponse, overviewResponse] = await Promise.all([
        client.request({ type: 'knowledge/bases/list' }),
        client.request({ type: 'knowledge/wiki/overview' }),
      ]);
      if (clientRef.current !== client) return;
      setKnowledgeBases(readKnowledgeBases(basesResponse));
      setWikiOverview(readWikiOverview(overviewResponse));
      setKnowledgeError(undefined);
    } catch (error) {
      if (clientRef.current === client) {
        setKnowledgeError(toError(error, '读取知识库失败。').message);
      }
    }
  };

  const handleKnowledgeSearch = async (
    query: string,
    baseIds?: string[],
  ): Promise<KnowledgeSearchResult> => {
    const client = clientRef.current;
    const normalizedQuery = query.trim();
    if (client === undefined || normalizedQuery.length === 0) {
      return { citations: [], degradedBaseIds: [], skipped: [] };
    }
    try {
      const response = await client.request({
        type: 'knowledge/search',
        query: normalizedQuery,
        ...(baseIds === undefined ? {} : { baseIds }),
        limit: 12,
      });
      if (!response.success) {
        setKnowledgeError(response.error);
        return { citations: [], degradedBaseIds: [], skipped: [] };
      }
      setKnowledgeError(undefined);
      return readKnowledgeSearchResult(response);
    } catch (error) {
      setKnowledgeError(toError(error, '搜索知识库失败。').message);
      return { citations: [], degradedBaseIds: [], skipped: [] };
    }
  };

  const handleOpenKnowledgeSource = async (
    citation: KnowledgeCitation,
    openFile = false,
  ): Promise<boolean> => {
    const client = clientRef.current;
    if (client === undefined) return false;
    try {
      const response = await client.request({
        type: 'knowledge/open-source',
        citation,
        openFile,
      });
      if (!response.success) {
        setKnowledgeError(response.error);
        return false;
      }
      setKnowledgeError(undefined);
      return true;
    } catch (error) {
      setKnowledgeError(toError(error, '打开知识来源失败。').message);
      return false;
    }
  };

  const handleSetSessionKnowledgeBases = async (
    sessionId: string,
    baseIds: string[],
  ): Promise<boolean> => {
    const client = clientRef.current;
    if (client === undefined || sessionId.length === 0) return false;
    try {
      const response = await executeMobileMutation(
        (command, options) => client.request(command, options),
        { type: 'session/set-knowledge-bases', sessionId, baseIds },
        createMobileIdempotencyKey(),
      );
      if (!response.success) {
        setKnowledgeError(response.error);
        return false;
      }
      const sessionsResponse = await client.request(sessionListCommand());
      if (clientRef.current === client) setSessions(readSessionListPage(sessionsResponse));
      await refreshKnowledge(client);
      setKnowledgeError(undefined);
      return true;
    } catch (error) {
      setKnowledgeError(toError(error, '更新会话知识库挂载失败。').message);
      return false;
    }
  };

  const handleAddKnowledgeBase = async (
    folderPath: string,
    name?: string,
  ): Promise<KnowledgeBaseSummary | undefined> => {
    const client = clientRef.current;
    const path = folderPath.trim();
    if (client === undefined || path.length === 0) return undefined;
    try {
      const response = await executeMobileMutation(
        (command, options) => client.request(command, options),
        {
          type: 'knowledge/bases/add',
          folderPath: path,
          ...(name?.trim() ? { name: name.trim() } : {}),
        },
        createMobileIdempotencyKey(),
      );
      const base = readKnowledgeBase(response);
      if (!response.success || base === undefined) {
        setKnowledgeError(response.success ? 'Host 未返回知识库信息。' : response.error);
        return undefined;
      }
      await refreshKnowledge(client);
      setKnowledgeError(undefined);
      return base;
    } catch (error) {
      setKnowledgeError(toError(error, '添加知识库失败。').message);
      return undefined;
    }
  };

  const handleDistillWiki = async (
    baseId: string,
    topic?: string,
  ): Promise<WikiConceptDetail | undefined> => {
    const client = clientRef.current;
    if (client === undefined || baseId.length === 0) return undefined;
    try {
      const response = await executeMobileMutation(
        (command, options) => client.request(command, options),
        {
          type: 'knowledge/wiki/distill',
          baseId,
          ...(topic?.trim() ? { topic: topic.trim() } : {}),
        },
        createMobileIdempotencyKey(),
      );
      if (!response.success) {
        setKnowledgeError(response.error);
        return undefined;
      }
      await refreshKnowledge(client);
      setKnowledgeError(undefined);
      return readWikiConcept({
        ...response,
        data:
          isRecord(response.data) && isRecord(response.data.concept)
            ? { concept: response.data.concept }
            : response.data,
      });
    } catch (error) {
      setKnowledgeError(toError(error, '提炼维基条目失败。').message);
      return undefined;
    }
  };

  return {
    knowledgeBases,
    setKnowledgeBases,
    wikiOverview,
    setWikiOverview,
    knowledgeError,
    setKnowledgeError,
    refreshKnowledge,
    handleKnowledgeSearch,
    handleOpenKnowledgeSource,
    handleSetSessionKnowledgeBases,
    handleAddKnowledgeBase,
    handleDistillWiki,
  };
}
