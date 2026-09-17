import { useEffect, useRef, useState, type Dispatch } from 'react';
import type { HostClient } from '@piwin/host-client';
import { setMobileCatchUpDraft } from '../mobile-attention-catch-up.js';
import {
  createMobileAttentionController,
  type MobileAttentionBanner,
  type MobileAttentionController,
} from '../mobile-attention-controller.js';
import {
  sendMobileLocalNotification,
  subscribeMobileNotificationAction,
} from '../mobile-attention-os.js';
import { readMobileAttentionPreferences } from '../mobile-attention-preferences.js';
import type { InkstoneAction, InkstoneRoute } from '../inkstone/demo-state.js';
import type { InkstoneHost } from '../inkstone/host/inkstone-host-context.js';

export type UseMobileAttentionArgs = {
  host: InkstoneHost | null;
  route: InkstoneRoute;
  dispatch: Dispatch<InkstoneAction>;
};

export type UseMobileAttentionResult = {
  banner: MobileAttentionBanner | null;
  dismissBanner: () => void;
  openBannerSession: () => void;
};

function presenceFromDocument(): 'active' | 'inactive' {
  if (typeof document === 'undefined') {
    return 'active';
  }
  return document.visibilityState === 'visible' ? 'active' : 'inactive';
}

export function useMobileAttention(args: UseMobileAttentionArgs): UseMobileAttentionResult {
  const { host, route, dispatch } = args;
  const [banner, setBanner] = useState<MobileAttentionBanner | null>(null);
  const controllerRef = useRef<MobileAttentionController | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    const client: HostClient | undefined = host?.client;
    if (client === undefined) {
      return;
    }
    const controller = createMobileAttentionController({
      subscribePush: (listener) => client.subscribePush((push) => listener(push)),
      subscribeHydration: (listener) => client.subscribeHydration(() => listener()),
      subscribeSnapshot: (listener) => client.subscribeSnapshot(() => listener()),
      storage: window.localStorage,
      now: Date.now,
      setTimer: (callback, ms) => {
        const timer = window.setTimeout(callback, ms);
        return () => window.clearTimeout(timer);
      },
      getSnapshot: () => {
        const current = hostRef.current;
        const activeSessionId = current?.activeSessionId ?? null;
        const onChat = routeRef.current === 'chat';
        return {
          presence: presenceFromDocument(),
          visibleSessionIds: onChat && activeSessionId !== null ? new Set([activeSessionId]) : new Set(),
          activeSessionId,
          conversationCovered: !onChat,
          preferences: readMobileAttentionPreferences(),
          hostReady: current !== null && current.connectionState.kind === 'ready',
          describeSession: (sessionId) => {
            const session = current?.sessions.find((item) => item.sessionId === sessionId);
            return {
              ...(session?.name ? { sessionTitle: session.name } : {}),
            };
          },
        };
      },
      showForegroundBanner: (next) => {
        setBanner(next);
      },
      sendLocalNotification: sendMobileLocalNotification,
      onCatchUpSummary: (items) => {
        setMobileCatchUpDraft(items);
        dispatch({ type: 'open-sheet', key: 'attention-catch-up' });
      },
    });
    controllerRef.current = controller;
    const onVisibility = (): void => {
      controller.onPresenceChanged(presenceFromDocument());
    };
    document.addEventListener('visibilitychange', onVisibility);
    let unsubAction: (() => void) | undefined;
    void subscribeMobileNotificationAction((sessionId) => {
      dispatch({ type: 'navigate', route: 'chat' });
      void hostRef.current?.handleSelectSession(sessionId);
    }).then((unsub) => {
      unsubAction = unsub;
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      unsubAction?.();
      controller.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [dispatch, host?.client]);

  return {
    banner,
    dismissBanner: () => {
      setBanner(null);
    },
    openBannerSession: () => {
      if (banner === null) {
        return;
      }
      const sessionId = banner.sessionId;
      setBanner(null);
      dispatch({ type: 'navigate', route: 'chat' });
      void hostRef.current?.handleSelectSession(sessionId);
    },
  };
}
