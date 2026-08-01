/**
 * Composer text, pending image attachments, paste/drop/file-picker, send prompt.
 */
import {
  useCallback,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
} from 'react';
import type { MediaSaveData, PromptAttachment, WebElementAttachmentRef, WebElementPickResult } from '@piwin/contracts';
import { toMediaAttachmentRef } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import {
  fileToBase64,
  isAllowedImageFile,
  type PendingComposerAttachment,
} from '../media-utils';
import { applyAgentModeToPrompt, type AgentModeId } from '../agent-mode';
import {
  applySkillToPrompt,
  normalizeCompactCustomInstructions,
  parseComposerSlashSubmit,
} from '../slash';
import { PIWIN_PATH_MIME } from '../file-tree-panel';

export type UseComposerMediaArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  agentMode: AgentModeId;
  onAgentModeChange?: (mode: AgentModeId) => void;
  /** Skills available for `/name` send intercept. */
  menuSkills?: Array<{ id: string; name: string; enabled: boolean }>;
  onCompact?: (customInstructions?: string) => Promise<void>;
  onAbort?: () => Promise<void>;
  /** Create (or ensure) a live session when the user sends without one. */
  ensureSession?: (options?: {
    projectPath?: string;
    alreadyTrusted?: boolean;
    scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
  }) => Promise<string | null>;
  /** When Send has no workspace, open the workspace picker (keep draft text). */
  onNeedWorkspace?: () => void | Promise<void>;
  /** Per-next-turn model key `providerId::modelId`. */
  selectedModelKey?: string;
  modelOptions?: Array<{
    protocol: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
    providerId: string;
    modelId: string;
  }>;
  thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
};

