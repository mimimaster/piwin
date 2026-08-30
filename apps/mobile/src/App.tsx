import { useState, useEffect, type ReactElement } from 'react';
import type { ConfiguredChatModel, ModelRef, ThinkingLevel } from '@piwin/contracts';
import { toModelRef } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { useKeyboardInset } from './hooks/use-keyboard-inset.js';
import { MobilePortal } from './mobile-portal.js';
import { MobileTopBar } from './components/navigation/MobileTopBar.js';
import { MobileSidebarDrawer } from './components/navigation/MobileSidebarDrawer.js';
import { SettingsModal } from './components/modals/SettingsModal.js';
import { InboxModal } from './components/modals/InboxModal.js';
import { ModelPickerModal } from './components/modals/ModelPickerModal.js';
import { MobileShareModal } from './components/modals/MobileShareModal.js';
import { ProjectFilesSheet } from './components/modals/ProjectFilesSheet.js';
import { SkillsInspectorSheet } from './components/modals/SkillsInspectorSheet.js';
import { MobileLiveSheet } from './components/modals/MobileLiveSheet.js';
import { ConnectionSurface } from './surfaces/connection/ConnectionSurface.js';
import { ConversationSurface } from './surfaces/conversation/ConversationSurface.js';
import { HealthConsentSheet } from './health/HealthConsentSheet.js';
import { useMobileHost } from './hooks/use-mobile-host.js';
import { useTheme } from './hooks/use-theme.js';
import { useMobileLive } from './hooks/use-mobile-live.js';
import { readMobileOverlayHash, setMobileOverlayHash } from './mobile-overlay-hash.js';
import { MOBILE_THEME } from './mobile-theme.js';

function modelDisplayName(model: ConfiguredChatModel | undefined): string | undefined {
  if (model === undefined) {
    return undefined;
  }
  return model.label?.trim() || model.modelId;
}

