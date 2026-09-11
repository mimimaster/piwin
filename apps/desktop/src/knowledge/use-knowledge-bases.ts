import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatError,
  type HostCommand,
  type HostPush,
  type HostResponse,
  type KnowledgeBaseSummary,
  type KnowledgeSearchResult,
} from '@piwin/contracts';
import {
  readKnowledgeBaseList,
  readKnowledgeBaseMutation,
  readKnowledgeBaseRemoval,
  readKnowledgeSearchResult,
} from './knowledge-base-client.js';

export type KnowledgeBasesRequest = (command: HostCommand) => Promise<HostResponse>;

export type UseKnowledgeBasesArgs = {
  request: KnowledgeBasesRequest;
  subscribePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  /** False on Hosts without the `knowledgeBases` capability. */
  enabled: boolean;
};

export type KnowledgeActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type KnowledgeBasesState = {
  bases: KnowledgeBaseSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addFolder: (folderPath: string, name?: string) => Promise<KnowledgeActionResult<KnowledgeBaseSummary>>;
  rename: (baseId: string, name: string) => Promise<KnowledgeActionResult<KnowledgeBaseSummary>>;
  remove: (baseId: string, deleteIndex: boolean) => Promise<KnowledgeActionResult<null>>;
  search: (
    query: string,
    baseIds?: readonly string[],
  ) => Promise<KnowledgeActionResult<KnowledgeSearchResult>>;
};

async function run<T>(
  request: KnowledgeBasesRequest,
  command: HostCommand,
  read: (data: unknown) => T | null,
): Promise<KnowledgeActionResult<T>> {
  try {
    const response = await request(command);
    if (!response.success) return { ok: false, error: response.error };
    const value = read(response.data);
    return value === null
      ? { ok: false, error: `Unexpected ${command.type} response` }
      : { ok: true, value };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

/** Host-owned knowledge base registry: list, live push updates, and mutations. */
export function useKnowledgeBases(args: UseKnowledgeBasesArgs): KnowledgeBasesState {
  const [bases, setBases] = useState<KnowledgeBaseSummary[]>([]);
  const [loading, setLoading] = useState(args.enabled);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(args.request);
  requestRef.current = args.request;

  const refresh = useCallback(async () => {
    if (!args.enabled) return;
    setLoading(true);
    const result = await run(requestRef.current, { type: 'knowledge/bases/list' }, readKnowledgeBaseList);
    setLoading(false);
    if (result.ok) {
      setBases(result.value);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [args.enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!args.enabled || !args.subscribePush) return undefined;
    return args.subscribePush((push) => {
      if (push.type === 'knowledge/bases-changed') {
        setBases(push.bases);
        setError(null);
      }
    });
  }, [args.enabled, args.subscribePush]);

  const addFolder = useCallback(async (folderPath: string, name?: string) => {
    const result = await run(
      requestRef.current,
      { type: 'knowledge/bases/add', folderPath, ...(name ? { name } : {}) },
      readKnowledgeBaseMutation,
    );
    if (result.ok) {
      setBases((current) => upsertBase(current, result.value));
    }
    return result;
  }, []);

  const rename = useCallback(async (baseId: string, name: string) => {
    const result = await run(
      requestRef.current,
      { type: 'knowledge/bases/rename', baseId, name },
      readKnowledgeBaseMutation,
    );
    if (result.ok) {
      setBases((current) => upsertBase(current, result.value));
    }
    return result;
  }, []);

  const remove = useCallback(async (baseId: string, deleteIndex: boolean) => {
    const result = await run(
      requestRef.current,
      { type: 'knowledge/bases/remove', baseId, deleteIndex },
      readKnowledgeBaseRemoval,
    );
    if (!result.ok) return result;
    setBases((current) => current.filter((base) => base.id !== result.value));
    return { ok: true, value: null } satisfies KnowledgeActionResult<null>;
  }, []);

  const search = useCallback(
    (query: string, baseIds?: readonly string[]) =>
      run(
        requestRef.current,
        {
          type: 'knowledge/search',
          query,
          ...(baseIds && baseIds.length > 0 ? { baseIds: [...baseIds] } : {}),
        },
        readKnowledgeSearchResult,
      ),
    [],
  );

  return { bases, loading, error, refresh, addFolder, rename, remove, search };
}

function upsertBase(
  bases: readonly KnowledgeBaseSummary[],
  next: KnowledgeBaseSummary,
): KnowledgeBaseSummary[] {
  const index = bases.findIndex((base) => base.id === next.id);
  if (index === -1) return [...bases, next];
  const copy = bases.slice();
  copy[index] = next;
  return copy;
}