export function useComposerMedia(args: UseComposerMediaArgs) {
  const [composer, setComposer] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingComposerAttachment[]>([]);
  const [dropActive, setDropActive] = useState(false);
  // State updates are asynchronous. This ref rejects a double click or an
  // Enter+click before the streaming state has reached the next render.
  const promptSubmissionInProgress = useRef(false);

  const revokePending = useCallback((localId: string): void => {
    setPendingAttachments((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.localId !== localId);
    });
  }, []);

  const clearPendingAttachments = useCallback((): void => {
    setPendingAttachments((current) => {
      for (const item of current) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
  }, []);

  const resolveSessionIdForComposer = useCallback(async (): Promise<string | null> => {
    if (args.state.activeSessionId) {
      return args.state.activeSessionId;
    }
    const isGeneral =
      args.state.activeScope.kind === 'general' || !args.state.projectPath;
    if (!isGeneral && !args.state.projectTrusted) {
      args.dispatch({ type: 'project/trust-dialog', open: true });
      return null;
    }
    if (!args.ensureSession) {
      args.dispatch({ type: 'error', message: 'Create a session before sending' });
      return null;
    }
    if (isGeneral) {
      return args.ensureSession({ scope: { kind: 'general' } });
    }
    return args.ensureSession({ alreadyTrusted: true });
  }, [args]);

  const saveImageFile = useCallback(
    async (file: File, source: 'paste' | 'drop' | 'file-picker'): Promise<void> => {
      const sessionId = await resolveSessionIdForComposer();
      if (!sessionId) {
        return;
      }
      if (!isAllowedImageFile(file)) {
        args.dispatch({
          type: 'error',
          message: `Unsupported image type: ${file.type || file.name}`,
        });
        return;
      }
      try {
        const base64Data = await fileToBase64(file);
        const response = await args.hostClient.request({
          type: 'media/save',
          input: {
            sessionId,
            mimeType: file.type || 'image/png',
            source,
            base64Data,
          },
        });
        if (!response.success) {
          args.dispatch({ type: 'error', message: response.error });
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
        args.dispatch({ type: 'error', message });
      }
    },
    [args, resolveSessionIdForComposer],
  );

  const handleComposerPaste = useCallback(
    async (event: ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
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
    },
    [saveImageFile],
  );

  const handleComposerDrop = useCallback(
    async (event: DragEvent<HTMLTextAreaElement>): Promise<void> => {
      event.preventDefault();
      setDropActive(false);

      // Workspace file tree path drop → inject absolute path for text models.
      const pathPayload = event.dataTransfer?.getData(PIWIN_PATH_MIME);
      if (pathPayload) {
        try {
          const parsed = JSON.parse(pathPayload) as {
            absolutePath?: string;
            relativePath?: string;
          };
          const absolutePath = parsed.absolutePath?.trim();
          if (absolutePath) {
            setComposer((current) =>
              current.trim().length > 0 ? `${current.replace(/\s+$/, '')}\n${absolutePath}` : absolutePath,
            );
            return;
          }
        } catch {
          /* fall through to plain text / images */
        }
      }
      const plainPath = event.dataTransfer?.getData('text/plain')?.trim();
      if (plainPath && !event.dataTransfer?.files?.length && looksLikeFilesystemPath(plainPath)) {
        setComposer((current) =>
          current.trim().length > 0 ? `${current.replace(/\s+$/, '')}\n${plainPath}` : plainPath,
        );
        return;
      }

      const files = [...(event.dataTransfer?.files ?? [])].filter((file) =>
        file.type.startsWith('image/'),
      );
      for (const file of files) {
        await saveImageFile(file, 'drop');
      }
    },
    [saveImageFile],
  );

  const handlePickImageFiles = useCallback((): void => {
    // Session is created lazily inside saveImageFile when needed.
    const isGeneral =
      args.state.activeScope.kind === 'general' || !args.state.projectPath;
    if (!isGeneral && !args.state.projectTrusted && !args.state.activeSessionId) {
      args.dispatch({ type: 'project/trust-dialog', open: true });
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
  }, [args, saveImageFile]);

  /**
   * Add a picked web element (ADR 0020 §6) as a pending composer attachment.
   * Builds a WebElementAttachmentRef with conditional-spread optional
   * fields (exactOptionalPropertyTypes: no ref: undefined).
   */
  const addWebElement = useCallback((pick: WebElementPickResult): void => {
    const attachment: WebElementAttachmentRef = {
      id: crypto.randomUUID(),
      kind: 'web-element',
      url: pick.url,
      selector: pick.selector,
      text: pick.text,
      ...(pick.ref !== undefined ? { ref: pick.ref } : {}),
      ...(pick.html !== undefined ? { html: pick.html } : {}),
      ...(pick.screenshotPath !== undefined ? { screenshotPath: pick.screenshotPath } : {}),
    };
    setPendingAttachments((current) => [
      ...current,
      { localId: attachment.id, attachment, previewUrl: '' },
    ]);
  }, []);

  const resolveTurnModel = useCallback((): import('@piwin/contracts').ModelRef | undefined => {
    const key = args.selectedModelKey?.trim();
    if (!key || !args.modelOptions?.length) {
      return undefined;
    }
    const option = args.modelOptions.find(
      (item) => `${item.providerId}::${item.modelId}` === key,
    );
    if (!option) {
      return undefined;
    }
    return {
      protocol: option.protocol,
      providerId: option.providerId,
      modelId: option.modelId,
    };
  }, [args.modelOptions, args.selectedModelKey]);

  const handleSend = useCallback(async (): Promise<void> => {
    const text = composer.trim();
    const attachments = pendingAttachments.map((item) => item.attachment);
    if (
      (!text && attachments.length === 0) ||
      args.state.streaming ||
      promptSubmissionInProgress.current
    ) {
      return;
    }
    promptSubmissionInProgress.current = true;
    try {
    // General scope: send without project. Project scope: trust required.
    const isGeneral =
      args.state.activeScope.kind === 'general' || !args.state.projectPath;
    if (!isGeneral) {
      if (!args.state.projectPath) {
        await args.onNeedWorkspace?.();
        return;
      }
      if (!args.state.projectTrusted) {
        args.dispatch({ type: 'project/trust-dialog', open: true });
        return;
      }
    }

    // First send without an active session creates one automatically.
    const sessionId = await resolveSessionIdForComposer();
    if (!sessionId) {
      return;
    }

    // Whole-message slash intercept (commands / modes / skills).
    if (text.startsWith('/') && attachments.length === 0) {
      const skills = (args.menuSkills ?? []).map((skill) => ({
        id: skill.id,
        name: skill.name,
        enabled: skill.enabled,
      }));
      const parsed = parseComposerSlashSubmit(text, skills);

      if (parsed.kind === 'command' && parsed.commandId === 'compact') {
        setComposer('');
        clearPendingAttachments();
        const instructions = normalizeCompactCustomInstructions(parsed.args);
        await args.onCompact?.(instructions);
        return;
      }
      if (parsed.kind === 'command' && parsed.commandId === 'stop') {
        setComposer('');
        clearPendingAttachments();
        await args.onAbort?.();
        return;
      }
      if (parsed.kind === 'mode') {
        args.onAgentModeChange?.(parsed.modeId);
        setComposer('');
        clearPendingAttachments();
        if (!parsed.args) {
          return;
        }
        const modePrompt = applyAgentModeToPrompt(parsed.modeId, parsed.args);
        args.dispatch({ type: 'user/send', text: parsed.args, attachments: [] });
        const modeInput: {
          text: string;
          model?: import('@piwin/contracts').ModelRef;
          thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
        } = { text: modePrompt };
        const modeModel = resolveTurnModel();
        if (modeModel) {
          modeInput.model = modeModel;
        }
        if (args.thinkingLevel) {
          modeInput.thinkingLevel = args.thinkingLevel;
        }
        const modeResponse = await args.hostClient.request({
          type: 'session/prompt',
          sessionId,
          input: modeInput,
        });
        if (!modeResponse.success) {
          args.dispatch({ type: 'error', message: modeResponse.error });
        } else {
          const accepted = modeResponse.data as { runId?: string; acceptedAt?: string };
          if (typeof accepted.runId === 'string') {
            args.dispatch({
              type: 'run/accepted',
              runId: accepted.runId,
              ...(accepted.acceptedAt ? { acceptedAt: accepted.acceptedAt } : {}),
            });
          }
        }
        return;
      }
      if (parsed.kind === 'skill') {
        const skillEnabled =
          skills.find((skill) => skill.id === parsed.skillId)?.enabled !== false;
        if (!skillEnabled) {
          args.dispatch({
            type: 'error',
            message: `Skill "${parsed.skillName}" is disabled — enable it in Settings → Skills`,
          });
          return;
        }
        const hostText = applySkillToPrompt(parsed.skillName, parsed.skillId, parsed.args);
        const skillPrompt = applyAgentModeToPrompt(args.agentMode, hostText);
        args.dispatch({ type: 'user/send', text, attachments: [] });
        setComposer('');
        clearPendingAttachments();
        const skillInput: {
          text: string;
          model?: import('@piwin/contracts').ModelRef;
          thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
        } = { text: skillPrompt };
        const skillModel = resolveTurnModel();
        if (skillModel) {
          skillInput.model = skillModel;
        }
        if (args.thinkingLevel) {
          skillInput.thinkingLevel = args.thinkingLevel;
        }
        const skillResponse = await args.hostClient.request({
          type: 'session/prompt',
          sessionId,
          input: skillInput,
        });
        if (!skillResponse.success) {
          args.dispatch({ type: 'error', message: skillResponse.error });
        } else {
          const accepted = skillResponse.data as { runId?: string; acceptedAt?: string };
          if (typeof accepted.runId === 'string') {
            args.dispatch({
              type: 'run/accepted',
              runId: accepted.runId,
              ...(accepted.acceptedAt ? { acceptedAt: accepted.acceptedAt } : {}),
            });
          }
        }
        return;
      }
      // unknown → fall through as normal text
    }

    const promptText = applyAgentModeToPrompt(args.agentMode, text);
    args.dispatch({ type: 'user/send', text, attachments });
    setComposer('');
    clearPendingAttachments();
    const input: {
      text: string;
      attachments?: PromptAttachment[];
      model?: import('@piwin/contracts').ModelRef;
      thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
    } = {
      text: promptText,
    };
    if (attachments.length > 0) {
      input.attachments = attachments;
    }
    const model = resolveTurnModel();
    if (model) {
      input.model = model;
    }
    if (args.thinkingLevel) {
      input.thinkingLevel = args.thinkingLevel;
    }
    const response = await args.hostClient.request({
      type: 'session/prompt',
      sessionId,
      input,
    });
    if (!response.success) {
      args.dispatch({ type: 'error', message: response.error });
    } else {
      const accepted = response.data as { runId?: string; acceptedAt?: string };
      if (typeof accepted.runId === 'string') {
        args.dispatch({
          type: 'run/accepted',
          runId: accepted.runId,
          ...(accepted.acceptedAt ? { acceptedAt: accepted.acceptedAt } : {}),
        });
      }
    }
    } finally {
      promptSubmissionInProgress.current = false;
    }
  }, [
    args,
    composer,
    pendingAttachments,
    clearPendingAttachments,
    resolveSessionIdForComposer,
    resolveTurnModel,
  ]);

  const handleSteer = useCallback(async (): Promise<void> => {
    const text = composer.trim();
    if (!text || !args.state.activeSessionId || !args.state.streaming) {
      return;
    }
    const response = await args.hostClient.request({
      type: 'session/steer',
      sessionId: args.state.activeSessionId,
      message: text,
      ...(args.state.activeRunId ? { runId: args.state.activeRunId } : {}),
    });
    if (!response.success) {
      args.dispatch({ type: 'error', message: response.error });
      return;
    }
    // Local echo so intervention is not lost if host events are delayed.
    args.dispatch({ type: 'user/send', text: `[Steer] ${text}`, attachments: [] });
    setComposer('');
    clearPendingAttachments();
  }, [args, composer, clearPendingAttachments]);

  const handleFollowUp = useCallback(async (): Promise<void> => {
    const text = composer.trim();
    if (!text || !args.state.activeSessionId || !args.state.streaming) {
      return;
    }
    const response = await args.hostClient.request({
      type: 'session/follow_up',
      sessionId: args.state.activeSessionId,
      message: text,
      ...(args.state.activeRunId ? { runId: args.state.activeRunId } : {}),
    });
    if (!response.success) {
      args.dispatch({ type: 'error', message: response.error });
      return;
    }
    args.dispatch({ type: 'user/send', text: `[Follow-up] ${text}`, attachments: [] });
    setComposer('');
  }, [args, composer]);

  return {
    composer,
    setComposer,
    pendingAttachments,
    dropActive,
    setDropActive,
    revokePending,
    clearPendingAttachments,
    handleComposerPaste,
    handleComposerDrop,
    handlePickImageFiles,
    addWebElement,
    handleSend,
    handleSteer,
    handleFollowUp,
  };
}

function looksLikeFilesystemPath(value: string): boolean {
  if (value.includes('\n')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.startsWith('./') || value.startsWith('../')) return true;
  return value.includes('/') && !value.includes(' ');
}
