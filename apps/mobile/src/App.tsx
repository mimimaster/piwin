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
 * Inkstone mobile shell.
 *
 * ConnectionSurface handles host pairing & endpoint configuration.
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
              onConnect={(input) => {
                void host.handleConnect(input).then((connected) => {
                  if (connected) {
                    setShowConnectionConfig(false);
                  }
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
