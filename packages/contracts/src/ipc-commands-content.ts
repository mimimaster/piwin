import type { CronJob, HookDefinition, SessionTodoList } from './automation.js';
import type { BrowserInputEvent } from './browser.js';
import type { IndexFolderOptions, RetrieveOptions } from './doc-rag.js';
import type {
  FlashcardBatchCreateInput,
  FlashcardCreateInput,
  ReviewRating,
} from './flashcards.js';
import type {
  GitBranchCreateInput,
  GitCheckoutInput,
  GitCommitInput,
  GitStageInput,
  GitUnstageInput,
} from './git.js';
import type {
  JobListFilter,
  JobTerminalReason,
  ReadJobLogsInput,
  StartJobInput,
  WaitForJobInput,
} from './job.js';
import type { InstallSource, McpServerConfig } from './mcp.js';
import type {
  MediaDeleteInput,
  MediaListInput,
  MediaReadVariant,
  MediaSaveAbortInput,
  MediaSaveBeginInput,
  MediaSaveChunkInput,
  MediaSaveFinishInput,
  MediaThumbEdge,
  SaveMediaInput,
} from './media.js';
import type { NoteSearchQuery, NoteUpdateInput, NoteWriteInput } from './notes.js';
import type { PetStoreQuery } from './pet.js';
import type { PluginInstallSource } from './plugin.js';
import type {
  LocalFileExportCommandInput,
  LocalFilePreviewCommandInput,
  TrustedTextReadCommandInput,
} from './preview.js';
import type { PtyOpenInput } from './pty.js';
import type { SpeechTranscribeInput } from './speech.js';
import type {
  LiveApplySettingsInput,
  LiveEndInput,
  LiveMediaStateInput,
  LiveReportEventInput,
  LiveRebindInput,
  LiveSetMutedInput,
  LiveSetProviderKeyInput,
  LiveStartInput,
  LiveStatusInput,
} from './voice-live.js';

/**
 * Bytes are base64 only while crossing the desktop-to-host transport.
 * The host persists them immediately; callers must never put this payload in a model prompt.
 */
export type MediaSaveCommandInput = {
  sessionId: string;
  mimeType: string;
  name?: string;
  contentKind?: import('./attachment.js').AttachmentContentKind;
  source: SaveMediaInput['source'];
  base64Data: string;
};

/**
 * Addressed by logical identity (sessionId + assetId) — never by a
 * host-absolute path — so remote clients can fetch vault bytes without
 * learning or forging host paths (ADR 0052).
 */
export type MediaReadCommandInput = {
  sessionId: string;
  assetId: string;
  maxBytes?: number;
  /** `thumb` returns a grid WebP sidecar. Default is the original file. */
  variant?: MediaReadVariant;
  /** 256 (dense) or 384 (standard). Ignored unless variant is `thumb`. */
  thumbEdge?: MediaThumbEdge;
  offset?: number;
  length?: number;
};

