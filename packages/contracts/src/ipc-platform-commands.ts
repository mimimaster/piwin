/** Remaining HostCommand variants (host, project, media, tools, jobs, …). */

import type { PermissionDecision, PermissionRememberScope } from './host.js';
import type { BrowserInputEvent, BrowserTargetIdentity, BrowserViewportMode } from './browser.js';
import type { ModelProviderConfig } from './config.js';
import type {
  MediaSaveAbortInput,
  MediaSaveBeginInput,
  MediaSaveChunkInput,
  MediaSaveFinishInput,
  MediaListInput,
  MediaDeleteInput,
} from './media.js';
import type {
  DocumentPathResolveCommandInput,
  LocalFileExportCommandInput,
  LocalFilePreviewCommandInput,
  TrustedTextReadCommandInput,
} from './preview.js';
import type { SpeechTranscribeInput } from './speech.js';
import type { InstallSource } from './mcp.js';
import type {
  GitBranchCreateInput,
  GitCheckoutInput,
  GitCommitInput,
  GitStageInput,
  GitStashInput,
  GitUnstageInput,
} from './git.js';
import type {
  PlanStatus,
  PlanStepStatus,
  SessionPlan,
  SessionPlanVersion,
  SessionPlanWriteExpectation,
} from './plan.js';
import type { PlanExecutionRequest } from './plan-execution.js';
import type { PtyOpenInput } from './pty.js';
import type {
  CronJob,
  HookDefinition,
  SessionTodoList,
} from './automation.js';
import type { McpServerConfig } from './mcp.js';
import type { PetStoreQuery } from './pet.js';
import type { PluginInstallSource } from './plugin.js';
import type { SearchRoutePreviewInput, WebSearchTestInput } from './web.js';
import type { PermissionRulesFile } from './permission.js';
import type { ApplySettingsInput } from './settings.js';
import type {
  JobListFilter,
  JobTerminalReason,
  ReadJobLogsInput,
  StartJobInput,
  WaitForJobInput,
} from './job.js';
import type { SubscriptionAuthCommand } from './subscription-oauth.js';
import type { PiEnvironmentHostCommand } from './pi-environment.js';
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
import type { LiveSetIntendedSessionInput } from './live-intended-session.js';
import type { MediaReadCommandInput, MediaSaveCommandInput } from './ipc-media.js';
import type { MarketplacePiPackageSource } from './marketplace-search.js';
import type { MarketplaceCapabilityKind, MarketplaceCategory } from './marketplace.js';

