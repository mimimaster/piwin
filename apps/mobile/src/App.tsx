import { useState, useEffect, type ReactElement } from 'react';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { MobileTopBar } from './components/navigation/MobileTopBar.js';
import { MobileSidebarDrawer } from './components/navigation/MobileSidebarDrawer.js';
import { SettingsModal } from './components/modals/SettingsModal.js';
import { InboxModal } from './components/modals/InboxModal.js';
import { ModelPickerModal, type ThinkingLevel } from './components/modals/ModelPickerModal.js';
import { MobileShareModal } from './components/modals/MobileShareModal.js';
import { ConnectionSurface } from './surfaces/connection/ConnectionSurface.js';
import { ConversationSurface } from './surfaces/conversation/ConversationSurface.js';
import { useMobileHost } from './hooks/use-mobile-host.js';
import { useTheme } from './hooks/use-theme.js';
import { MOBILE_THEME } from './mobile-theme.js';

export function App(): ReactElement {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('claude-3-7-sonnet');
  const [selectedThinkingLevel, setSelectedThinkingLevel] = useState<ThinkingLevel>('medium');
  const [showConnectionConfig, setShowConnectionConfig] = useState(false);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.toLowerCase();
      setIsSidebarOpen(hash === '#sidebar');
      setIsModelPickerOpen(hash === '#model-picker' || hash === '#model');
      setIsShareOpen(hash === '#share');
      setIsSettingsOpen(hash === '#settings');
      setIsInboxOpen(hash === '#inbox');
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const { themeMode, setThemeMode } = useTheme();
  const host = useMobileHost();
  const isConnected = host.connectionState.kind === 'ready';

  const activeSession = host.sessions.find((s) => s.sessionId === host.activeSessionId);
  const activeProject = activeSession?.scope === 'project'
    ? host.projects[0]?.displayName
    : undefined;

  return (
    <PiwinUiProvider manifest={MOBILE_THEME}>
      <main className="mobile-shell">
        {/* 1. If not connected or explicitly opened pairing, show ConnectionSurface */}
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
              connectionState={host.connectionState}
              errorMessage={host.errorMessage}
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
            {/* 2. Sleek 44px ChatGPT-Style Top Navigation Bar */}
            <MobileTopBar
              sessionTitle={activeSession?.name}
              projectName={activeProject}
              activeModelName={selectedModelId === 'claude-3-7-sonnet' ? 'Claude 3.7' : selectedModelId}
              connectionState={host.connectionState}
              onToggleSidebar={() => setIsSidebarOpen(true)}
              onOpenModelPicker={() => setIsModelPickerOpen(true)}
              onNewChat={() => {
                void host.handleCreateSession(undefined);
              }}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />

            {/* 3. Main Full-Screen Fluid Conversation Canvas */}
            <ConversationSurface
              activeSessionId={host.activeSessionId}
              sessions={host.sessions}
              messages={host.messages}
              composerText={host.composerText}
              setComposerText={host.setComposerText}
              attachments={host.attachments}
              onRemoveAttachment={host.removeAttachment}
              onFileSelected={(e) => void host.handleFileSelected(e)}
              onSend={() => void host.handleSend()}
              onAbort={() => void host.handleAbort()}
              isSending={host.isSending}
              isUploadingMedia={host.isUploadingMedia}
              activeRunId={host.activeRunId}
              permissionRequest={host.permissionRequest}
              isResolvingPermission={host.isResolvingPermission}
              onResolvePermission={(decision) => void host.handleResolvePermission(decision)}
              onNavigateToSessions={() => setIsSidebarOpen(true)}
              projectName={activeProject}
            />

            {/* 4. Slide-out Left Sidebar Drawer */}
            <MobileSidebarDrawer
              isOpen={isSidebarOpen}
              onClose={() => setIsSidebarOpen(false)}
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
              onOpenSettings={() => setIsSettingsOpen(true)}
              onOpenInbox={() => setIsInboxOpen(true)}
              onOpenShare={() => setIsShareOpen(true)}
              activeRunCount={host.activeRunId !== undefined ? 1 : 0}
              endpoint={host.endpoint}
              isConnected={isConnected}
            />

            {/* 5. Theme & Settings Modal Sheet */}
            <SettingsModal
              isOpen={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
              hostStatus={host.hostStatus}
              connectionState={host.connectionState}
              endpoint={host.endpoint}
              projectCount={host.projects.length}
              sessionCount={host.sessions.length}
              themeMode={themeMode}
              onSelectTheme={setThemeMode}
              onDisconnect={() => void host.handleDisconnect()}
              onOpenConnection={() => setShowConnectionConfig(true)}
            />

            {/* 6. Tasks & Permissions Inbox Modal Sheet */}
            <InboxModal
              isOpen={isInboxOpen}
              onClose={() => setIsInboxOpen(false)}
              activeRunId={host.activeRunId}
              permissionRequest={host.permissionRequest}
              isResolvingPermission={host.isResolvingPermission}
              onResolvePermission={(decision) => void host.handleResolvePermission(decision)}
              onAbortRun={() => void host.handleAbort()}
              onNavigateToChat={() => setIsInboxOpen(false)}
            />

            {/* 7. Model & Reasoning Picker Modal Sheet */}
            <ModelPickerModal
              isOpen={isModelPickerOpen}
              onClose={() => setIsModelPickerOpen(false)}
              selectedModelId={selectedModelId}
              selectedThinkingLevel={selectedThinkingLevel}
              onSelectModel={(modelId) => setSelectedModelId(modelId)}
              onSelectThinkingLevel={(level) => setSelectedThinkingLevel(level)}
            />

            {/* 8. Share & Export Modal Sheet */}
            <MobileShareModal
              isOpen={isShareOpen}
              onClose={() => setIsShareOpen(false)}
              sessionTitle={activeSession?.name}
              messages={host.messages}
            />
          </div>
        )}
      </main>
    </PiwinUiProvider>
  );
}
