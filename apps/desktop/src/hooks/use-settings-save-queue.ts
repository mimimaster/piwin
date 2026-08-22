/**
 * In-order settings/apply queue. Planning lives in settings-save-queue.ts so
 * App does not grow another inline save path.
 */
import { useCallback, useRef, type Dispatch } from 'react';
import type { PiwinConfig, SettingsMutation } from '@piwin/contracts';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import type { DesktopLocale } from '../desktop-locale';
import type { HostClient } from '../host-client';
import { pushError, type NotificationAction } from '../notification-queue';
import {
  planSettingsSave,
  settingsApplyCommand,
  settingsSaveApplyFailureNotice,
  settingsSaveThrownNotice,
} from '../settings-save-queue';

export type UseSettingsSaveQueueArgs = {
  hostClient: HostClient;
  desktopLocale: DesktopLocale;
  dispatchNotification: Dispatch<NotificationAction>;
};

export function useSettingsSaveQueue(args: UseSettingsSaveQueueArgs): {
  saveSettingsInOrder: (
    buildMutations: (currentConfig: PiwinConfig) => SettingsMutation[],
  ) => Promise<void>;
} {
  const { hostClient, desktopLocale, dispatchNotification } = args;
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const saveSettingsInOrder = useCallback(
    (buildMutations: (currentConfig: PiwinConfig) => SettingsMutation[]): Promise<void> => {
      const saveOperation = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          const getResponse = await hostClient.request({ type: 'settings/get' });
          const plan = planSettingsSave({
            getResponse,
            buildMutations,
            transport: hostClient.getTransport(),
          });
          if (plan.kind === 'read-failed' || plan.kind === 'missing-snapshot') {
            dispatchNotification(pushError(plan.message));
            return;
          }
          if (plan.kind === 'empty-mutations') {
            return;
          }
          const applyResponse = await hostClient.request(settingsApplyCommand(plan), {
            idempotencyKey: createGestureIdempotencyKey(),
          });
          const outcome = settingsSaveApplyFailureNotice(applyResponse, desktopLocale);
          if (outcome.kind === 'notice') {
            dispatchNotification(pushError(outcome.message));
          }
        })
        .catch((error: unknown) => {
          dispatchNotification(pushError(settingsSaveThrownNotice(error)));
        });
      queueRef.current = saveOperation;
      return saveOperation;
    },
    [desktopLocale, dispatchNotification, hostClient],
  );

  return { saveSettingsInOrder };
}
