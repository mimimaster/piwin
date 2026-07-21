import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import type {
  ExecutionMode,
  ExtensionUiKind,
  HostResponse,
  HostServerMessage,
  MediaAttachmentRef,
  MediaSaveData,
  ModelRef,
  PermissionDecision,
  PiwinConfig,
  ManagedProcessRecord,
  SessionPlan,
  SessionSearchHit,
  SessionSummary,
  SessionTranscriptMessage,
  ThemeManifest,
} from '@piwin/contracts';
import { toMediaAttachmentRef } from '@piwin/contracts';
import { Button, Dialog } from '@piwin/ui-kit';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';
import { HostClient } from './host-client';
import { MarkdownView } from './MarkdownView';
import { MediaPreview } from './MediaPreview';
import {
  fileToBase64,
  isAllowedImageFile,
  type PendingComposerAttachment,
} from './media-utils';
import { SettingsPanel } from './SettingsPanel';
import { GitPanel } from './GitPanel';
import { applyThemeToDocument } from './ThemePanel';
import {
  PIWIN_APPEARANCE_DARK,
  resolveBuiltinAppearance,
} from './appearance-tokens';
import {
  IconChat,
  IconChevronDown,
  IconCompress,
  IconExtension,
  IconFolder,
  IconGit,
  IconMoon,
  IconMore,
  IconPet,
  IconPlug,
  IconPlus,
  IconSearch,
  IconSend,
  IconSettings,
  IconSpark,
  IconStop,
  IconSun,
  IconTerminal,
  IconUsers,
} from './shell-icons';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { PetCompanion } from './PetCompanion';
import { petStateFromChatFlags } from '@piwin/pet/agent-state';
import type { PetRuntimeSnapshot } from '@piwin/contracts';
import { appendHostLogEntry, type HostLogEntry } from './HostLogPanel';
import { SubAgentPanel } from './SubAgentPanel';
import { RightPanel, type RightPanelTab } from './right-panel';
import { ToolCallCard, collectSessionTools } from './tool-call-card';
import { MessageActions } from './message-actions';
import { ChangesPanel } from './changes-panel';
import { TerminalDock } from './terminal-dock';
import {
  applyAgentModeToPrompt,
  getAgentMode,
  type AgentModeId,
} from './agent-mode';
import { groupSessionsByRecency } from './session-groups';
import {
  loadToolCallDensity,
  saveToolCallDensity,
  type ToolCallDensity,
} from './ui-preferences';
import {
  ComposerPlusMenu,
  type ComposerPlusSubmenu,
} from './composer-plus-menu';


type ModelOption = {
  providerId: string;
  protocol: 'openai-compatible' | 'anthropic-compatible';
  modelId: string;
  label: string;
};

function modelsFromConfig(config: PiwinConfig | null): ModelOption[] {
  if (!config) {
    return [];
  }
  const options: ModelOption[] = [];
  for (const provider of config.providers) {
    for (const model of provider.models) {
      options.push({
        providerId: provider.id,
        protocol: provider.protocol,
        modelId: model.id,
        label: `${provider.name} / ${model.label ?? model.id}`,
      });
    }
  }
  return options;
}



function formatUsageChip(usage: {
  tokensUsed?: number;
  tokensLimit?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  contextRatio?: number;
}): string {
  const used = usage.tokensUsed ?? usage.totalTokens;
  const limit = usage.tokensLimit;
  if (typeof used === 'number' && typeof limit === 'number') {
    const pct = typeof usage.contextRatio === 'number'
      ? Math.round(usage.contextRatio * 100)
      : Math.round((used / limit) * 100);
    return `${used.toLocaleString()} / ${limit.toLocaleString()} · ${pct}%`;
  }
  if (typeof usage.promptTokens === 'number' || typeof usage.completionTokens === 'number') {
    const prompt = usage.promptTokens ?? 0;
    const completion = usage.completionTokens ?? 0;
    return `in ${prompt.toLocaleString()} · out ${completion.toLocaleString()}`;
  }
  if (typeof used === 'number') {
    return `${used.toLocaleString()} tokens`;
  }
  return 'usage · unknown';
}

