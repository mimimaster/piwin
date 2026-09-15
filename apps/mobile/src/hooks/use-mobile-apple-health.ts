import { useState, type MutableRefObject } from 'react';
import type { ClientToolRequestFrame } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import {
  type ClientToolPreferenceStore,
  type HealthForegroundUseMode,
} from '../client-tools/client-tool-preferences.js';
import type { MobileClientToolConsentDecision } from '../client-tools/mobile-client-tool-runtime.js';
import type { MobileClientToolRuntime } from '../client-tools/mobile-client-tool-runtime.js';
import {
  advertiseMobileHealthRuntime,
  healthExecutorUsable,
  readHealthConnectedSetting,
  writeForegroundUseMode,
  writeHealthConnectedSetting,
} from '../client-tools/mobile-health-session.js';
import {
  healthkitRequestReadAuthorization,
} from '../health/native-healthkit.js';
import { toError } from '../mobile-host-helpers.js';

export interface UseMobileAppleHealthOptions {
  clientRef: MutableRefObject<HostClient | undefined>;
  healthRuntimeRef: MutableRefObject<MobileClientToolRuntime | undefined>;
  healthPreferencesRef: MutableRefObject<ClientToolPreferenceStore>;
  healthScopeKeyRef: MutableRefObject<string | undefined>;
  healthConsentResolverRef: MutableRefObject<
    ((decision: MobileClientToolConsentDecision) => void) | undefined
  >;
  setErrorMessage: (message: string | undefined) => void;
}

export function useMobileAppleHealth({
  clientRef,
  healthRuntimeRef,
  healthPreferencesRef,
  healthScopeKeyRef,
  healthConsentResolverRef,
  setErrorMessage,
}: UseMobileAppleHealthOptions) {
  const [healthNativeAvailable, setHealthNativeAvailable] = useState(false);
  const [healthConnected, setHealthConnected] = useState(readHealthConnectedSetting);
  const [healthUseMode, setHealthUseMode] = useState<HealthForegroundUseMode>('ask-every-time');
  const [includeAppleHealth, setIncludeAppleHealth] = useState(false);
  const [hostSupportsClientTools, setHostSupportsClientTools] = useState(false);
  const [healthConsentRequest, setHealthConsentRequest] = useState<ClientToolRequestFrame | undefined>();
  const [healthAlwaysAllowUnlocked, setHealthAlwaysAllowUnlocked] = useState(false);

  const healthEnabled =
    healthConnected &&
    healthUseMode !== 'off' &&
    hostSupportsClientTools &&
    healthExecutorUsable({
      nativeAvailable: healthNativeAvailable,
      production: import.meta.env.PROD === true,
      allowFake: import.meta.env.DEV === true,
    });

  const handleConnectAppleHealth = async (): Promise<void> => {
    const runtime = healthRuntimeRef.current;
    if (runtime === undefined || clientRef.current === undefined) {
      return;
    }
    if (healthNativeAvailable) {
      try {
        await healthkitRequestReadAuthorization();
      } catch (error) {
        setErrorMessage(toError(error, 'Apple Health 授权失败。').message);
        return;
      }
    } else if (import.meta.env.PROD === true) {
      setErrorMessage('当前设备不支持 Apple Health。');
      return;
    }
    writeHealthConnectedSetting(true);
    setHealthConnected(true);
    if (healthUseMode === 'off') {
      setHealthUseMode('ask-every-time');
      const scopeKey = healthScopeKeyRef.current;
      if (scopeKey !== undefined) {
        writeForegroundUseMode(healthPreferencesRef.current, scopeKey, 'ask-every-time');
      }
    }
    runtime.setHealthEnabled(true);
    await advertiseMobileHealthRuntime(runtime);
  };

  const handleDisconnectAppleHealth = async (): Promise<void> => {
    const runtime = healthRuntimeRef.current;
    writeHealthConnectedSetting(false);
    setHealthConnected(false);
    setIncludeAppleHealth(false);
    if (runtime !== undefined) {
      runtime.setHealthEnabled(false);
      await advertiseMobileHealthRuntime(runtime);
    }
    const scopeKey = healthScopeKeyRef.current;
    if (scopeKey !== undefined) {
      healthPreferencesRef.current.clear(scopeKey);
    }
    setHealthUseMode('ask-every-time');
  };

  const handleChangeHealthUseMode = (mode: HealthForegroundUseMode): void => {
    setHealthUseMode(mode);
    const scopeKey = healthScopeKeyRef.current;
    if (scopeKey !== undefined) {
      writeForegroundUseMode(healthPreferencesRef.current, scopeKey, mode);
    }
    const runtime = healthRuntimeRef.current;
    if (runtime === undefined) {
      return;
    }
    runtime.setHealthEnabled(mode !== 'off' && healthConnected);
    void advertiseMobileHealthRuntime(runtime);
  };

  const resolveHealthConsent = (decision: MobileClientToolConsentDecision): void => {
    const resolve = healthConsentResolverRef.current;
    healthConsentResolverRef.current = undefined;
    setHealthConsentRequest(undefined);
    resolve?.(decision);
  };

  return {
    healthNativeAvailable,
    setHealthNativeAvailable,
    healthConnected,
    setHealthConnected,
    healthUseMode,
    setHealthUseMode,
    includeAppleHealth,
    setIncludeAppleHealth,
    hostSupportsClientTools,
    setHostSupportsClientTools,
    healthConsentRequest,
    setHealthConsentRequest,
    healthAlwaysAllowUnlocked,
    setHealthAlwaysAllowUnlocked,
    healthEnabled,
    handleConnectAppleHealth,
    handleDisconnectAppleHealth,
    handleChangeHealthUseMode,
    resolveHealthConsent,
  };
}
