/**
 * In-order settings/apply queue. Planning lives in settings-save-queue.ts so
 * App does not grow another inline save path.
 */
import { useCallback, type Dispatch } from 'react';
import type { PiwinConfig, SettingsMutation } from '@piwin/contracts';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import type { DesktopLocale } from '../desktop-locale';
import type { HostClient } from '../host-client';
import { pushError, type NotificationAction } from '../notification-queue';
import { enqueueSettingsApply } from '../settings-apply-chain.js';
import {
  executeSettingsSaveCycle,
  settingsApplyCommand,
  settingsSaveThrownNotice,
} from '../settings-save-queue';

export type UseSettingsSaveQueueArgs = {
  hostClient: HostClient;
  desktopLocale: DesktopLocale;
  dispatchNotification: Dispatch<NotificationAction>;
};

export type SaveSettingsInOrderOptions = {
  notify?: boolean;
};

export type SaveSettingsInOrder = (
  buildMutations: (currentConfig: PiwinConfig) => SettingsMutation[],
  options?: SaveSettingsInOrderOptions,
) => Promise<boolean>;

export function useSettingsSaveQueue(args: UseSettingsSaveQueueArgs): {
  saveSettingsInOrder: SaveSettingsInOrder;
} {
  const { hostClient, desktopLocale, dispatchNotification } = args;

  const saveSettingsInOrder = useCallback<SaveSettingsInOrder>(
    (buildMutations, options) => {
      const notify = options?.notify ?? true;
      return enqueueSettingsApply(async () => {
        try {
          const result = await executeSettingsSaveCycle({
            requestGet: () => hostClient.request({ type: 'settings/get' }),
            requestApply: (plan) =>
              hostClient.request(settingsApplyCommand(plan), {
                idempotencyKey: createGestureIdempotencyKey(),
              }),
            buildMutations,
            transport: hostClient.getTransport(),
            locale: desktopLocale,
          });
          if (result.kind === 'failed') {
            if (notify) {
              dispatchNotification(pushError(result.message));
            }
            return false;
          }
          return true;
        } catch (error: unknown) {
          if (notify) {
            dispatchNotification(pushError(settingsSaveThrownNotice(error)));
          }
          return false;
        }
      });
    },
    [desktopLocale, dispatchNotification, hostClient],
  );

  return { saveSettingsInOrder };
}