export function App(): ReactElement {
  const [overlayHash, setOverlayHash] = useState(readMobileOverlayHash);
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>();
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>();
  const [selectedThinkingLevel, setSelectedThinkingLevel] = useState<ThinkingLevel | undefined>();
  const [showConnectionConfig, setShowConnectionConfig] = useState(false);
  useKeyboardInset();

  useEffect(() => {
    const handleHashChange = () => {
      setOverlayHash(readMobileOverlayHash());
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const { themeMode, setThemeMode } = useTheme();
  const host = useMobileHost();
  const isConnected = host.connectionState.kind === 'ready';
  const live = useMobileLive({
    hostClient: host.client,
    sessionId: host.activeSessionId,
    ensureSession: async () => host.activeSessionId ?? (await host.handleCreateSession()),
  });

  useEffect(() => {
    if (overlayHash === '#inbox') {
      host.refreshActivitySummary();
    }
  }, [overlayHash]);

  useEffect(() => {
    if (host.configuredModels.length === 0) {
      return;
    }
    const selected = host.configuredModels.find(
      (model) => model.providerId === selectedProviderId && model.modelId === selectedModelId,
    );
    if (selected !== undefined) {
      return;
    }
    const fallback =
      host.configuredModels.find(
        (model) =>
          model.providerId === host.defaultProviderId && model.modelId === host.defaultModelId,
      ) ?? host.configuredModels[0];
    if (fallback === undefined) {
      return;
    }
    setSelectedProviderId(fallback.providerId);
    setSelectedModelId(fallback.modelId);
    if (fallback.thinkingLevel !== undefined) {
      setSelectedThinkingLevel(fallback.thinkingLevel);
    }
  }, [
    host.configuredModels,
    host.defaultModelId,
    host.defaultProviderId,
    selectedModelId,
    selectedProviderId,
  ]);

  const selectedModel = host.configuredModels.find(
    (model) => model.providerId === selectedProviderId && model.modelId === selectedModelId,
  );
  const selectedModelRef: ModelRef | undefined =
    selectedModel === undefined
      ? undefined
      : toModelRef({
          providerId: selectedModel.providerId,
          modelId: selectedModel.modelId,
          ...(selectedModel.protocol !== undefined ? { protocol: selectedModel.protocol } : {}),
          ...(selectedModel.source !== undefined ? { source: selectedModel.source } : {}),
        });

  const activeSession = host.sessions.find((s) => s.sessionId === host.activeSessionId);
  const activeProject =
    activeSession?.projectId !== undefined
      ? host.projects.find((project) => project.projectId === activeSession.projectId)?.displayName
      : undefined;

  const closeOverlay = () => setMobileOverlayHash('');

  return (
    <PiwinUiProvider manifest={MOBILE_THEME}>
      <main className="mobile-shell">
        {!isConnected || showConnectionConfig ? (
          <div className="mobile-view-wrapper">
            <MobileTopBar
              sessionTitle="Piwin Host 连接"
              connectionState={host.connectionState}
              onToggleSidebar={() => setShowConnectionConfig(true)}
              onNewChat={() => setShowConnectionConfig(true)}
              onOpenSettings={() => setShowConnectionConfig(true)}
            />
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
              onBackToApp={isConnected ? () => setShowConnectionConfig(false) : undefined}
            />
          </div>
        ) : (
          <div className="mobile-view-wrapper">
            <MobileTopBar
              sessionTitle={activeSession?.name}
              projectName={activeProject}
              activeModelName={modelDisplayName(selectedModel)}
              thinkingLevel={selectedThinkingLevel}
              connectionState={host.connectionState}
              activeRunCount={host.activityItems.length}
              onOpenLive={() => setMobileOverlayHash('#live')}
              liveActive={live.owned && live.call !== null}
              liveStarting={live.starting}
              onToggleSidebar={() => setMobileOverlayHash('#sidebar')}
              onOpenModelPicker={() => setMobileOverlayHash('#model-picker')}
              onNewChat={() => {
                setMobileOverlayHash('');
                void host.handleCreateSession(undefined);
              }}
              onOpenSettings={() => setMobileOverlayHash('#settings')}
            />

            <ConversationSurface
              activeSessionId={host.activeSessionId}
              sessions={host.sessions}
              messages={host.messages}
              htmlUiModeEnabled={host.artifactEnabled}
              composerText={host.composerText}
              setComposerText={host.setComposerText}
              attachments={host.attachments}
              onRemoveAttachment={host.removeAttachment}
              onFileSelected={(e) => void host.handleFileSelected(e)}
              onSend={(text) =>
                void host.handleSend({
                  ...(text === undefined ? {} : { text }),
                  ...(selectedModelRef ? { model: selectedModelRef } : {}),
                  ...(selectedThinkingLevel ? { thinkingLevel: selectedThinkingLevel } : {}),
                })
              }
              onAbort={() => void host.handleAbort()}
              onSpeechError={host.setErrorMessage}
              isSending={host.isSending}
              isUploadingMedia={host.isUploadingMedia}
              activeRunId={host.activeRunId}
              permissionRequest={host.permissionRequest}
              isResolvingPermission={host.isResolvingPermission}
              onResolvePermission={(decision) => void host.handleResolvePermission(decision)}
              onNavigateToSessions={() => setMobileOverlayHash('#sidebar')}
              projectName={activeProject}
              errorMessage={host.errorMessage}
              pendingReplaceRunId={host.pendingReplaceRunId}
              mutationsEnabled={host.mutationsEnabled}
              onQueueAndSend={() => void host.handleQueueAndSend()}
              onDismissBusy={host.handleDismissBusy}
              healthEnabled={host.healthEnabled}
              includeAppleHealth={host.includeAppleHealth}
              onToggleAppleHealth={() => host.setIncludeAppleHealth((value) => !value)}
              onReplaceAndSend={() => {
                if (host.pendingReplaceRunId === undefined) {
                  return;
                }
                void host.handleSend(
                  {
                    ...(selectedModelRef ? { model: selectedModelRef } : {}),
                    ...(selectedThinkingLevel ? { thinkingLevel: selectedThinkingLevel } : {}),
                  },
                  host.pendingReplaceRunId,
                );
              }}
            />

            <MobileSidebarDrawer
              isOpen={overlayHash === '#sidebar'}
              onClose={closeOverlay}
              projects={host.projects}
              sessions={host.sessions}
              activeSessionId={host.activeSessionId}
              onSelectSession={(id) => {
                void host.handleSelectSession(id);
              }}
              onNewChat={(projectId) => {
                void host.handleCreateSession(projectId);
              }}
              onPinSession={(id, isPinned) => {
                void host.handlePinSession(id, isPinned);
              }}
              onRenameSession={(id, name) => {
                void host.handleRenameSession(id, name);
              }}
              onDeleteSession={(id) => {
                void host.handleDeleteSession(id);
              }}
              onOpenSettings={() => setMobileOverlayHash('#settings')}
              onOpenInbox={() => setMobileOverlayHash('#inbox')}
              onOpenFiles={() => setMobileOverlayHash('#files')}
              onOpenSkills={() => setMobileOverlayHash('#skills')}
              onOpenShare={() => setMobileOverlayHash('#share')}
              activeRunCount={host.activityItems.length}
              endpoint={host.endpoint}
              isConnected={isConnected}
            />

            <SettingsModal
              isOpen={overlayHash === '#settings'}
              onClose={closeOverlay}
              hostStatus={host.hostStatus}
              connectionState={host.connectionState}
              endpoint={host.endpoint}
              projectCount={host.projects.length}
              sessionCount={host.sessions.length}
              themeMode={themeMode}
              onSelectTheme={setThemeMode}
              onDisconnect={() => void host.handleDisconnect()}
              onOpenConnection={() => setShowConnectionConfig(true)}
              healthAvailable={host.healthAvailable}
              healthUseMode={host.healthUseMode}
              onChangeHealthUseMode={host.handleChangeHealthUseMode}
              onConnectHealth={() => void host.handleConnectAppleHealth()}
              onDisconnectHealth={() => void host.handleDisconnectAppleHealth()}
            />

            <InboxModal
              isOpen={overlayHash === '#inbox'}
              onClose={closeOverlay}
              items={host.activityItems}
              sessions={host.sessions}
              isResolvingPermission={host.isResolvingPermission}
              onResolvePermission={(requestId, decision) =>
                void host.handleResolvePermission(decision, requestId)
              }
              onAbortRun={(sessionId, runId) => {
                void host.handleAbort(runId === undefined ? { sessionId } : { sessionId, runId });
              }}
              onNavigateToSession={(sessionId) => {
                void host.handleSelectSession(sessionId);
              }}
            />

            <ProjectFilesSheet
              isOpen={overlayHash === '#files'}
              onClose={closeOverlay}
              projects={host.projects}
              activeProjectId={activeSession?.projectId}
              activeProjectName={activeProject}
            />

            <SkillsInspectorSheet
              isOpen={overlayHash === '#skills'}
              onClose={closeOverlay}
              endpoint={host.endpoint}
            />

            <ModelPickerModal
              isOpen={overlayHash === '#model-picker'}
              onClose={closeOverlay}
              models={host.configuredModels}
              selectedProviderId={selectedProviderId}
              selectedModelId={selectedModelId}
              selectedThinkingLevel={selectedThinkingLevel}
              onSelectModel={(modelId, providerId) => {
                setSelectedProviderId(providerId);
                setSelectedModelId(modelId);
                const next = host.configuredModels.find(
                  (model) => model.providerId === providerId && model.modelId === modelId,
                );
                if (next?.thinkingLevel !== undefined) {
                  setSelectedThinkingLevel(next.thinkingLevel);
                }
              }}
              onSelectThinkingLevel={setSelectedThinkingLevel}
            />

            <MobileShareModal
              isOpen={overlayHash === '#share'}
              onClose={closeOverlay}
              sessionTitle={activeSession?.name}
              messages={host.messages}
            />

            <MobileLiveSheet isOpen={overlayHash === '#live'} onClose={closeOverlay} live={live} />

            {host.healthConsentRequest !== undefined ? (
              <MobilePortal>
                <div className="mobile-modal-overlay">
                  <HealthConsentSheet
                    request={host.healthConsentRequest}
                    hostLabel={host.endpoint || '当前 Host'}
                    onDecide={host.resolveHealthConsent}
                    alwaysAllowUnlocked={host.healthAlwaysAllowUnlocked}
                  />
                </div>
              </MobilePortal>
            ) : null}
          </div>
        )}
      </main>
    </PiwinUiProvider>
  );
}