export type PlatformHostCommand =
  | SubscriptionAuthCommand
  | PiEnvironmentHostCommand
  | { id?: string; type: 'host/ping' }
  | { id?: string; type: 'host/status' }
  | { id?: string; type: 'host/shell-environment' }
  | {
      id?: string;
      /**
       * List one Host directory so the shell can pick a workspace.
       * Omit `path` to list the Host home directory.
       */
      type: 'host/list-dir';
      path?: string;
      /** When true, include dotfiles such as `~/.piwin`. Default skips names starting with `.`. */
      includeHidden?: boolean;
    }
  | {
      id?: string;
      /** ADR 0040 §8: query-only aggregate residency/resource metrics. */
      type: 'host/runtime-resources';
    }
  | {
      id?: string;
      /**
       * Bounded Host-wide live runs + pending-permission flags.
       * Opaque session/run ids only — never Host filesystem paths.
       */
      type: 'activity/summary';
      maxItems?: number;
    }
  | {
      id?: string;
      /**
       * ADR 0027: replay buffered pushes from `sinceSeq` (exclusive) to the
       * calling sink. Only valid when the sink is sequenced and the host
       * advertised `pushSequencing`. The host re-emits pushes with their
       * original `seq`/`eventId`, then a terminal `{ type: 'host/replay-done', sinceSeq }`.
       */
      type: 'host/replay';
      sinceSeq: number;
    }
  | { id?: string; type: 'project/list' }
  | { id?: string; type: 'project/open'; path: string }
  | { id?: string; type: 'project/remove'; path: string }
  | { id?: string; type: 'project/trust'; path: string }
  | {
      id?: string;
      type: 'project/authorize-terminal';
      /** Project root for authorization. Empty/omitted = general-scope terminal. */
      projectPath: string;
      cwd?: string;
    }
  | { id?: string; type: 'project/permissions-list'; path: string }
  | { id?: string; type: 'project/permissions-revoke'; path: string; key: string }
  | {
      id?: string;
      type: 'project/list-dir';
      /** Absolute project root (must match opened workspace). */
      projectPath: string;
      /**
       * Relative path under project root (posix-style).
       * Empty / omitted = project root.
       */
      relativePath?: string;
    }
  | {
      id?: string;
      type: 'project/read-file';
      projectPath: string;
      /** Relative path under project root (posix-style). */
      relativePath: string;
      /** Soft cap in bytes (host may enforce a lower max). */
      maxBytes?: number;
      /**
       * Read one raw slice of an image preview announced via
       * `previewChunkBytes`; `length` is capped at `PROJECT_PREVIEW_CHUNK_BYTES`.
       */
      previewRange?: { offset: number; length: number };
    }
  | {
      id?: string;
      type: 'project/find-file';
      /** Absolute project root (must match opened workspace). */
      projectPath: string;
      /**
       * File name or relative path fragment the client could not open.
       * The Host matches by basename, or by path suffix when it contains `/`.
       */
      query: string;
      /** Optional cap; the Host clamps it to PROJECT_FIND_FILE_MAX_MATCHES. */
      maxMatches?: number;
    }
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
   * Interprets a raw clicked path once, Host-side (ADR 0052 §6). Remote-safe:
   * the answer is a logical target, and a host-absolute `local-file` target is
   * refused on projection to a remote client.
   */
  | { id?: string; type: 'preview/resolve-path'; input: DocumentPathResolveCommandInput }
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
  | { id?: string; type: 'voice/live/set-intended-session'; input: LiveSetIntendedSessionInput }
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
      type: 'extensions/uninstall';
      /**
       * Host-managed extensions only. Live sessions drop it through the usual
       * `extensions/apply`; files are deleted once no runtime references them.
       */
      extensionId: string;
    }
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
  /** Stop the server, then drop it from Host MCP config. */
  | { id?: string; type: 'mcp/remove'; serverId: string }
  /** Replaces the MCP servers this session opts out of; applies from the next prompt. */
  | { id?: string; type: 'session/set-mcp-servers'; sessionId: string; disabledServerIds: string[] }
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
  | { id?: string; type: 'git/stash'; input: GitStashInput }
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
  | { id?: string; type: 'plan/get'; sessionId: string }
  | {
      id?: string;
      type: 'plan/set';
      sessionId: string;
      plan: SessionPlan;
      expected: SessionPlanWriteExpectation;
    }
  | {
      id?: string;
      type: 'plan/clear';
      sessionId: string;
      expected: SessionPlanVersion;
    }
  | { id?: string; type: 'plan/approve'; sessionId: string }
  | {
      id?: string;
      type: 'plan/update-step';
      sessionId: string;
      stepId: string;
      status: PlanStepStatus;
      detail?: string;
    }
  | { id?: string; type: 'plan/set-status'; sessionId: string; status: PlanStatus }
  | { id?: string; type: 'plan/execute'; request: PlanExecutionRequest }
  | { id?: string; type: 'plan/abort'; sessionId: string; planId: string }
  | { id?: string; type: 'config/get' }
  | { id?: string; type: 'settings/get' }
  | { id?: string; type: 'settings/apply'; input: ApplySettingsInput }
  | { id?: string; type: 'permissions/get-rules'; layer: 'user' }
  | {
      id?: string;
      type: 'permissions/set-rules';
      layer: 'user';
      rules: PermissionRulesFile;
      expectedRevision?: string;
    }
  | {
      id?: string;
      type: 'models/discover';
      provider: ModelProviderConfig;
      /** One-shot secret for this request only — never persisted by host. */
      apiKey?: string;
    }
  | {
      id?: string;
      type: 'models/catalog/search';
      input?: import('./model-catalog.js').ModelCatalogSearchRequest;
    }
  | { id?: string; type: 'models/catalog/status' }
  | { id?: string; type: 'models/catalog/sync' }
  | { id?: string; type: 'models/configured' }
  | {
      id?: string;
      type: 'models/image-catalog/search';
    }
  | {
      id?: string;
      type: 'models/test';
      provider: ModelProviderConfig;
      modelId: string;
      /** One-shot secret for this request only — never persisted by host. */
      apiKey?: string;
    }
  | {
      id?: string;
      type: 'models/image-test';
      provider: ModelProviderConfig;
      modelId: string;
      /** Optional test prompt. Host uses a deterministic smoke prompt when omitted. */
      prompt?: string;
      /** One-shot secret for this request only — never persisted by host. */
      apiKey?: string;
    }
  | {
      id?: string;
      type: 'vision/delegate';
      input: import('./vision-delegation.js').VisionDelegateInput;
    }
  | { id?: string; type: 'vision/cache/clear' }
  | {
      id?: string;
      type: 'secrets/set';
      providerId: string;
      secret: string;
    }
  | {
      id?: string;
      type: 'secrets/get';
      providerId: string;
    }
  | {
      id?: string;
      type: 'web/test-search-source';
      input: WebSearchTestInput;
    }
  | {
      id?: string;
      type: 'code-search/test-windsurf';
      /** One-shot token from the settings editor (never persisted by host). */
      apiKey?: string;
      apiKeyRef?: string;
      apiKeyEnv?: string;
    }
  | {
      id?: string;
      type: 'web/search-route-preview';
      input: SearchRoutePreviewInput;
    }
  /** Cross-session `web_search` call log, newest first. */
  | {
      id?: string;
      type: 'web/search-log-list';
      /** Page size. Default 50, max 200. */
      limit?: number;
      /** Zero-based row offset for paging. Default 0. */
      offset?: number;
      status?: import('./web.js').WebSearchLogStatusFilter;
    }
  | { id?: string; type: 'web/search-log-clear' }
  | {
      id?: string;
      type: 'permission/resolve';
      requestId: string;
      decision: PermissionDecision;
      /** When decision is allow, optionally remember for this project (network tools). */
      rememberScope?: PermissionRememberScope;
    }
  | { id?: string; type: 'permission/pending-list' }
  | { id?: string; type: 'pty/open'; input: PtyOpenInput }
  | { id?: string; type: 'pty/write'; ptyId: string; data: string }
  | { id?: string; type: 'pty/resize'; ptyId: string; cols: number; rows: number }
  | { id?: string; type: 'pty/close'; ptyId: string }
  | { id?: string; type: 'pty/list'; projectPath?: string }
  | { id?: string; type: 'skills/store-list' }
  | {
      id?: string;
      type: 'marketplace/search';
      query: string;
      /** Max npm hits. Default 20, max 50. */
      limit?: number;
    }
  | {
      id?: string;
      type: 'marketplace/package-install';
      source: MarketplacePiPackageSource;
    }
  | {
      id?: string;
      type: 'marketplace/package-remove';
      /** Raw source exactly as listed in Pi user settings `packages`. */
      packageSource: string;
    }
  | {
      id?: string;
      type: 'marketplace/catalog-list';
      query?: string;
      kinds?: MarketplaceCapabilityKind[];
      category?: MarketplaceCategory;
      includeWithdrawn?: boolean;
    }
  | { id?: string; type: 'marketplace/catalog-get'; entryId: string }
  | {
      id?: string;
      type: 'marketplace/installed-list';
      /** When set, extension availability reflects this session's loaded runtime. */
      sessionId?: string;
      projectPath?: string;
    }
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
  /** CE-OBS: token usage rollup (global / project / session). */
  | {
      id?: string;
      type: 'usage/get-rollup';
      /** When set, restrict to one project (else projectPath below). */
      scope?: import('./host.js').SessionScope;
      /** Legacy project path filter (project scope shorthand). */
      projectPath?: string;
      /** Optional ISO datetime window [from, to]. */
      window?: { from?: string; to?: string };
      /** Max number of per-session rows in the breakdown. Default 20. */
      topSessions?: number;
      /**
       * IANA time zone for `byDay` keys (the viewer's calendar). Omitted or
       * invalid falls back to UTC days.
       */
      timeZone?: string;
    }
  /** CE-OBS: rolling log of recent model calls (default last 60 minutes). */
  | {
      id?: string;
      type: 'usage/list-recent';
      /** When set, restrict to one project (else projectPath below). */
      scope?: import('./host.js').SessionScope;
      /** Legacy project path filter (project scope shorthand). */
      projectPath?: string;
      /** Rolling window length in minutes. Default 60, max 1440. */
      windowMinutes?: number;
      /** Page size, newest first. Default 200, max 1000. */
      limit?: number;
      /** Zero-based row offset inside the window, for paging. Default 0. */
      offset?: number;
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
  | { id?: string; type: 'browser/pick-at'; x: number; y: number; target?: BrowserTargetIdentity }
  | { id?: string; type: 'browser/screenshot'; path?: string }
  | { id?: string; type: 'browser/capture'; sessionId?: string; quality?: number; fullPage?: boolean }
  /**
   * `reason: 'disconnect'` is the Host releasing a lease whose connection went
   * away; unlike an unmount it leaves the id reusable so the client can
   * re-assert it after reconnecting.
   */
  | { id?: string; type: 'browser/stop'; leaseId?: string; reason?: 'disconnect' }
  | { id?: string; type: 'browser/restart' }
  | { id?: string; type: 'browser/reload' }
  | { id?: string; type: 'browser/input'; events: BrowserInputEvent[]; target?: BrowserTargetIdentity }
  /** `claim`: see the content command; the focused panel takes the follow viewport. */
  | { id?: string; type: 'browser/resize'; width: number; height: number; leaseId?: string; mode?: BrowserViewportMode; origin?: 'follow' | 'explicit'; claim?: boolean }
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
  | {
      id?: string;
      type: 'walkthrough/list';
      sessionId: string;
      /** @deprecated Host transcript authority is queried directly; bounded shells cannot supply a complete id set. */
      knownMessageIds?: string[];
    }
  | {
      id?: string;
      type: 'walkthrough/generate';
      sessionId: string;
      messageId: string;
      runId?: string;
      force?: boolean;
    }
  | {
      id?: string;
      type: 'walkthrough/cancel';
      sessionId: string;
      messageId: string;
      generationId?: string;
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
