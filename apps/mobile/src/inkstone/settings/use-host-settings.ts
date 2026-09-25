import { useCallback, useEffect, useState } from 'react';
import type {
  HostPush,
  RemoteSettingsApplyDomain,
  ReplaceSettingsDomainMutation,
  SettingsDomainValueMap,
  SettingsSnapshot,
} from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { createMobileIdempotencyKey, executeMobileMutation } from '../../mobile-prompt-send.js';

/**
 * Host settings as the phone sees them: one snapshot from `settings/get`,
 * domain replacements through `settings/apply` with the Host's CAS tokens.
 * Any Host-side change (`settings/updated`, from Desktop or another phone)
 * reloads the snapshot so this screen never edits a stale copy.
 */
export interface HostSettingsState {
  snapshot: SettingsSnapshot | undefined;
  error: string | undefined;
  loading: boolean;
  applying: RemoteSettingsApplyDomain | undefined;
  apply: <Domain extends RemoteSettingsApplyDomain>(
    domain: Domain,
    value: SettingsDomainValueMap[Domain],
  ) => Promise<string | undefined>;
}

export function useHostSettings(client: HostClient | undefined): HostSettingsState {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<RemoteSettingsApplyDomain | undefined>();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (client === undefined || !client.supportsCommand('settings/get')) return;
    let cancelled = false;
    setLoading(true);
    client
      .request({ type: 'settings/get' })
      .then((response) => {
        if (cancelled) return;
        const next = readSnapshot(response.success ? response.data : undefined);
        if (next !== undefined) {
          setSnapshot(next);
          setError(undefined);
        } else {
          setError(response.success ? 'Host 返回了无法识别的设置。' : response.error);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '读取 Host 设置失败。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadKey]);

  useEffect(() => {
    if (client === undefined) return undefined;
    return client.subscribePush((push: HostPush) => {
      if (push.type === 'settings/updated') {
        setReloadKey((value) => value + 1);
      }
    });
  }, [client]);

  const apply = useCallback(
    async <Domain extends RemoteSettingsApplyDomain>(
      domain: Domain,
      value: SettingsDomainValueMap[Domain],
    ): Promise<string | undefined> => {
      if (client === undefined || snapshot === undefined) return '未连接 Host。';
      const domainRevision = snapshot.domainRevisions[domain];
      if (domainRevision === undefined) return 'Host 没有给出这个设置的版本，稍后重试。';
      setApplying(domain);
      // TS cannot correlate a generic `Domain` with the distributed mutation
      // union; the signature above already ties `value` to `domain`.
      const mutation = { kind: 'replace-domain', domain, value } as ReplaceSettingsDomainMutation;
      try {
        // settings/apply is a remote idempotent mutation: a retried frame must
        // not apply twice after a reconnect.
        const response = await executeMobileMutation(
          (command, options) => client.request(command, options),
          {
            type: 'settings/apply',
            input: {
              expectedRevision: snapshot.revision,
              expectedDomainRevisions: { [domain]: domainRevision },
              mutations: [mutation],
            },
          },
          createMobileIdempotencyKey(),
        );
        if (!response.success) {
          setReloadKey((current) => current + 1);
          return response.error;
        }
        const next = readSnapshot(
          typeof response.data === 'object' && response.data !== null
            ? (response.data as { snapshot?: unknown }).snapshot
            : undefined,
        );
        if (next !== undefined) setSnapshot(next);
        else setReloadKey((current) => current + 1);
        return undefined;
      } finally {
        setApplying(undefined);
      }
    },
    [client, snapshot],
  );

  return { snapshot, error, loading, applying, apply };
}

function readSnapshot(data: unknown): SettingsSnapshot | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const candidate = 'snapshot' in data ? (data as { snapshot: unknown }).snapshot : data;
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const record = candidate as Partial<SettingsSnapshot>;
  return typeof record.revision === 'string' && typeof record.config === 'object' && record.config !== null
    ? (record as SettingsSnapshot)
    : undefined;
}