export type HostContentCommand =
  | { id?: string; type: 'media/save'; input: MediaSaveCommandInput }
  | { id?: string; type: 'media/save-begin'; input: MediaSaveBeginInput }
  | { id?: string; type: 'media/save-chunk'; input: MediaSaveChunkInput }
  | { id?: string; type: 'media/save-finish'; input: MediaSaveFinishInput }
  | { id?: string; type: 'media/save-abort'; input: MediaSaveAbortInput }
  | { id?: string; type: 'media/read'; input: MediaReadCommandInput }
  | { id?: string; type: 'media/list'; input: MediaListInput }
  | { id?: string; type: 'media/delete'; input: MediaDeleteInput }
  /**
   * Config-root-relative text preview (ADR 0052 Slice 3). Remote-safe:
   * callers send a path under `~/.piwin`, never a host-absolute path.
   */
  | { id?: string; type: 'preview/read-trusted-text'; input: TrustedTextReadCommandInput }
  /**
   * Local-Host only. Previews a clicked host path as media or text
   * (ADR 0052 Slice 4). Remote host-server rejects this command.
   */
  | { id?: string; type: 'preview/read-local-file'; input: LocalFilePreviewCommandInput }
  /**
   * Local-Host only. Returns file bytes for Desktop Save As (user gesture).
   * Remote host-server rejects this command.
   */
  | { id?: string; type: 'preview/export-local-file'; input: LocalFileExportCommandInput }
  /**
   * Transient Desktop audio. Unlike media/save, Host must not write this input
   * to ~/.piwin/media, transcript, prompt attachments, or logs.
   */
  | { id?: string; type: 'speech/transcribe'; input: SpeechTranscribeInput }
  /** piwin Live status (ready / missing / sanitized call). */
  | { id?: string; type: 'voice/live/status'; input: LiveStatusInput }
  | { id?: string; type: 'voice/live/settings-schema' }
  | { id?: string; type: 'voice/live/apply-settings'; input: LiveApplySettingsInput }
  | { id?: string; type: 'voice/live/set-provider-key'; input: LiveSetProviderKeyInput }
  | { id?: string; type: 'voice/live/start'; input: LiveStartInput }
  | { id?: string; type: 'voice/live/rebind'; input: LiveRebindInput }
  | { id?: string; type: 'voice/live/media-state'; input: LiveMediaStateInput }
  | { id?: string; type: 'voice/live/set-muted'; input: LiveSetMutedInput }
  | { id?: string; type: 'voice/live/end'; input: LiveEndInput }
  | { id?: string; type: 'voice/live/report-event'; input: LiveReportEventInput }
  | { id?: string; type: 'skills/list'; projectPath?: string }
  | {
      id?: string;
      type: 'skills/read';
      /** Prefer logical id when known. */
      skillId?: string;
      /**
       * Local legacy transcript absolute path only.
       * Host maps it to a catalog skill; never used as a free read root.
       */
      legacyPath?: string;
      /** Optional project context for scanning project-local skills (local only). */
      projectPath?: string;
      maxBytes?: number;
    }
  | { id?: string; type: 'skills/set_enabled'; skillId: string; enabled: boolean }
  | {
      id?: string;
      type: 'skills/install';
      source: InstallSource;
      name?: string;
    }
  | { id?: string; type: 'skills/uninstall'; skillId: string }
  | { id?: string; type: 'extensions/list'; projectPath?: string }
  | {
      id?: string;
      type: 'extensions/set_enabled';
      extensionId: string;
      enabled: boolean;
    }
  | {
      id?: string;
      type: 'extensions/apply';
      sessionId: string;
      when: 'now' | 'after-current-run' | 'new-sessions-only';
      targetExtensionSetRevision?: string;
      expectedSettingsRevision?: string;
      expectedRegistryRevision?: string;
      deploymentId?: string;
    }
  | { id?: string; type: 'extensions/ensure-bundled' }
  | {
      id?: string;
      type: 'extensions/install';
      source: InstallSource;
      name?: string;
    }
  | { id?: string; type: 'prompts/list'; projectPath?: string }
  | {
      id?: string;
      type: 'prompts/set_enabled';
      promptId: string;
      enabled: boolean;
    }
  | { id?: string; type: 'mcp/get' }
  | { id?: string; type: 'mcp/validate'; document: unknown }
  | { id?: string; type: 'mcp/save'; document: unknown }
  | { id?: string; type: 'mcp/list_tools'; serverId: string }
  | { id?: string; type: 'mcp/status' }
  | { id?: string; type: 'mcp/start'; serverId: string }
  | { id?: string; type: 'mcp/stop'; serverId: string }
  | { id?: string; type: 'git/status'; projectPath: string }
  | {
      id?: string;
      type: 'git/branch-list';
      projectPath: string;
      limit?: number;
    }
  | { id?: string; type: 'git/diff-summary'; projectPath: string }
  | { id?: string; type: 'git/log-graph'; projectPath: string; limit?: number }
  | {
      id?: string;
      type: 'git/diff-file';
      projectPath: string;
      /** Path relative to repo root. */
      path: string;
      /** Default `combined` (worktree vs HEAD). */
      scope?: 'worktree' | 'staged' | 'combined';
    }
  | { id?: string; type: 'git/stage'; input: GitStageInput }
  | { id?: string; type: 'git/unstage'; input: GitUnstageInput }
  | { id?: string; type: 'git/commit'; input: GitCommitInput }
  | { id?: string; type: 'git/branch-create'; input: GitBranchCreateInput }
  | { id?: string; type: 'git/checkout'; input: GitCheckoutInput }
  | { id?: string; type: 'theme/list' }
  | { id?: string; type: 'theme/get-active' }
  | { id?: string; type: 'theme/set-active'; themeId: string }
  | { id?: string; type: 'theme/install-local'; sourcePath: string }
  | { id?: string; type: 'pet/list' }
  | { id?: string; type: 'pet/get-active' }
  | { id?: string; type: 'pet/set-active'; petId: string }
  | { id?: string; type: 'pet/scan-local'; sourcePath: string }
  | { id?: string; type: 'pet/install-local'; sourcePath: string }
  | { id?: string; type: 'pet/install-local-batch'; sourcePaths: string[] }
  | { id?: string; type: 'pet/store-query'; query: PetStoreQuery }
  | { id?: string; type: 'pet/install-registry'; url: string; sha256?: string }
  | { id?: string; type: 'pet/cancel'; requestId: string }
  | { id?: string; type: 'pet/delete'; petId: string }
  /** Notes library (ADR 0018): CRUD + hybrid search + recall eval. */
  | { id?: string; type: 'notes/list'; collection?: string; tags?: string[] }
  | { id?: string; type: 'notes/read'; noteId: string }
  | { id?: string; type: 'notes/search'; query: NoteSearchQuery }
  | { id?: string; type: 'notes/write'; input: NoteWriteInput }
  | { id?: string; type: 'notes/update'; input: NoteUpdateInput }
  | { id?: string; type: 'notes/delete'; noteId: string; expectedContentHash?: string }
  | { id?: string; type: 'notes/reindex' }
  | { id?: string; type: 'notes/eval-run'; k?: number }
  | { id?: string; type: 'notes/eval-history' }
  /** Flashcards (ADR 0018): CRUD + FSRS review, incl. artifact rate actions. */
  | { id?: string; type: 'flashcards/create'; input: FlashcardCreateInput }
  | {
      id?: string;
      type: 'flashcards/list';
      deck?: string;
      sourceNoteId?: string;
      sourceFolder?: string;
      sequenceId?: string;
    }
  | { id?: string; type: 'flashcards/delete'; cardId: string }
  | { id?: string; type: 'flashcards/decks' }
  | { id?: string; type: 'flashcards/queue'; deck?: string }
  | { id?: string; type: 'flashcards/rate'; cardId: string; rating: ReviewRating }
  | { id?: string; type: 'flashcards/export'; deck?: string }
  | { id?: string; type: 'flashcards/batch-create'; input: FlashcardBatchCreateInput }
  /** Doc Cards (folder-sourced flashcards): scan / index / retrieve / bind. See docs/specs/doc-flashcards.md. */
  | { id?: string; type: 'doccards/scan-folder'; folderPath: string }
  | ({
      id?: string;
      type: 'doccards/index-folder';
      folderPath: string;
    } & Omit<IndexFolderOptions, 'signal'>)
  | ({
      id?: string;
      type: 'doccards/retrieve';
      folderPath: string;
      query: string;
    } & Omit<RetrieveOptions, 'signal' | 'embeddingProvider'>)
  | { id?: string; type: 'doccards/list-by-folder'; folderPath: string }
  | { id?: string; type: 'doccards/rebind-folder'; oldPath: string; newPath: string }
  | { id?: string; type: 'doccards/forget-folder'; folderPath: string }
  | { id?: string; type: 'doccards/open-source'; cardId: string; openFile?: boolean }
  | { id?: string; type: 'doccards/index-status'; folderPath: string }
  | { id?: string; type: 'doccards/cancel-index'; folderPath: string }
  | {
      id?: string;
      type: 'doccards/generate';
      folderPath: string;
      includeFiles?: string[];
      topic?: string;
      difficulty?: 'easy' | 'medium' | 'hard';
      density?: 'concise' | 'standard' | 'detailed';
      deck?: string;
    }
  | { id?: string; type: 'doccards/generation-status'; folderPath: string }
  | { id?: string; type: 'doccards/cancel-generation'; folderPath: string }
  | { id?: string; type: 'pty/open'; input: PtyOpenInput }
  | { id?: string; type: 'pty/write'; ptyId: string; data: string }
  | { id?: string; type: 'pty/resize'; ptyId: string; cols: number; rows: number }
  | { id?: string; type: 'pty/close'; ptyId: string }
  | { id?: string; type: 'pty/list'; projectPath?: string }
  | { id?: string; type: 'skills/store-list' }
  | { id?: string; type: 'mcp/registry-list'; query?: string }
  | {
      id?: string;
      type: 'mcp/registry-install-draft';
      serverId: string;
      draft: McpServerConfig;
    }
  | { id?: string; type: 'cron/list' }
  | { id?: string; type: 'cron/upsert'; job: CronJob }
  | { id?: string; type: 'cron/delete'; jobId: string }
  | { id?: string; type: 'cron/run'; jobId: string }
  | { id?: string; type: 'hooks/list' }
  | { id?: string; type: 'hooks/set'; hooks: HookDefinition[] }
  | { id?: string; type: 'todo/get'; sessionId: string }
  | {
      id?: string;
      type: 'todo/set';
      sessionId: string;
      items: SessionTodoList['items'];
      expectedRevision?: string;
    }
  | {
      id?: string;
      type: 'extension/ui_resolve';
      requestId: string;
      confirmed?: boolean;
      value?: string;
      cancelled?: boolean;
    }
  | { id?: string; type: 'browser/start'; leaseId?: string }
  | { id?: string; type: 'browser/navigate'; url: string }
  | { id?: string; type: 'browser/pick-at'; x: number; y: number }
  | { id?: string; type: 'browser/screenshot'; path?: string }
  | { id?: string; type: 'browser/stop'; leaseId?: string }
  | { id?: string; type: 'browser/restart' }
  | { id?: string; type: 'browser/input'; events: BrowserInputEvent[] }
  | { id?: string; type: 'browser/lock'; owner: 'agent' | 'user' }
  | { id?: string; type: 'browser/unlock'; owner: 'agent' | 'user' }
  | { id?: string; type: 'browser/resize'; width: number; height: number }
  | { id?: string; type: 'browser/back' }
  | { id?: string; type: 'browser/forward' }
  | { id?: string; type: 'browser/new-tab'; url?: string }
  | { id?: string; type: 'browser/select-tab'; pageId: string }
  | { id?: string; type: 'browser/close-tab'; pageId: string }
  | {
      id?: string;
      type: 'browser/dialog';
      action: 'accept' | 'dismiss';
      promptText?: string;
    }
  /** Plugin system: install / list / uninstall / registry / secrets. */
  | {
      id?: string;
      type: 'plugins/install';
      source: PluginInstallSource;
      secrets?: Record<string, string>;
    }
  | { id?: string; type: 'plugins/list' }
  | { id?: string; type: 'plugins/uninstall'; pluginId: string }
  | { id?: string; type: 'plugins/registry/list'; registryUrl?: string }
  | {
      id?: string;
      type: 'plugins/secrets/collect';
      pluginId: string;
      secrets: Record<string, string>;
    }
  | { id?: string; type: 'job/start'; input: StartJobInput }
  | { id?: string; type: 'job/list'; filter?: JobListFilter }
  | { id?: string; type: 'job/get'; jobId: string }
  | { id?: string; type: 'job/logs'; input: ReadJobLogsInput }
  | { id?: string; type: 'job/wait'; input: WaitForJobInput }
  | { id?: string; type: 'job/stop'; jobId: string; reason?: JobTerminalReason };
