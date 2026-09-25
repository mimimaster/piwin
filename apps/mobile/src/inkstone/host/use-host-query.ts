import { useCallback, useEffect, useState } from 'react';
import type { HostCommand } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';

export type HostQueryState<T> =
  | { kind: 'unsupported' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'error'; message: string };

/**
 * Read one Host command and narrow its payload. `command` must be stable
 * across renders (a module constant or memoised value) — it keys the fetch.
 */
export function useHostQuery<T>(
  client: HostClient | undefined,
  command: HostCommand,
  read: (data: unknown) => T | undefined,
): { state: HostQueryState<T>; reload: () => void } {
  const [state, setState] = useState<HostQueryState<T>>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const commandKey = JSON.stringify(command);

  useEffect(() => {
    if (client === undefined) {
      setState({ kind: 'loading' });
      return;
    }
    if (!client.supportsCommand(command.type)) {
      setState({ kind: 'unsupported' });
      return;
    }
    let cancelled = false;
    setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    client
      .request(command)
      .then((response) => {
        if (cancelled) return;
        const data = response.success ? read(response.data) : undefined;
        setState(
          data !== undefined
            ? { kind: 'ready', data }
            : { kind: 'error', message: response.success ? 'Host 返回了无法识别的数据。' : response.error },
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: reason instanceof Error ? reason.message : '读取失败。' });
      });
    return () => {
      cancelled = true;
    };
    // `command` is keyed by its serialized form; `read` is a pure narrowing function.
  }, [client, commandKey, reloadKey]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  return { state, reload };
}

export function readArrayField<T>(field: string, isItem: (value: unknown) => value is T) {
  return (data: unknown): T[] | undefined => {
    if (typeof data !== 'object' || data === null) return undefined;
    const list = (data as Record<string, unknown>)[field];
    return Array.isArray(list) ? list.filter(isItem) : undefined;
  };
}

/** Narrowing helper re-exported under the name the Host readers here use. */
export { isRecord as isObject } from '../../mobile-host-helpers.js';
