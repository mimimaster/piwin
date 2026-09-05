import { useState, type ReactElement } from 'react';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { MOBILE_THEME } from './mobile-theme.js';
import { InkstoneApp } from './inkstone/InkstoneApp.js';
import type { InkstoneHostContextValue } from './inkstone/host/inkstone-host-context.js';
import { useInkstoneModelSelection } from './inkstone/host/use-inkstone-model-selection.js';
import { useKeyboardInset } from './hooks/use-keyboard-inset.js';
import { useMobileHost } from './hooks/use-mobile-host.js';
import { ConnectionSurface } from './surfaces/connection/ConnectionSurface.js';

/**
 * Inkstone shell (visual truth: docs/design/inkstone/proto-08-mobile.html).
 *
 * While no Host connection is ready (or the user opens connection settings), the
 * proven ConnectionSurface handles endpoint/credential vault/pairing. Once ready,
 * the Inkstone pages run on live host data; screens without a wired feature still
 * render prototype data and say so.
 */
export function App(): ReactElement {
  const host = useMobileHost();
  const [showConnectionConfig, setShowConnectionConfig] = useState(false);
  useKeyboardInset();

  const connected = host.connectionState.kind === 'ready';
  const modelSelection = useInkstoneModelSelection(host);

  if (!connected || showConnectionConfig) {
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
              onConnect={() => {
                void host.handleConnect().then(() => {
                  setShowConnectionConfig(false);
                });
              }}
              onDisconnect={() => void host.handleDisconnect()}
              onBackToApp={connected ? () => setShowConnectionConfig(false) : undefined}
            />
          </div>
        </main>
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
