import { useEffect, useState, type ReactElement } from 'react';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { MOBILE_THEME } from './mobile-theme.js';
import { InkstoneApp } from './inkstone/InkstoneApp.js';
import type { InkstoneHostContextValue } from './inkstone/host/inkstone-host-context.js';
import { useInkstoneModelSelection } from './inkstone/host/use-inkstone-model-selection.js';
import { useKeyboardInset } from './hooks/use-keyboard-inset.js';
import { useMobileHost } from './hooks/use-mobile-host.js';
import { ConnectionSurface } from './surfaces/connection/ConnectionSurface.js';
import { FlashcardsSurface } from './surfaces/flashcards/FlashcardsSurface.js';
import {
  parseMobileFlashcardsRoute,
  subscribeMobileFlashcardsRoute,
  type MobileFlashcardsRoute,
} from './mobile-flashcards-route.js';

/**
 * Inkstone shell (visual truth: docs/design/inkstone/proto-08-mobile.html).
 *
 * Always keep the paper/ink shell mounted. ConnectionSurface is an explicit
 * overlay opened from 管理连接 — never replace the whole shell just because
 * Host is offline (that was wiping the 砚台 theme on cold start).
 */
export function App(): ReactElement {
  const host = useMobileHost();
  const [showConnectionConfig, setShowConnectionConfig] = useState(false);
  const [flashcardsRoute, setFlashcardsRoute] = useState<MobileFlashcardsRoute | null>(() =>
    parseMobileFlashcardsRoute(),
  );
  useKeyboardInset();

  useEffect(() => subscribeMobileFlashcardsRoute(setFlashcardsRoute), []);

  const modelSelection = useInkstoneModelSelection(host);

  if (showConnectionConfig) {
    return (
      <PiwinUiProvider manifest={MOBILE_THEME}>
        <main className="inkstone-root">
          <div className="phone">
            <ConnectionSurface
              endpoint={host.endpoint}
              setEndpoint={host.setEndpoint}
              authToken={host.authToken}
              setAuthToken={host.setAuthToken}
              pairingToken={host.pairingToken}
              setPairingToken={host.setPairingToken}
              setExpectedHostInstanceId={host.setExpectedHostInstanceId}
              connectionState={host.connectionState}
              errorMessage={host.errorMessage}
              credentialPersistError={host.credentialPersistError}
              isNativeVault={host.isNativeVault}
              onRetryCredentialPersist={() => void host.retryCredentialPersist()}
              onConnect={(input) => {
                void host.handleConnect(input).then((ok) => {
                  if (ok) {
                    setShowConnectionConfig(false);
                  }
                });
              }}
              onDisconnect={() => void host.handleDisconnect()}
              onBackToApp={() => setShowConnectionConfig(false)}
            />
          </div>
        </main>
      </PiwinUiProvider>
    );
  }

  if (flashcardsRoute !== null) {
    return (
      <PiwinUiProvider manifest={MOBILE_THEME}>
        <FlashcardsSurface
          route={flashcardsRoute}
          client={host.client}
          hostStatus={host.hostStatus}
          connectionState={host.connectionState}
        />
      </PiwinUiProvider>
    );
  }

  const hostContext: InkstoneHostContextValue = {
    host,
    onOpenConnection: () => setShowConnectionConfig(true),
    modelSelection,
  };

  return (
    <PiwinUiProvider manifest={MOBILE_THEME}>
      <InkstoneApp hostContext={hostContext} />
    </PiwinUiProvider>
  );
}