function projectDisplayName(projectPath: string | null): string {
  if (!projectPath) {
    return 'No project';
  }
  const parts = projectPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

export function App() {
  const hostClient = useMemo(
    () => new HostClient({ transport: 'auto', hostMock: false }),
    [],
  );
  const [state, dispatch] = useReducer(chatUiReducer, undefined, createInitialChatUiState);
  const [composer, setComposer] = useState('');
  const [projectInput, setProjectInput] = useState('/Users/yorickjue/Projects/piwin');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    | 'general'
    | 'appearance'
    | 'skills'
    | 'extensions'
    | 'prompts'
    | 'tools'
  >('general');
  const [extensionUiRequest, setExtensionUiRequest] = useState<{
    sessionId: string;
    requestId: string;
    kind: ExtensionUiKind;
    title: string;
    message?: string;
    options?: string[];
    placeholder?: string;
  } | null>(null);
  const [extensionUiInput, setExtensionUiInput] = useState('');
  const [sessionPlan, setSessionPlan] = useState<SessionPlan | null>(null);
  const [activeTheme, setActiveTheme] = useState<ThemeManifest | null>(null);
  const [activePet, setActivePet] = useState<PetRuntimeSnapshot | null>(null);
  const [artifactThemeKey, setArtifactThemeKey] = useState(0);
  const [hostLogEntries, setHostLogEntries] = useState<HostLogEntry[]>([]);
  const [terminalDockOpen, setTerminalDockOpen] = useState(false);
  const [railNav, setRailNav] = useState<
    'chats' | 'workspace' | 'skills' | 'mcp' | 'extensions' | 'prompts' | 'settings' | 'theme' | 'git' | 'pet'
  >('chats');
  const [sessionSearch, setSessionSearch] = useState('');
  const [projectPickerOpen, setProjectPickerOpen] = useState(true);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('execution');
  const [managedProcesses, setManagedProcesses] = useState<ManagedProcessRecord[]>([]);
  const [processLogsById, setProcessLogsById] = useState<Record<string, string>>({});
  const [agentMode, setAgentMode] = useState<AgentModeId>('agent');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('agent');
  const [remoteSearchHits, setRemoteSearchHits] = useState<SessionSearchHit[] | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [toolCallDensity, setToolCallDensity] = useState<ToolCallDensity>(() =>
    loadToolCallDensity(),
  );
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [plusSubmenu, setPlusSubmenu] = useState<ComposerPlusSubmenu>('none');
  const [menuSkills, setMenuSkills] = useState<
    Array<{ id: string; name: string; enabled: boolean }>
  >([]);
  const [menuMcp, setMenuMcp] = useState<
    Array<{ id: string; name: string; running: boolean }>
  >([]);

  const [config, setConfig] = useState<PiwinConfig | null>(null);
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingComposerAttachment[]>([]);
  const [dropActive, setDropActive] = useState(false);

  const modelOptions = useMemo(() => modelsFromConfig(config), [config]);

  const requestSubAgent = useCallback(
    async (command: {
      type:
        | 'session/spawn'
        | 'session/list-children'
        | 'session/cancel-subagent'
        | 'session/complete-subagent'
        | 'session/merge-subagent';
      parentSessionId?: string;
      sessionId?: string;
      childSessionId?: string;
      task?: string;
      sessionName?: string;
      status?: 'done' | 'failed';
      force?: boolean;
    }) => hostClient.request(command as never),
    [hostClient],
  );

  const requestConfig = useCallback(

    async (command: {
      type: 'config/get' | 'config/set';
      config?: PiwinConfig;
    }): Promise<HostResponse> => {
      if (command.type === 'config/get') {
        return hostClient.request({ type: 'config/get' });
      }
      return hostClient.request({ type: 'config/set', config: command.config! });
    },
    [hostClient],
  );

  const requestSkills = useCallback(
    async (command: {
      type: 'skills/list' | 'skills/set_enabled' | 'skills/install' | 'config/get' | 'config/set';
      projectPath?: string;
      skillId?: string;
      enabled?: boolean;
      source?: import('@piwin/contracts').InstallSource;
      name?: string;
      config?: import('@piwin/contracts').PiwinConfig;
    }): Promise<HostResponse> => {
      if (command.type === 'config/get') {
        return hostClient.request({ type: 'config/get' });
      }
      if (command.type === 'config/set') {
        return hostClient.request({ type: 'config/set', config: command.config! });
      }
      if (command.type === 'skills/list') {
        const payload: { type: 'skills/list'; projectPath?: string } = { type: 'skills/list' };
        if (command.projectPath) {
          payload.projectPath = command.projectPath;
        }
        return hostClient.request(payload);
      }
      if (command.type === 'skills/install') {
        if (!command.source) {
          return {
            type: 'response',
            command: 'skills/install',
            success: false,
            error: 'missing install source',
          };
        }
        const payload: {
          type: 'skills/install';
          source: import('@piwin/contracts').InstallSource;
          name?: string;
        } = { type: 'skills/install', source: command.source };
        if (command.name) {
          payload.name = command.name;
        }
        return hostClient.request(payload);
      }
      return hostClient.request({
        type: 'skills/set_enabled',
        skillId: command.skillId ?? '',
        enabled: command.enabled === true,
      });
    },
    [hostClient],
  );

  const requestExtensions = useCallback(
    async (command: {
      type:
        | 'extensions/list'
        | 'extensions/set_enabled'
        | 'extensions/ensure-bundled'
        | 'extensions/install';
      projectPath?: string;
      extensionId?: string;
      enabled?: boolean;
      source?: import('@piwin/contracts').InstallSource;
      name?: string;
    }): Promise<HostResponse> => {
      if (command.type === 'extensions/list') {
        const payload: { type: 'extensions/list'; projectPath?: string } = {
          type: 'extensions/list',
        };
        if (command.projectPath) {
          payload.projectPath = command.projectPath;
        }
        return hostClient.request(payload);
      }
      if (command.type === 'extensions/ensure-bundled') {
        return hostClient.request({ type: 'extensions/ensure-bundled' });
      }
      if (command.type === 'extensions/install') {
        if (!command.source) {
          return {
            type: 'response',
            command: 'extensions/install',
            success: false,
            error: 'missing install source',
          };
        }
        const payload: {
          type: 'extensions/install';
          source: import('@piwin/contracts').InstallSource;
          name?: string;
        } = { type: 'extensions/install', source: command.source };
        if (command.name) payload.name = command.name;
        return hostClient.request(payload);
      }
      return hostClient.request({
        type: 'extensions/set_enabled',
        extensionId: command.extensionId ?? '',
        enabled: command.enabled === true,
      });
    },
    [hostClient],
  );

  const requestPrompts = useCallback(
    async (command: {
      type: 'prompts/list' | 'prompts/set_enabled';
      projectPath?: string;
      promptId?: string;
      enabled?: boolean;
    }): Promise<HostResponse> => {
      if (command.type === 'prompts/list') {
        const payload: { type: 'prompts/list'; projectPath?: string } = { type: 'prompts/list' };
        if (command.projectPath) payload.projectPath = command.projectPath;
        return hostClient.request(payload);
      }
      return hostClient.request({
        type: 'prompts/set_enabled',
        promptId: command.promptId ?? '',
        enabled: command.enabled === true,
      });
    },
    [hostClient],
  );

  const requestMcp = useCallback(
    async (command: {
      type:
        | 'mcp/get'
        | 'mcp/validate'
        | 'mcp/save'
        | 'mcp/list_tools'
        | 'mcp/status'
        | 'mcp/start'
        | 'mcp/stop';
      document?: unknown;
      serverId?: string;
    }): Promise<HostResponse> => {
      if (command.type === 'mcp/get') {
        return hostClient.request({ type: 'mcp/get' });
      }
      if (command.type === 'mcp/validate') {
        return hostClient.request({ type: 'mcp/validate', document: command.document });
      }
      if (command.type === 'mcp/save') {
        return hostClient.request({ type: 'mcp/save', document: command.document });
      }
      if (command.type === 'mcp/status') {
        return hostClient.request({ type: 'mcp/status' });
      }
      if (command.type === 'mcp/start') {
        return hostClient.request({ type: 'mcp/start', serverId: command.serverId ?? '' });
      }
      if (command.type === 'mcp/stop') {
        return hostClient.request({ type: 'mcp/stop', serverId: command.serverId ?? '' });
      }
      return hostClient.request({
        type: 'mcp/list_tools',
        serverId: command.serverId ?? '',
      });
    },
    [hostClient],
  );

  const requestGit = useCallback(async (command: Parameters<typeof hostClient.request>[0]): Promise<HostResponse> => {
    return hostClient.request(command);
  }, [hostClient]);

  const requestTheme = useCallback(
    async (command: {
      type: 'theme/list' | 'theme/get-active' | 'theme/set-active' | 'theme/install-local';
      themeId?: string;
      sourcePath?: string;
    }): Promise<HostResponse> => {
      if (command.type === 'theme/list') {
        return hostClient.request({ type: 'theme/list' });
      }
      if (command.type === 'theme/get-active') {
        return hostClient.request({ type: 'theme/get-active' });
      }
      if (command.type === 'theme/set-active') {
        return hostClient.request({ type: 'theme/set-active', themeId: command.themeId ?? '' });
      }
      return hostClient.request({
        type: 'theme/install-local',
        sourcePath: command.sourcePath ?? '',
      });
    },
    [hostClient],
  );

  const requestPet = useCallback(
    async (command: {
      type: 'pet/list' | 'pet/get-active' | 'pet/set-active' | 'pet/install-local' | 'pet/import-codex';
      petId?: string;
      sourcePath?: string;
    }): Promise<HostResponse> => {
      if (command.type === 'pet/list') {
        return hostClient.request({ type: 'pet/list' });
      }
      if (command.type === 'pet/get-active') {
        return hostClient.request({ type: 'pet/get-active' });
      }
      if (command.type === 'pet/set-active') {
        return hostClient.request({ type: 'pet/set-active', petId: command.petId ?? '' });
      }
      if (command.type === 'pet/import-codex') {
        return hostClient.request({ type: 'pet/import-codex' });
      }
      return hostClient.request({
        type: 'pet/install-local',
        sourcePath: command.sourcePath ?? '',
      });
    },
    [hostClient],
  );

  const requestMemory = useCallback(
    async (command: {
      type:
        | 'memory/list'
        | 'memory/search'
        | 'memory/delete'
        | 'memory/accept'
        | 'memory/quota'
        | 'config/get'
        | 'config/set';
      filter?: { scope?: 'global' | 'project'; projectKey?: string; limit?: number };
      query?: { query: string; scope?: 'global' | 'project'; projectKey?: string; limit?: number };
      memoryId?: string;
      scope?: 'global' | 'project';
      projectKey?: string;
      config?: PiwinConfig;
    }): Promise<HostResponse> => {
      if (command.type === 'config/get') {
        return hostClient.request({ type: 'config/get' });
      }
      if (command.type === 'config/set') {
        return hostClient.request({ type: 'config/set', config: command.config! });
      }
      if (command.type === 'memory/list') {
        return hostClient.request({
          type: 'memory/list',
          ...(command.filter ? { filter: command.filter } : {}),
        } as never);
      }
      if (command.type === 'memory/search') {
        return hostClient.request({
          type: 'memory/search',
          query: command.query!,
        } as never);
      }
      if (command.type === 'memory/delete') {
        return hostClient.request({ type: 'memory/delete', memoryId: command.memoryId! } as never);
      }
      if (command.type === 'memory/accept') {
        return hostClient.request({ type: 'memory/accept', memoryId: command.memoryId! } as never);
      }
      return hostClient.request({
        type: 'memory/quota',
        ...(command.scope ? { scope: command.scope } : {}),
        ...(command.projectKey ? { projectKey: command.projectKey } : {}),
      } as never);
    },
    [hostClient],
  );


  useEffect(() => {
    const unsubscribe = hostClient.subscribe((message: HostServerMessage) => {
      if (message.type === 'host/status') {
        dispatch({ type: 'host/status', ready: message.ready, mock: message.mock });
        return;
      }
      if (message.type === 'event') {
        dispatch({ type: 'event', event: message.event });
        if (
          message.event.type === 'process/started' ||
          message.event.type === 'process/updated' ||
          message.event.type === 'process/exited'
        ) {
          void refreshManagedProcesses();
        }
        if (message.event.type === 'process/log') {
          const chunk = message.event.chunk;
          setProcessLogsById((current) => ({
            ...current,
            [chunk.processId]: `${current[chunk.processId] ?? ''}${chunk.text}`,
          }));
        }
        return;
      }
      if (message.type === 'permission/request') {
        dispatch({
          type: 'permission/show',
          prompt: {
            requestId: message.requestId,
            sessionId: message.sessionId,
            action: message.action,
            detail: message.detail,
            defaultDecision: message.defaultDecision,
          },
        });
        return;
      }
      if (message.type === 'extension/ui_request') {
        setExtensionUiRequest({
          sessionId: message.sessionId,
          requestId: message.requestId,
          kind: message.kind,
          title: message.title,
          ...(message.message !== undefined ? { message: message.message } : {}),
          ...(message.options !== undefined ? { options: message.options } : {}),
          ...(message.placeholder !== undefined
            ? { placeholder: message.placeholder }
            : {}),
        });
        setExtensionUiInput('');
        return;
      }
      if (message.type === 'plan/updated') {
        setSessionPlan(message.plan);
        return;
      }
      if (message.type === 'host/log') {
        setHostLogEntries((current) =>
          appendHostLogEntry(current, {
            level: message.level,
            message: message.message,
            at: new Date().toISOString(),
          }),
        );
        // Auto-open on errors so MCP/permission failures are visible without DevTools.
        if (message.level === 'error') {
          setTerminalDockOpen(true);
        }
        return;
      }
      if (message.type === 'response' && !message.success) {
        dispatch({ type: 'error', message: message.error });
      }
    });

    void (async () => {
      await hostClient.connect();
      const configResponse = await hostClient.request({ type: 'config/get' });
      if (configResponse.success) {
        const data = configResponse.data as { config: PiwinConfig };
        setConfig(data.config);
        if (data.config.defaultProviderId && data.config.defaultModelId) {
          setSelectedModelKey(
            `${data.config.defaultProviderId}::${data.config.defaultModelId}`,
          );
        }
      }
      const themeResponse = await hostClient.request({ type: 'theme/get-active' });
      if (themeResponse.success) {
        const themeData = themeResponse.data as { theme: ThemeManifest };
        const resolved = resolveBuiltinAppearance(themeData.theme.id);
        const next: ThemeManifest = {
          ...resolved,
          ...themeData.theme,
          tokens: { ...resolved.tokens, ...themeData.theme.tokens },
          artifact: { ...resolved.artifact, ...themeData.theme.artifact },
          mode: themeData.theme.mode ?? resolved.mode,
        };
        setActiveTheme(next);
        applyThemeToDocument(next);
      } else {
        setActiveTheme(PIWIN_APPEARANCE_DARK);
        applyThemeToDocument(PIWIN_APPEARANCE_DARK);
      }
      const petResponse = await hostClient.request({ type: 'pet/get-active' });
      if (petResponse.success) {
        const petData = petResponse.data as { pet: PetRuntimeSnapshot };
        setActivePet(petData.pet);
      }
    })();

    return () => {
      unsubscribe();
      void hostClient.dispose();
    };
  }, [hostClient]);

  function selectedModelRef(): ModelRef | undefined {
    if (!selectedModelKey) {
      return undefined;
    }
    const option = modelOptions.find(
      (item) => `${item.providerId}::${item.modelId}` === selectedModelKey,
    );
    if (!option) {
      return undefined;
    }
    return {
      protocol: option.protocol,
      providerId: option.providerId,
      modelId: option.modelId,
    };
  }

  async function hydrateSessions(projectPath: string): Promise<void> {
    const listed = await hostClient.request({
      type: 'session/list',
      projectPath,
    });
    if (!listed.success) {
      return;
    }
    const data = listed.data as { sessions?: SessionSummary[] } | undefined;
    const sessions = (data?.sessions ?? []).map((session) => ({
      id: session.id,
      name: session.name ?? `session-${session.id.slice(0, 8)}`,
      ...(session.lastPreview ? { lastPreview: session.lastPreview } : {}),
      messageCount: session.messageCount,
      updatedAt: session.updatedAt,
      ...(session.isPinned === true ? { isPinned: true } : {}),
      ...(session.pinnedAt ? { pinnedAt: session.pinnedAt } : {}),
    }));
    dispatch({ type: 'session/hydrate', sessions });
    if (sessions[0]) {
      dispatch({ type: 'session/set', sessionId: sessions[0].id });
    }
  }

  async function handleBrowseProject(): Promise<void> {
    try {
      // Tauri v2 dialog plugin (optional). Falls back to prompt in browser.
      const dialog = await import('@tauri-apps/plugin-dialog').catch(() => null);
      if (dialog && typeof dialog.open === 'function') {
        const selected = await dialog.open({
          directory: true,
          multiple: false,
          title: 'Open project folder',
        });
        if (typeof selected === 'string' && selected.trim()) {
          setProjectInput(selected);
        }
        return;
      }
    } catch {
      // fall through
    }
    const fallback = window.prompt('Project path', projectInput);
    if (fallback && fallback.trim()) {
      setProjectInput(fallback.trim());
    }
  }

  async function handleOpenProject(): Promise<void> {
    const path = projectInput.trim();
    if (!path) {
      return;
    }
    const response = await hostClient.request({ type: 'project/open', path });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
      return;
    }
    const payload = response.data as {
      path?: string;
      trusted?: boolean;
      trust?: string;
    };
    const trusted = payload.trusted === true || payload.trust === 'trusted';
    const openedPath = payload.path ?? path;
    dispatch({ type: 'project/set', path: openedPath, trusted });
    setProjectPickerOpen(false);
    await hydrateSessions(openedPath);
    // Trusted reopen with no history → start a chat so the input is ready.
    if (trusted) {
      const listed = await hostClient.request({
        type: 'session/list',
        projectPath: openedPath,
      });
      const sessions =
        listed.success && listed.data
          ? ((listed.data as { sessions?: SessionSummary[] }).sessions ?? [])
          : [];
      if (sessions.length === 0) {
        await ensureSession({ projectPath: openedPath, alreadyTrusted: true });
      }
    }
  }

  /**
   * Create a chat session. Pass projectPath when calling immediately after trust
   * (React state has not re-rendered yet, so state.projectTrusted may still be false).
   */
  async function ensureSession(options?: {
    projectPath?: string;
    alreadyTrusted?: boolean;
  }): Promise<string | null> {
    const projectPath = options?.projectPath ?? state.projectPath;
    if (!projectPath) {
      dispatch({ type: 'error', message: 'Open a project first' });
      return null;
    }
    const trusted = options?.alreadyTrusted === true || state.projectTrusted;
    if (!trusted) {
      dispatch({ type: 'project/trust-dialog', open: true });
      return null;
    }
    const model = selectedModelRef();
    const input: {
      projectPath: string;
      model?: ModelRef;
      executionMode?: ExecutionMode;
    } = { projectPath, executionMode };
    if (model) {
      input.model = model;
    }
    const created = await hostClient.request({
      type: 'session/create',
      input,
    });
    if (!created.success) {
      dispatch({ type: 'error', message: created.error });
      return null;
    }
    const sessionId = (created.data as { sessionId: string }).sessionId;
    dispatch({
      type: 'session/add',
      sessionId,
      name: `session-${sessionId.slice(0, 8)}`,
    });
    return sessionId;
  }

  async function handleTrustProject(trust: boolean): Promise<void> {
    if (!state.projectPath) {
      return;
    }
    if (!trust) {
      dispatch({ type: 'project/trust-dialog', open: false });
      dispatch({
        type: 'error',
        message: 'Project left untrusted; create session / tools blocked until trusted.',
      });
      return;
    }
    const projectPath = state.projectPath;
    const response = await hostClient.request({
      type: 'project/trust',
      path: projectPath,
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
      return;
    }
    dispatch({ type: 'project/trusted' });
    // Auto-start a chat so the composer is usable without an extra "New chat" click.
    await ensureSession({ projectPath, alreadyTrusted: true });
  }

  async function handleNewSession(): Promise<void> {
    await ensureSession();
  }

  async function handleResumeSession(sessionId: string): Promise<void> {
    dispatch({ type: 'session/set', sessionId });
    const resumed = await hostClient.request({
      type: 'session/resume',
      sessionId,
    });
    if (!resumed.success) {
      dispatch({
        type: 'error',
        message: `${resumed.error} — start a New session to continue in this process.`,
      });
      return;
    }
    const data = resumed.data as {
      sessionId: string;
      live: boolean;
      messages?: import('@piwin/contracts').SessionTranscriptMessage[];
    };
    const messages = data.messages ?? [];
    if (messages.length === 0) {
      // Fallback: explicit messages fetch
      const listed = await hostClient.request({
        type: 'session/messages',
        sessionId,
      });
      if (listed.success) {
        const listedData = listed.data as {
          messages: import('@piwin/contracts').SessionTranscriptMessage[];
        };
        dispatch({
          type: 'session/load-messages',
          sessionId,
          messages: listedData.messages,
        });
        return;
      }
    }
    dispatch({
      type: 'session/load-messages',
      sessionId,
      messages,
    });
    if (!data.live) {
      dispatch({
        type: 'error',
        message: 'Session history restored (read-only shell). Sending will re-open a live agent.',
      });
    }
  }

  function revokePending(localId: string): void {
    setPendingAttachments((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.localId !== localId);
    });
  }

  function clearPendingAttachments(): void {
    setPendingAttachments((current) => {
      for (const item of current) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
  }

  async function saveImageFile(
    file: File,
    source: 'paste' | 'drop' | 'file-picker',
  ): Promise<void> {
    if (!state.activeSessionId) {
      dispatch({ type: 'error', message: 'Create a session before attaching images' });
      return;
    }
    if (!isAllowedImageFile(file)) {
      dispatch({ type: 'error', message: `Unsupported image type: ${file.type || file.name}` });
      return;
    }
    try {
      const base64Data = await fileToBase64(file);
      const response = await hostClient.request({
        type: 'media/save',
        input: {
          sessionId: state.activeSessionId,
          mimeType: file.type || 'image/png',
          source,
          base64Data,
        },
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      const asset = (response.data as MediaSaveData).asset;
      const attachment = toMediaAttachmentRef(asset, source);
      const previewUrl = URL.createObjectURL(file);
      setPendingAttachments((current) => [
        ...current,
        { localId: crypto.randomUUID(), attachment, previewUrl },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: 'error', message });
    }
  }

  async function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    for (const file of imageFiles) {
      await saveImageFile(file, 'paste');
    }
  }

  async function handleComposerDrop(event: DragEvent<HTMLTextAreaElement>): Promise<void> {
    event.preventDefault();
    setDropActive(false);
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) =>
      file.type.startsWith('image/'),
    );
    for (const file of files) {
      await saveImageFile(file, 'drop');
    }
  }

    async function handleSend(): Promise<void> {
    const text = composer.trim();
    const attachments = pendingAttachments.map((item) => item.attachment);
    if ((!text && attachments.length === 0) || !state.activeSessionId || state.streaming) {
      return;
    }
    if (!state.projectTrusted) {
      dispatch({ type: 'project/trust-dialog', open: true });
      return;
    }
    const promptText = applyAgentModeToPrompt(agentMode, text);
    dispatch({ type: 'user/send', text, attachments });
    setComposer('');
    clearPendingAttachments();
    const input: { text: string; attachments?: MediaAttachmentRef[] } = {
      text: promptText,
    };
    if (attachments.length > 0) {
      input.attachments = attachments;
    }
    const response = await hostClient.request({
      type: 'session/prompt',
      sessionId: state.activeSessionId,
      input,
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }


  async function handleTogglePin(sessionId: string, currentlyPinned: boolean): Promise<void> {
    const response = await hostClient.request({
      type: currentlyPinned ? 'session/unpin' : 'session/pin',
      sessionId,
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
      return;
    }
    const data = response.data as {
      session?: SessionSummary;
      isPinned?: boolean;
      pinnedAt?: string;
    };
    const session = data.session;
    const existing = state.sessions.find((item) => item.id === sessionId);
    const nextSession: import('./chat-reducer').SessionListItemUi = {
      id: sessionId,
      name: session?.name ?? existing?.name ?? sessionId.slice(0, 8),
    };
    if (session?.lastPreview) {
      nextSession.lastPreview = session.lastPreview;
    } else if (existing?.lastPreview) {
      nextSession.lastPreview = existing.lastPreview;
    }
    if (typeof session?.messageCount === 'number') {
      nextSession.messageCount = session.messageCount;
    } else if (typeof existing?.messageCount === 'number') {
      nextSession.messageCount = existing.messageCount;
    }
    if (session?.updatedAt) {
      nextSession.updatedAt = session.updatedAt;
    } else if (existing?.updatedAt) {
      nextSession.updatedAt = existing.updatedAt;
    }
    if (data.isPinned === true || session?.isPinned === true) {
      nextSession.isPinned = true;
      const pinnedAt = session?.pinnedAt ?? data.pinnedAt;
      if (pinnedAt) {
        nextSession.pinnedAt = pinnedAt;
      }
    } else {
      nextSession.isPinned = false;
    }
    dispatch({
      type: 'session/update',
      session: nextSession,
    });
  }

  async function handleEditAndResend(messageId: string, nextText: string): Promise<void> {
    if (!state.activeSessionId || state.streaming) {
      return;
    }
    const text = nextText.trim();
    if (!text) {
      return;
    }
    if (!state.projectTrusted) {
      dispatch({ type: 'project/trust-dialog', open: true });
      return;
    }
    const truncate = await hostClient.request({
      type: 'session/truncate-from',
      sessionId: state.activeSessionId,
      messageId,
    });
    if (!truncate.success) {
      dispatch({ type: 'error', message: truncate.error });
      return;
    }
    const truncData = truncate.data as { messages?: SessionTranscriptMessage[] };
    dispatch({
      type: 'session/truncate',
      sessionId: state.activeSessionId,
      messages: truncData.messages ?? [],
    });
    setEditingMessageId(null);
    const promptText = applyAgentModeToPrompt(agentMode, text);
    dispatch({ type: 'user/send', text });
    const response = await hostClient.request({
      type: 'session/prompt',
      sessionId: state.activeSessionId,
      input: { text: promptText },
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }

  async function handleRetryFromMessage(messageId: string): Promise<void> {
    const message = state.messages.find((item) => item.id === messageId);
    if (!message || message.role !== 'user' || !state.activeSessionId || state.streaming) {
      return;
    }
    const text = message.text.trim();
    if (!text && message.attachments.length === 0) {
      return;
    }
    if (!state.projectTrusted) {
      dispatch({ type: 'project/trust-dialog', open: true });
      return;
    }
    const truncate = await hostClient.request({
      type: 'session/truncate-from',
      sessionId: state.activeSessionId,
      messageId,
    });
    if (!truncate.success) {
      dispatch({ type: 'error', message: truncate.error });
      return;
    }
    const truncData = truncate.data as { messages?: SessionTranscriptMessage[] };
    dispatch({
      type: 'session/truncate',
      sessionId: state.activeSessionId,
      messages: truncData.messages ?? [],
    });
    const promptText = applyAgentModeToPrompt(agentMode, text);
    dispatch({
      type: 'user/send',
      text,
      attachments: message.attachments,
    });
    const input: { text: string; attachments?: MediaAttachmentRef[] } = {
      text: promptText,
    };
    if (message.attachments.length > 0) {
      input.attachments = message.attachments;
    }
    const response = await hostClient.request({
      type: 'session/prompt',
      sessionId: state.activeSessionId,
      input,
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }

  async function handleAbort(): Promise<void> {
    if (!state.activeSessionId) {
      return;
    }
    const response = await hostClient.request({
      type: 'session/abort',
      sessionId: state.activeSessionId,
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }

  async function handleCompact(): Promise<void> {
    if (!state.activeSessionId || state.compacting || state.streaming) {
      return;
    }
    const response = await hostClient.request({
      type: 'session/compact',
      sessionId: state.activeSessionId,
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }

  async function handleCompactAbort(): Promise<void> {
    if (!state.activeSessionId) {
      return;
    }
    const response = await hostClient.request({
      type: 'session/compact-abort',
      sessionId: state.activeSessionId,
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }

  async function handleExtensionUiResolve(payload: {
    confirmed?: boolean;
    value?: string;
    cancelled?: boolean;
  }): Promise<void> {
    const active = extensionUiRequest;
    if (!active) {
      return;
    }
    const response = await hostClient.request({
      type: 'extension/ui_resolve',
      requestId: active.requestId,
      ...(payload.confirmed !== undefined ? { confirmed: payload.confirmed } : {}),
      ...(payload.value !== undefined ? { value: payload.value } : {}),
      ...(payload.cancelled !== undefined ? { cancelled: payload.cancelled } : {}),
    });
    setExtensionUiRequest(null);
    setExtensionUiInput('');
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }

  async function handlePermission(
    decision: PermissionDecision,
    rememberScope: 'once' | 'project' = 'once',
  ): Promise<void> {
    const prompt = state.permissionPrompt;
    if (!prompt) {
      return;
    }
    const payload: {
      type: 'permission/resolve';
      requestId: string;
      decision: PermissionDecision;
      rememberScope?: 'once' | 'project';
    } = {
      type: 'permission/resolve',
      requestId: prompt.requestId,
      decision,
    };
    if (decision === 'allow') {
      payload.rememberScope = rememberScope;
    }
    const response = await hostClient.request(payload);
    dispatch({ type: 'permission/clear' });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }

  async function handlePickImageFiles(): Promise<void> {
    if (!state.activeSessionId) {
      dispatch({ type: 'error', message: 'Create a session before attaching images' });
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg,image/webp,image/gif';
    input.multiple = true;
    input.onchange = () => {
      void (async () => {
        const files = [...(input.files ?? [])];
        for (const file of files) {
          await saveImageFile(file, 'file-picker');
        }
      })();
    };
    input.click();
  }


  async function handleToggleAppearance(): Promise<void> {
    const nextId = activeTheme?.mode === 'light' ? 'piwin-dark' : 'piwin-light';
    const response = await hostClient.request({ type: 'theme/set-active', themeId: nextId });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
      return;
    }
    const theme = (response.data as { theme: import('@piwin/contracts').ThemeManifest }).theme;
    const resolved = resolveBuiltinAppearance(theme.id);
    // Prefer host payload; fill gaps from built-in so light/dark always complete.
    const next = {
      ...resolved,
      ...theme,
      tokens: { ...resolved.tokens, ...theme.tokens },
      artifact: { ...resolved.artifact, ...theme.artifact },
      mode: theme.mode ?? resolved.mode,
    };
    setActiveTheme(next);
    applyThemeToDocument(next);
    setArtifactThemeKey((previous) => previous + 1);
  }

  async function refreshComposerMenus(): Promise<void> {
    const skillsResponse = await hostClient.request({
      type: 'skills/list',
      ...(state.projectPath ? { projectPath: state.projectPath } : {}),
    } as never);
    if (skillsResponse.success && skillsResponse.data) {
      const data = skillsResponse.data as {
        skills?: Array<{ id: string; name?: string; enabled?: boolean }>;
      };
      setMenuSkills(
        (data.skills ?? []).map((skill) => ({
          id: skill.id,
          name: skill.name ?? skill.id,
          enabled: skill.enabled !== false,
        })),
      );
    }
    const mcpResponse = await hostClient.request({ type: 'mcp/get' } as never);
    if (mcpResponse.success && mcpResponse.data) {
      const data = mcpResponse.data as {
        document?: { servers?: Array<{ id: string; name?: string }> };
      };
      const servers = data.document?.servers ?? [];
      setMenuMcp(
        servers.map((server) => ({
          id: server.id,
          name: server.name ?? server.id,
          running: false,
        })),
      );
    }
  }

  function openRightTab(tab: RightPanelTab): void {
    setRightPanelTab(tab);
    setRightPanelOpen(true);
    setMoreMenuOpen(false);
  }

  const refreshManagedProcesses = useCallback(async (): Promise<void> => {
    const response = await hostClient.request({ type: 'process/list' });
    if (!response.success) {
      return;
    }
    const processes =
      (response.data as { processes?: ManagedProcessRecord[] } | undefined)?.processes ?? [];
    setManagedProcesses(processes);
  }, [hostClient]);

  const loadProcessLogs = useCallback(
    async (processId: string): Promise<void> => {
      const response = await hostClient.request({
        type: 'process/logs',
        query: { processId },
      });
      if (!response.success) {
        return;
      }
      const chunks =
        (response.data as { chunks?: Array<{ text: string }> } | undefined)?.chunks ?? [];
      const text = chunks.map((chunk) => chunk.text).join('');
      setProcessLogsById((current) => ({ ...current, [processId]: text }));
    },
    [hostClient],
  );

  const stopManagedProcess = useCallback(
    async (processId: string): Promise<void> => {
      const response = await hostClient.request({ type: 'process/stop', processId });
      if (response.success) {
        await refreshManagedProcesses();
        await loadProcessLogs(processId);
      }
    },
    [hostClient, refreshManagedProcesses, loadProcessLogs],
  );

  useEffect(() => {
    if (rightPanelOpen && rightPanelTab === 'execution') {
      void refreshManagedProcesses();
    }
  }, [rightPanelOpen, rightPanelTab, refreshManagedProcesses]);

  function openRailPanel(
    nav:
      | 'skills'
      | 'mcp'
      | 'extensions'
      | 'prompts'
      | 'settings'
      | 'theme'
      | 'git'
      | 'pet'
      | 'workspace'
      | 'chats',
  ): void {
    setRailNav(nav);
    const settingsSections = {
      skills: 'skills',
      mcp: 'tools',
      extensions: 'extensions',
      prompts: 'prompts',
      settings: 'general',
      theme: 'appearance',
      pet: 'appearance',
    } as const;
    if (nav in settingsSections) {
      setSettingsSection(settingsSections[nav as keyof typeof settingsSections]);
      setSettingsOpen(true);
    }
    if (nav === 'git') {
      openRightTab('git');
    }
    if (nav === 'workspace') {
      document.getElementById('workspace-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }


  useEffect(() => {
    const query = sessionSearch.trim();
    if (!query || !state.projectPath) {
      setRemoteSearchHits(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const searchQuery: import('@piwin/contracts').SessionSearchQuery = {
          query,
          limit: 30,
        };
        if (state.projectPath) {
          searchQuery.projectPath = state.projectPath;
        }
        const response = await hostClient.request({
          type: 'session/search',
          query: searchQuery,
        });
        if (cancelled) return;
        if (!response.success) {
          setRemoteSearchHits([]);
          return;
        }
        const data = response.data as { hits?: SessionSearchHit[] } | undefined;
        setRemoteSearchHits(data?.hits ?? []);
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sessionSearch, state.projectPath, hostClient]);

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) {
      return state.sessions;
    }
    if (remoteSearchHits) {
      const byId = new Map(state.sessions.map((session) => [session.id, session]));
      const fromHits = remoteSearchHits
        .map((hit) => {
          const existing = byId.get(hit.sessionId);
          if (existing) {
            return {
              ...existing,
              ...(hit.snippet ? { lastPreview: hit.snippet } : {}),
              ...(hit.isPinned === true ? { isPinned: true } : {}),
            };
          }
          return {
            id: hit.sessionId,
            name: hit.name ?? `session-${hit.sessionId.slice(0, 8)}`,
            ...(hit.snippet ? { lastPreview: hit.snippet } : {}),
            ...(hit.updatedAt ? { updatedAt: hit.updatedAt } : {}),
            ...(hit.isPinned === true ? { isPinned: true } : {}),
          };
        });
      return fromHits;
    }
    return state.sessions.filter((session) => {
      const haystack = `${session.name} ${session.lastPreview ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [sessionSearch, state.sessions, remoteSearchHits]);

  const sessionGroups = useMemo(
    () => groupSessionsByRecency(filteredSessions),
    [filteredSessions],
  );

  // Cursor-style: inspector stays closed until tools actually run.
  const sessionTools = useMemo(
    () => collectSessionTools(state.messages),
    [state.messages],
  );
  useEffect(() => {
    if (sessionTools.some((tool) => tool.status === 'running')) {
      setRightPanelTab('execution');
      setRightPanelOpen(true);
    }
  }, [sessionTools]);

  const lastUserMessageId = useMemo(() => {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message?.role === 'user') {
        return message.id;
      }
    }
    return null;
  }, [state.messages]);

  const petAnimationState = petStateFromChatFlags({
    streaming: state.streaming,
    toolRunning: state.messages.some((message) =>
      message.tools.some((tool) => tool.status === 'running'),
    ),
    hasError: Boolean(state.error),
    waitingPermission: Boolean(state.permissionPrompt),
  });

  const activeSessionName =
    state.sessions.find((item) => item.id === state.activeSessionId)?.name ?? 'New chat';

  return (
    <div className={`app-shell${rightPanelOpen ? ' has-right-panel' : ''}`} data-testid="app-shell" data-theme={activeTheme?.mode ?? 'dark'}>
      <nav className="rail" aria-label="Global navigation">
        <div className="brand-mark" aria-hidden>
          π
        </div>
        <button
          type="button"
          className={railNav === 'chats' ? 'rail-btn active' : 'rail-btn'}
          title="Chats"
          aria-label="Chats"
          onClick={() => setRailNav('chats')}
        >
          <IconChat />
        </button>
        <button
          type="button"
          className={railNav === 'skills' ? 'rail-btn active' : 'rail-btn'}
          title="Skills"
          aria-label="Skills"
          onClick={() => openRailPanel('skills')}
        >
          <IconSpark />
        </button>
        <button
          type="button"
          className={railNav === 'mcp' ? 'rail-btn active' : 'rail-btn'}
          title="MCP"
          aria-label="MCP"
          onClick={() => openRailPanel('mcp')}
        >
          <IconPlug />
        </button>
        <button
          type="button"
          className={railNav === 'extensions' ? 'rail-btn active' : 'rail-btn'}
          title="Extensions"
          aria-label="Extensions"
          data-testid="extensions-open-btn"
          onClick={() => openRailPanel('extensions')}
        >
          <IconExtension />
        </button>
        <div className="rail-spacer" />
        <button
          type="button"
          className="rail-btn"
          title={activeTheme?.mode === 'light' ? 'Switch to dark' : 'Switch to light'}
          aria-label="Toggle appearance"
          onClick={() => void handleToggleAppearance()}
        >
          {activeTheme?.mode === 'light' ? <IconMoon /> : <IconSun />}
        </button>
      </nav>

      <aside className="sidebar" aria-label="Project conversations">
        <button
          type="button"
          className="workspace-switcher"
          onClick={() => setProjectPickerOpen((open) => !open)}
          title="Project"
          aria-expanded={projectPickerOpen || !state.projectPath}
          aria-controls="workspace-card"
        >
          <div className="workspace-mark" aria-hidden>
            <IconFolder />
          </div>
          <div className="workspace-copy">
            <span className="workspace-name">
              {state.projectPath ? projectDisplayName(state.projectPath) : 'Open project'}
            </span>
            <span className="workspace-tag muted">
              {state.projectPath
                ? state.projectTrusted
                  ? 'Trusted'
                  : 'Untrusted'
                : 'No folder'}
            </span>
          </div>
          <IconChevronDown className={projectPickerOpen ? 'chevron open' : 'chevron'} />
        </button>

        {projectPickerOpen || !state.projectPath ? (
          <div className="project-card" id="workspace-card">
            <div className="project-card-meta muted" data-testid="project-trust-pill">
              {state.projectPath
                ? state.projectTrusted
                  ? 'Trusted workspace'
                  : 'Untrusted — tools blocked'
                : 'Choose a folder to start coding'}
            </div>
            <input
              className="text-input project-path-input"
              data-testid="project-path-input"
              value={projectInput}
              onChange={(event) => setProjectInput(event.target.value)}
              placeholder="/path/to/project"
              spellCheck={false}
            />
            <div className="project-card-actions">
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => void handleBrowseProject()}
              >
                Browse
              </button>
              <button
                type="button"
                className="btn primary btn-compact"
                data-testid="open-project-btn"
                onClick={() => void handleOpenProject()}
              >
                Open
              </button>
            </div>
          </div>
        ) : (
          <div className="sr-only" id="workspace-card">
            <span data-testid="project-trust-pill">
              {state.projectTrusted ? 'Trusted workspace' : 'Untrusted — tools blocked'}
            </span>
            <input
              data-testid="project-path-input"
              value={projectInput}
              onChange={(event) => setProjectInput(event.target.value)}
              readOnly
            />
            <button
              type="button"
              data-testid="open-project-btn"
              onClick={() => void handleOpenProject()}
            >
              Open
            </button>
          </div>
        )}

        <label className="search-field">
          <IconSearch />
          <input
            value={sessionSearch}
            onChange={(event) => setSessionSearch(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
        </label>

        <button
          type="button"
          className="sidebar-new-session"
          data-testid="new-session-btn"
          disabled={!state.projectPath}
          onClick={() => void handleNewSession()}
          title="Start a new conversation"
          aria-label="Start a new conversation"
        >
          <IconPlus />
          <span>New conversation</span>
        </button>

        <div className="sidebar-section sidebar-sessions">
          {filteredSessions.length === 0 ? (
            <div className="muted sessions-empty" data-testid="sessions-empty">
              {state.sessions.length === 0 ? 'No agents yet' : 'No matches'}
            </div>
          ) : (
            <div className="session-groups" data-testid="sessions-list">
              {sessionGroups.map((group) => (
                <div key={group.id} className="session-group" data-testid="session-group">
                  <div className="sidebar-section-label">{group.label}</div>
                  <ul className="session-list">
                    {group.sessions.map((session) => (
                      <li key={session.id} className="session-row">
                        <button
                          type="button"
                          data-testid="session-item"
                          data-session-id={session.id}
                          data-pinned={session.isPinned === true ? 'true' : 'false'}
                          className={
                            session.id === state.activeSessionId
                              ? 'session-item active'
                              : 'session-item'
                          }
                          onClick={() => void handleResumeSession(session.id)}
                        >
                          <IconChat className="session-item-icon" />
                          <span className="session-item-body">
                            <span className="session-item-name">
                              {session.isPinned === true ? (
                                <span className="session-pin-mark" aria-hidden>
                                  📌{' '}
                                </span>
                              ) : null}
                              {session.name}
                            </span>
                            {session.lastPreview ? (
                              <span className="session-item-preview muted">
                                {session.lastPreview}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={
                            session.isPinned === true
                              ? 'session-pin-btn active'
                              : 'session-pin-btn'
                          }
                          data-testid="session-pin-btn"
                          title={session.isPinned === true ? 'Unpin session' : 'Pin session'}
                          aria-label={session.isPinned === true ? 'Unpin session' : 'Pin session'}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleTogglePin(session.id, session.isPinned === true);
                          }}
                        >
                          {session.isPinned === true ? 'Unpin' : 'Pin'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-status-line" aria-label="Host status">
            <span className={state.hostReady ? 'sidebar-status-dot ok' : 'sidebar-status-dot'} />
            <span data-testid="host-status-pill">{state.hostReady ? 'Host ready' : 'Host offline'}</span>
            <span className="sidebar-status-detail" data-testid="transport-pill">
              {hostClient.getTransport()} · {state.hostMock ? 'mock' : 'live'}
            </span>
            <span className="sr-only" data-testid="agent-mode-pill">
              {state.hostMock ? 'mock' : 'live'}
            </span>
          </div>
          <div className="sidebar-footer-actions">
            <PetCompanion snapshot={activePet} state={petAnimationState} />
            <button
              type="button"
              className={settingsOpen ? 'sidebar-settings-button active' : 'sidebar-settings-button'}
              title="Settings"
              aria-label="Settings"
              aria-pressed={settingsOpen}
              data-testid="settings-open-btn"
              onClick={() => openRailPanel('settings')}
            >
              <IconSettings />
            </button>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="titlebar">
          <div className="titlebar-left">
            <div className="breadcrumb">
              <strong>{state.activeSessionId ? activeSessionName : 'Agent'}</strong>
            </div>
            {state.projectPath ? (
              <span className="titlebar-subtitle muted" title={state.projectPath}>
                {projectDisplayName(state.projectPath)}
                {sessionPlan ? ` · plan: ${sessionPlan.status}` : ''}
              </span>
            ) : null}
          </div>

          <div className="titlebar-actions" role="toolbar" aria-label="Tools">
            <span
              className="usage-chip"
              data-testid="usage-chip"
              title="Context / token usage"
            >
              {state.contextUsage
                ? formatUsageChip(state.contextUsage)
                : 'usage · unknown'}
            </span>
            <label className="model-picker execution-mode-picker">
              <span className="sr-only">Execution mode</span>
              <select
                className="model-select"
                data-testid="execution-mode-select"
                value={executionMode}
                onChange={(event) =>
                  setExecutionMode(event.target.value as ExecutionMode)
                }
                title="Execution mode for new sessions (chat strips tools)"
              >
                <option value="chat">Chat</option>
                <option value="agent">Agent</option>
                <option value="agent-debug">Agent Debug</option>
              </select>
            </label>
            <label className="model-picker">
              <span className="sr-only">Model</span>
              <span className="model-dot" aria-hidden />
              <select
                className="model-select"
                value={selectedModelKey}
                onChange={(event) => setSelectedModelKey(event.target.value)}
                title="Model for new sessions"
              >
                <option value="">Default model</option>
                {modelOptions.map((option) => (
                  <option
                    key={`${option.providerId}::${option.modelId}`}
                    value={`${option.providerId}::${option.modelId}`}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={
                rightPanelOpen && rightPanelTab === 'execution' ? 'icon-btn active' : 'icon-btn'
              }
              onClick={() => openRightTab('execution')}
              title="Execution"
              aria-label="Execution"
              data-testid="right-panel-tools-btn"
            >
              <IconSpark />
            </button>
            <button
              type="button"
              className={
                rightPanelOpen && rightPanelTab === 'agents' ? 'icon-btn active' : 'icon-btn'
              }
              onClick={() => openRightTab('agents')}
              title="Sub-agents"
              aria-label="Sub-agents"
              data-testid="right-panel-agents-btn"
            >
              <IconUsers />
            </button>
            <button
              type="button"
              className={terminalDockOpen ? 'icon-btn active' : 'icon-btn'}
              onClick={() => setTerminalDockOpen((open) => !open)}
              title="Activity output"
              aria-label="Toggle activity output"
              data-testid="terminal-dock-title-btn"
            >
              <IconTerminal />
            </button>
            <div className="more-menu-wrap">
              <button
                type="button"
                className={moreMenuOpen ? 'icon-btn active' : 'icon-btn'}
                onClick={() => setMoreMenuOpen((open) => !open)}
                title="More"
                aria-label="More tools"
                aria-expanded={moreMenuOpen}
              >
                <IconMore />
              </button>
              {moreMenuOpen ? (
                <div className="more-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      openRightTab('changes');
                    }}
                  >
                    <IconFolder /> Changes
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      openRightTab('git');
                    }}
                  >
                    <IconGit /> Git
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      openRailPanel('pet');
                    }}
                  >
                    <IconPet /> Pet
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      openRailPanel('theme');
                    }}
                  >
                    <IconSpark /> Themes
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setTerminalDockOpen(true);
                    }}
                  >
                    Activity output
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <section className="chat-column">
          <div className="chat-stream" data-testid="chat-stream">
            {state.messages.length === 0 ? (
              <div className="empty-state" data-testid="chat-empty-state">
                <h2 className="empty-state-title">
                  {state.projectPath ? 'What should we work on?' : 'Open a project to start'}
                </h2>
                <p className="empty-state-copy muted">
                  {state.projectPath
                    ? 'Plan, debug, or ship changes with the agent in this workspace.'
                    : 'Choose a folder, then describe a task. Modes live under + in the composer.'}
                </p>
                <div className="suggestion-list" aria-label="Suggested first tasks">
                  <button
                    type="button"
                    className="suggestion-card"
                    onClick={() => {
                      setAgentMode('agent');
                      setComposer('Review this project for risks and the next best step.');
                    }}
                  >
                    <strong>Review this project</strong>
                    <span className="muted">Risks, gaps, and a practical next step.</span>
                  </button>
                  <button
                    type="button"
                    className="suggestion-card"
                    onClick={() => {
                      setAgentMode('plan');
                      setComposer('Plan a feature end-to-end for this codebase.');
                    }}
                  >
                    <strong>Plan a feature</strong>
                    <span className="muted">Decision-complete implementation plan.</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="chat-thread">
                {state.messages.map((message, messageIndex) => (
                  <article
                    key={message.id}
                    id={`msg-${message.id}`}
                    className={`bubble role-${message.role}${message.status === 'streaming' ? ' is-streaming' : ''}`}
                    data-testid="message-bubble"
                    data-role={message.role}
                  >
                    {message.role === 'assistant' ? (
                      <header className="bubble-header">
                        <strong className="bubble-role">piwin</strong>
                        {message.status === 'streaming' ? (
                          <span className="stream-dot" aria-label="Streaming" />
                        ) : null}
                      </header>
                    ) : null}
                    {message.tools.map((tool) => (
                      <ToolCallCard
                        key={tool.toolCallId}
                        tool={tool}
                        density="compact"
                      />
                    ))}
                    {message.thinking ? (
                      <details className="thinking">
                        <summary>Thinking</summary>
                        <pre>{message.thinking}</pre>
                      </details>
                    ) : null}
                    {message.attachments.length > 0 ? (
                      <div className="message-attachments">
                        {message.attachments.map((attachment) => (
                          <MediaPreview key={attachment.id} attachment={attachment} />
                        ))}
                      </div>
                    ) : null}
                    {message.role === 'assistant' ? (
                      <MarkdownView
                        text={message.text}
                        streamComplete={message.status !== 'streaming'}
                        artifactTheme={mapThemeToArtifactVariables(activeTheme)}
                        initPriorityBase={messageIndex * 10}
                        artifactThemeKey={`${activeTheme?.id ?? 'none'}:${artifactThemeKey}`}
                      />
                    ) : editingMessageId === message.id ? (
                      <div className="message-edit-box" data-testid="message-edit-box">
                        <textarea
                          className="message-edit-input"
                          data-testid="message-edit-input"
                          defaultValue={message.text}
                          rows={3}
                          id={`edit-${message.id}`}
                        />
                        <div className="message-edit-actions">
                          <button
                            type="button"
                            className="btn btn-compact"
                            data-testid="message-edit-cancel"
                            onClick={() => setEditingMessageId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn primary btn-compact"
                            data-testid="message-edit-resend"
                            disabled={state.streaming}
                            onClick={() => {
                              const el = document.getElementById(
                                `edit-${message.id}`,
                              ) as HTMLTextAreaElement | null;
                              void handleEditAndResend(message.id, el?.value ?? message.text);
                            }}
                          >
                            Save & resend
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="message-text">{message.text}</div>
                    )}
                    {message.status !== 'streaming' && message.text.trim() && editingMessageId !== message.id ? (
                      <MessageActions
                        text={message.text}
                        showRetry={
                          message.role === 'user' && message.id === lastUserMessageId
                        }
                        showEdit={
                          message.role === 'user' && message.id === lastUserMessageId
                        }
                        disabled={state.streaming}
                        {...(message.role === 'user' && message.id === lastUserMessageId
                          ? {
                              onRetry: () => {
                                void handleRetryFromMessage(message.id);
                              },
                              onEdit: () => {
                                setEditingMessageId(message.id);
                              },
                            }
                          : {})}
                      />
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>

          {state.compacting ? (
            <div className="info-banner" role="status">
              Compacting context…
              <button
                type="button"
                className="btn btn-compact"
                onClick={() => void handleCompactAbort()}
              >
                Cancel
              </button>
            </div>
          ) : null}
          {!state.compacting && state.lastCompactionMessage ? (
            <div className="info-banner muted" role="status">
              <div>
                <strong>{state.lastCompactionMessage}</strong>
                {typeof state.lastCompactionDurationMs === 'number' ? (
                  <span className="muted"> · {state.lastCompactionDurationMs}ms</span>
                ) : null}
                {typeof state.lastCompactionTokensBefore === 'number' ||
                typeof state.lastCompactionTokensAfter === 'number' ? (
                  <div className="muted banner-meta">
                    Tokens
                    {typeof state.lastCompactionTokensBefore === 'number'
                      ? ` before: ${state.lastCompactionTokensBefore}`
                      : ''}
                    {typeof state.lastCompactionTokensAfter === 'number'
                      ? ` → after: ${state.lastCompactionTokensAfter}`
                      : ''}
                  </div>
                ) : null}
                {state.lastCompactionSummary ? (
                  <details className="banner-details">
                    <summary>Summary</summary>
                    <pre className="banner-summary-pre">
                      {state.lastCompactionSummary.slice(0, 500)}
                    </pre>
                  </details>
                ) : null}
              </div>
              <button
                type="button"
                className="btn btn-compact"
                onClick={() => dispatch({ type: 'compaction/dismiss' })}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {state.error ? <div className="error-banner">{state.error}</div> : null}

          <footer className="composer-dock">
            <div className={`composer-card cursor-composer${dropActive ? ' drop-active' : ''}`}>
              {agentMode !== 'agent' ? (
                <div className="mode-banner" data-testid="agent-mode-banner">
                  <strong>{getAgentMode(agentMode).title}</strong>
                  <span className="muted">{getAgentMode(agentMode).description}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={() => setAgentMode('agent')}
                  >
                    Exit
                  </button>
                </div>
              ) : null}
              {pendingAttachments.length > 0 ? (
                <div className="attachment-chip-row">
                  {pendingAttachments.map((item) => (
                    <div key={item.localId} className="attachment-chip">
                      <MediaPreview
                        attachment={item.attachment}
                        previewUrl={item.previewUrl}
                        compact
                      />
                      <button
                        type="button"
                        className="chip-remove"
                        onClick={() => revokePending(item.localId)}
                        aria-label="Remove attachment"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <textarea
                className={dropActive ? 'drop-active' : undefined}
                data-testid="composer-input"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onPaste={(event) => void handleComposerPaste(event)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropActive(true);
                }}
                onDragLeave={() => setDropActive(false)}
                onDrop={(event) => void handleComposerDrop(event)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={
                  !state.projectPath
                    ? 'Open a project to start…'
                    : !state.projectTrusted
                      ? 'Trust the project before chatting…'
                      : state.activeSessionId
                        ? getAgentMode(agentMode).placeholder
                        : 'Start a new chat first…'
                }
                rows={3}
                disabled={
                  !state.activeSessionId || state.streaming || !state.projectTrusted
                }
              />
              <div className="composer-toolbar cursor-composer-toolbar">
                <div className="composer-toolbar-left">
                  <div className="plus-anchor">
                    <button
                      type="button"
                      className={plusMenuOpen ? 'compose-icon-btn active' : 'compose-icon-btn'}
                      data-testid="composer-plus-btn"
                      onClick={() => {
                        setPlusMenuOpen((open) => {
                          const next = !open;
                          if (next) {
                            setPlusSubmenu('none');
                            void refreshComposerMenus();
                          }
                          return next;
                        });
                      }}
                      title="Add agents, context, tools"
                      aria-label="Add agents, context, tools"
                      aria-expanded={plusMenuOpen}
                    >
                      <IconPlus />
                    </button>
                    <ComposerPlusMenu
                      open={plusMenuOpen}
                      onClose={() => {
                        setPlusMenuOpen(false);
                        setPlusSubmenu('none');
                      }}
                      agentMode={agentMode}
                      onSelectMode={setAgentMode}
                      submenu={plusSubmenu}
                      onSubmenu={setPlusSubmenu}
                      models={modelOptions.map((option) => ({
                        key: `${option.providerId}::${option.modelId}`,
                        label: option.label,
                      }))}
                      selectedModelKey={selectedModelKey}
                      onSelectModel={setSelectedModelKey}
                      skills={menuSkills}
                      onOpenSkillsPanel={() => openRailPanel('skills')}
                      mcpServers={menuMcp}
                      onOpenMcpPanel={() => openRailPanel('mcp')}
                      onAttachImage={() => void handlePickImageFiles()}
                    />
                  </div>
                  <button
                    type="button"
                    className="mode-chip"
                    data-testid="agent-mode-chip"
                    onClick={() => {
                      setPlusMenuOpen(true);
                      setPlusSubmenu('none');
                      void refreshComposerMenus();
                    }}
                    title={getAgentMode(agentMode).description}
                  >
                    {getAgentMode(agentMode).label}
                  </button>
                  <span className="context-chip" title={state.projectPath ?? undefined}>
                    {state.projectPath ? projectDisplayName(state.projectPath) : 'No project'}
                  </span>
                  <button
                    type="button"
                    className="compose-icon-btn"
                    disabled={
                      !state.activeSessionId ||
                      state.streaming ||
                      state.compacting ||
                      !state.projectTrusted
                    }
                    onClick={() => void handleCompact()}
                    title={state.compacting ? 'Compacting…' : 'Compact context'}
                    aria-label="Compact context"
                  >
                    <IconCompress />
                  </button>
                </div>
                <div className="composer-toolbar-right">
                  <span className="composer-model-summary" title="Choose a model from the title bar">
                    {selectedModelKey ? 'Model selected' : 'Default model'}
                  </span>
                  {state.streaming ? (
                    <button
                      type="button"
                      className="stop-btn"
                      disabled={!state.activeSessionId}
                      onClick={() => void handleAbort()}
                      title="Stop"
                      aria-label="Stop"
                    >
                      <IconStop />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="send-btn"
                    data-testid="send-btn"
                    disabled={
                      !state.activeSessionId ||
                      state.streaming ||
                      (!composer.trim() && pendingAttachments.length === 0) ||
                      !state.projectTrusted
                    }
                    onClick={() => void handleSend()}
                    aria-label="Send"
                    style={state.streaming ? { display: 'none' } : undefined}
                  >
                    <IconSend />
                  </button>
                </div>
              </div>
            </div>
          </footer>

          <TerminalDock
            open={terminalDockOpen}
            onToggle={() => setTerminalDockOpen((previous) => !previous)}
            entries={hostLogEntries}
            onClearLogs={() => setHostLogEntries([])}
            projectPath={state.projectPath}
          />
        </section>
      </div>

      <RightPanel
        open={rightPanelOpen}
        activeTab={rightPanelTab}
        onTabChange={setRightPanelTab}
        onClose={() => setRightPanelOpen(false)}
        tools={sessionTools}
        plan={sessionPlan}
        toolCallDensity={toolCallDensity}
        processes={managedProcesses}
        processLogsById={processLogsById}
        onStopProcess={(processId) => {
          void stopManagedProcess(processId);
        }}
        onRefreshProcesses={() => {
          void refreshManagedProcesses();
        }}
        onLoadProcessLogs={(processId) => {
          void loadProcessLogs(processId);
        }}
        usageSnapshot={state.contextUsage}
        changesContent={
          <ChangesPanel projectPath={state.projectPath} request={requestGit as never} />
        }
        gitContent={
          <GitPanel
            projectPath={state.projectPath}
            request={requestGit as never}
            variant="embedded"
          />
        }
        agentsContent={
          <SubAgentPanel
            parentSessionId={state.activeSessionId}
            request={requestSubAgent}
            variant="embedded"
            onOpenSession={(sessionId) => {
              void (async () => {
                const response = await hostClient.request({
                  type: 'session/resume',
                  sessionId,
                });
                if (response.success) {
                  await handleResumeSession(sessionId);
                }
              })();
            }}
          />
        }
      />

      {state.trustDialogOpen ? (
        <Dialog
          label="Trust this project?"
          open
          testId="trust-dialog"
          onOpenChange={(open) => {
            if (!open) {
              void handleTrustProject(false);
            }
          }}
        >
          <h3>Trust this project?</h3>
          <p className="muted">
            Allow the agent to run tools in:
            <br />
            <code>{state.projectPath}</code>
          </p>
          <div className="modal-actions">
            <Button
              data-testid="trust-deny-btn"
              onClick={() => void handleTrustProject(false)}
            >
              Not now
            </Button>
            <Button
              variant="primary"
              data-testid="trust-confirm-btn"
              onClick={() => void handleTrustProject(true)}
            >
              Trust project
            </Button>
          </div>
        </Dialog>
      ) : null}

      {extensionUiRequest ? (
        <Dialog
          label={extensionUiRequest.title}
          open
          testId="extension-ui-dialog"
          onOpenChange={(open) => {
            if (!open) {
              void handleExtensionUiResolve({ cancelled: true, confirmed: false });
            }
          }}
        >
          <h3>{extensionUiRequest.title}</h3>
          {extensionUiRequest.message ? (
            <pre className="permission-detail">{extensionUiRequest.message}</pre>
          ) : null}
          <p className="muted">Extension UI ({extensionUiRequest.kind})</p>
          {extensionUiRequest.kind === 'input' ? (
            <label className="field">
              Response
              <input
                data-testid="extension-ui-input"
                value={extensionUiInput}
                placeholder={extensionUiRequest.placeholder ?? ''}
                onChange={(event) => setExtensionUiInput(event.target.value)}
              />
            </label>
          ) : null}
          {extensionUiRequest.kind === 'select' ? (
            <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
              {(extensionUiRequest.options ?? []).map((option) => (
                <Button
                  key={option}
                  data-testid="extension-ui-option"
                  onClick={() => void handleExtensionUiResolve({ value: option })}
                >
                  {option}
                </Button>
              ))}
              <Button onClick={() => void handleExtensionUiResolve({ cancelled: true })}>
                Cancel
              </Button>
            </div>
          ) : null}
          {extensionUiRequest.kind === 'confirm' ? (
            <div className="modal-actions">
              <Button
                data-testid="extension-ui-deny"
                onClick={() => void handleExtensionUiResolve({ confirmed: false })}
              >
                Deny
              </Button>
              <Button
                variant="primary"
                data-testid="extension-ui-allow"
                onClick={() => void handleExtensionUiResolve({ confirmed: true })}
              >
                Allow
              </Button>
            </div>
          ) : null}
          {extensionUiRequest.kind === 'input' ? (
            <div className="modal-actions">
              <Button onClick={() => void handleExtensionUiResolve({ cancelled: true })}>
                Cancel
              </Button>
              <Button
                variant="primary"
                data-testid="extension-ui-submit"
                onClick={() =>
                  void handleExtensionUiResolve({ value: extensionUiInput })
                }
              >
                Submit
              </Button>
            </div>
          ) : null}
        </Dialog>
      ) : null}

      {state.permissionPrompt ? (
        <Dialog label="Permission required" open onOpenChange={() => undefined}>
          <h3>Permission required</h3>
          <p>
            <strong>{state.permissionPrompt.action}</strong>
          </p>
          <pre className="permission-detail">{state.permissionPrompt.detail}</pre>
          <p className="muted">Default: {state.permissionPrompt.defaultDecision}</p>
          <div className="modal-actions">
            <Button onClick={() => void handlePermission('deny')}>Deny</Button>
            <Button onClick={() => void handlePermission('allow', 'once')}>Allow once</Button>
            {state.permissionPrompt.action.startsWith('network:') ||
            state.permissionPrompt.action.startsWith('mcp:') ? (
              <Button
                variant="primary"
                onClick={() => void handlePermission('allow', 'project')}
                title="Remember this allow for the current project"
              >
                Allow for project
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void handlePermission('allow', 'once')}>
                Allow
              </Button>
            )}
          </div>
        </Dialog>
      ) : null}

      {settingsOpen ? (
        <SettingsPanel
          request={requestConfig}
          onClose={() => setSettingsOpen(false)}
          toolCallDensity={toolCallDensity}
          onToolCallDensityChange={(density) => {
            setToolCallDensity(density);
            saveToolCallDensity(density);
          }}
          initialSection={settingsSection}
          projectPath={state.projectPath}
          requestSkills={requestSkills}
          requestMcp={requestMcp}
          requestExtensions={requestExtensions}
          requestPrompts={requestPrompts}
          requestTheme={requestTheme}
          requestPet={requestPet}
          requestMemory={requestMemory}
          onThemeApplied={(theme) => {
            setActiveTheme(theme);
            applyThemeToDocument(theme);
            setArtifactThemeKey((previous) => previous + 1);
          }}
          onPetActiveChanged={setActivePet}
          onSaved={(next) => {
            setConfig(next);
            if (next.defaultProviderId && next.defaultModelId) {
              setSelectedModelKey(`${next.defaultProviderId}::${next.defaultModelId}`);
            }
          }}
        />
      ) : null}
    </div>
  );
}
