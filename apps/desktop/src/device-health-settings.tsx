/**
 * Settings → General card for Apple Health on this device. Shown throughout
 * the mobile shell; when the tool cannot be used it says why instead of
 * disappearing, because the usual cause is a Host setting the user can fix.
 */
import { useState, type ReactElement } from 'react';
import { formatError } from '@piwin/contracts';
import type { HealthForegroundUseMode } from '@piwin/host-client';
import { Button, Notice, Select, StatusBadge, Switch } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context.js';
import {
  connectDeviceHealth,
  disconnectDeviceHealth,
  setDeviceHealthBackgroundSync,
  setDeviceHealthUseMode,
} from './device-health.js';
import { DEVICE_HEALTH_COPY } from './device-health-copy.js';
import { FieldRow } from './settings/field-row.js';
import { PageTitle } from './settings/page-title.js';
import { isMobileTauriRuntime } from './shell-runtime.js';
import { useDeviceHealth } from './use-device-health.js';

const USE_MODES: readonly HealthForegroundUseMode[] = [
  'ask-every-time',
  'allow-for-session',
  'always-allow-this-host',
  'off',
];

export function DeviceHealthSettings(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const health = useDeviceHealth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  if (!isMobileTauriRuntime()) {
    return null;
  }
  const copy = DEVICE_HEALTH_COPY[locale];
  if (health.status !== 'ready') {
    return (
      <div className="settings-section settings-section-card" data-testid="device-health-settings">
        <PageTitle
          title={copy.title}
          description={copy.description}
          trailing={<StatusBadge tone="neutral" label={copy.unavailable} />}
        />
        <p className="host-target-shell-note" data-testid="device-health-unavailable">
          {copy.unavailableReasons[health.status]}
        </p>
      </div>
    );
  }

  async function run(action: () => Promise<void>, fallback: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (actionError) {
      const detail = formatError(actionError);
      setError(detail.length > 0 ? `${fallback} ${detail}` : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section settings-section-card" data-testid="device-health-settings">
      <PageTitle
        title={copy.title}
        description={copy.description}
        trailing={
          <StatusBadge
            tone={health.connected ? 'success' : 'neutral'}
            label={health.connected ? copy.connected : copy.notConnected}
          />
        }
      />
      {health.connected ? (
        <>
          <FieldRow label={copy.useModeLabel}>
            <Select
              value={health.useMode}
              testId="device-health-use-mode"
              aria-label={copy.useModeLabel}
              data={USE_MODES.map((mode) => ({ value: mode, label: copy.useModes[mode] }))}
              onChange={(event) =>
                setDeviceHealthUseMode(event.currentTarget.value as HealthForegroundUseMode)
              }
              style={{ minWidth: 160 }}
            />
          </FieldRow>
          <FieldRow label={copy.backgroundSyncLabel} description={copy.backgroundSyncDescription}>
            <Switch
              checked={health.backgroundSync.enabled}
              disabled={busy || (!health.backgroundSync.enabled && !health.backgroundSync.hostStorageEnabled)}
              testId="device-health-background-sync"
              aria-label={copy.backgroundSyncLabel}
              onCheckedChange={(checked) => {
                void run(() => setDeviceHealthBackgroundSync(checked), copy.backgroundSyncToggleFailed);
              }}
            />
          </FieldRow>
          <p className="host-target-shell-note" data-testid="device-health-background-sync-status">
            {!health.backgroundSync.hostStorageEnabled
              ? copy.backgroundSyncHostOff
              : !health.backgroundSync.enabled
                ? null
                : health.backgroundSync.lastError !== undefined
                  ? copy.backgroundSyncFailed(health.backgroundSync.lastError)
                  : health.backgroundSync.lastSyncAt === undefined
                    ? copy.backgroundSyncNever
                    : copy.backgroundSyncLast(new Date(health.backgroundSync.lastSyncAt).toLocaleString(locale))}
          </p>
          <div className="host-target-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                void run(disconnectDeviceHealth, '');
              }}
              data-testid="device-health-disconnect"
            >
              {copy.disconnect}
            </Button>
          </div>
          <p className="host-target-shell-note">{copy.disconnectNote}</p>
        </>
      ) : (
        <div className="host-target-actions">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              void run(connectDeviceHealth, copy.connectFailed);
            }}
            data-testid="device-health-connect"
          >
            {busy ? copy.connecting : copy.connect}
          </Button>
        </div>
      )}
      {error !== undefined ? (
        <Notice tone="error" testId="device-health-error">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
