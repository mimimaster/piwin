import { randomUUID } from 'node:crypto';
import type {
  ActiveLoginStatus,
  AuthLoginFinishedData,
  AuthLoginInput,
  AuthPromptPayload,
  AuthStatusData,
  HostPush,
  PiwinConfig,
  SettingsApplyResult,
  SubscriptionAccount,
} from '@piwin/contracts';
import {
  AUTH_LOGIN_IDLE_MS,
  allocateRelocateChannelId,
  classifySubscriptionLoginFailure,
  isV1SubscriptionProviderId,
  isSubscriptionOauthProviderId,
  isClaudeCodeOauthProviderId,
  piOauthLoginProviderId,
  CLAUDE_CODE_OAUTH_PROVIDER_ID,
} from '@piwin/contracts';
import {
  createSubscriptionAuthPort,
  defaultPiAuthPaths,
  LIVE_CATALOG_REFRESH_TIMEOUT_MS,
  deleteOauthCredential,
  hasOauthCredential,
  materializeClaudeCodeCredentialFromAnthropic,
  type HostAuthEvent,
  type HostAuthPrompt,
  type SubscriptionAuthPort,
} from '@piwin/agent-host';
import { applySubscriptionSettings } from './apply-subscription-settings.js';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinRoot, resolveHostPiAgentDir } from './paths.js';
import { rewriteChannelModelRefs } from './rewrite-channel-model-refs.js';
import { buildSubscriptionAccounts, findCollidingChannelId, oauthProviderIds } from './subscription-account-status.js';
import { applyDevinLogoutWebSearch, applySubscriptionLoginDefaults } from './subscription-login-defaults.js';
import { isSubscriptionAccountUsable } from './resolve-chat-model.js';
import {
  ensureSubscriptionProviders,
  upsertSubscriptionProvider,
} from './seed-subscription-provider.js';
import { resolveConfiguredDefaultModelRef } from './provider-helpers.js';
import { selectSubscriptionLoginMethod } from './select-subscription-login-method.js';
import {
  readSubscriptionExtensionProviders,
  type SubscriptionExtensionProvider,
} from './subscription-extension-providers.js';
import { eventToPayload, promptToPayload } from './subscription-auth-prompt-payload.js';
import { SubscriptionAuthWatcher } from './subscription-auth-watcher.js';
import { mergeSubscriptionCatalogModels, type ConfiguredChatModels } from './subscription-model-overlay.js';
import { assertCodexCallbackPortFree } from './subscription-oauth-callback-port.js';
import type { ResolveChatModelAccounts } from './resolve-chat-model.js';

export type SubscriptionAuthServiceOptions = {
  piwinRoot?: string;
  piAgentDir?: string;
  port?: SubscriptionAuthPort;
  now?: () => number;
  /** Pi CLI opens the auth URL itself. Host must do the same on this machine. */
  openAuthUrl?: (url: string) => void;
};

type PendingPrompt = {
  promptId: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

type ActiveLogin = {
  loginId: string;
  providerId: string;
  ownerDeviceId: string;
  startedAt: string;
  preferLoopback: boolean;
  openAuthUrlOnHost: boolean;
  abort: AbortController;
  currentPrompt?: AuthPromptPayload;
  authUrl?: AuthPromptPayload;
  pending?: PendingPrompt;
  newChannelId?: string;
};

const LIVE_ACCOUNT_STATES = new Set(['logged-in', 'logging-in', 'sync-error', 'needs-reauth']);

export class SubscriptionAuthService {
  private port: SubscriptionAuthPort | undefined;
  private portExtensionFingerprint: string | undefined;
  /** Last enabled extension claims; sync callers (reauth, prompts) read this. */
  private extensionProviders: readonly SubscriptionExtensionProvider[] = [];
  private extensionProjectionPending = false;
  private readonly reloadPortOnExtensions: boolean;
  private readonly portFactory: () => Promise<SubscriptionAuthPort>;
  private readonly loadConfig: () => Promise<PiwinConfig>;
  private readonly saveConfig: (config: PiwinConfig) => Promise<void>;
  /** Tests inject saveConfig. Production writes go through the settings queue. */
  private readonly externalConfigStore: boolean;
  private readonly piwinRoot: string | undefined;
  private readonly authPath: string;
  private readonly now: () => number;
  private readonly openAuthUrl: ((url: string) => void) | undefined;
  private push: ((message: HostPush) => void) | undefined;
  private onSettingsApplied: ((result: SettingsApplyResult) => void) | undefined;
  private cancelRuns: ((providerId: string) => Promise<void>) | undefined;
  private relocatePersist: ((fromProviderId: string, toProviderId: string) => Promise<void>) | undefined;
  private active: ActiveLogin | undefined;
  private readonly credentialWatcher: SubscriptionAuthWatcher;
  private lastFingerprint = '';
  private lastOauthProviderIds = new Set<string>();
  private readonly syncErrorProviderIds = new Set<string>();
  private readonly needsReauthProviderIds = new Set<string>();
  private readonly deviceConnections = new Map<string, number>();
  private ownerConnected = true;
  private trackedDeviceConnections = false;

  constructor(
    options: SubscriptionAuthServiceOptions = {},
    deps: {
    loadConfig?: () => Promise<PiwinConfig>;
    saveConfig?: (config: PiwinConfig) => Promise<void>;
    applySettings?: (config: PiwinConfig) => Promise<void>;
    createPort?: () => Promise<SubscriptionAuthPort>;
  } = {},
) {
    const agentDir = resolveHostPiAgentDir({
      ...(options.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : {}),
      ...(options.piAgentDir !== undefined ? { piAgentDir: options.piAgentDir } : {}),
    });
    const paths = defaultPiAuthPaths(agentDir);
    this.authPath = paths.authPath;
    this.credentialWatcher = new SubscriptionAuthWatcher(this.authPath, () => this.emitUpdatedIfChanged());
    this.now = options.now ?? Date.now;
    this.openAuthUrl = options.openAuthUrl;
    this.loadConfig =
      deps.loadConfig ?? (() => loadPiwinConfig(getPiwinRoot(options.piwinRoot)));
    this.externalConfigStore = deps.applySettings !== undefined || deps.saveConfig !== undefined;
    this.reloadPortOnExtensions = options.port === undefined && deps.createPort === undefined;
    this.saveConfig =
      deps.applySettings ??
      deps.saveConfig ??
      (async (config) => {
        await applySubscriptionSettings({
          ...(options.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : {}),
          derive: () => config,
          ...(this.push ? { push: this.push } : {}),
          ...(this.onSettingsApplied ? { onApplied: this.onSettingsApplied } : {}),
        });
      });
    this.piwinRoot = options.piwinRoot;
    this.port = options.port;
    this.portFactory = deps.createPort ?? (async () =>
      options.port ?? createSubscriptionAuthPort({
        authPath: paths.authPath,
        modelsPath: paths.modelsPath,
        extensionProviders: (await this.readExtensionProviders()).map((provider) => ({
          providerId: provider.providerId,
          entryPath: provider.entryPath,
        })),
      }));
  }

  bindPush(push: (message: HostPush) => void): void {
    this.push = push;
  }

  bindSettingsApplied(handler: (result: SettingsApplyResult) => void): void {
    this.onSettingsApplied = handler;
  }

  bindCancelRuns(handler: (providerId: string) => Promise<void>): void {
    this.cancelRuns = handler;
  }

  bindRelocatePersist(
    handler: (fromProviderId: string, toProviderId: string) => Promise<void>,
  ): void {
    this.relocatePersist = handler;
  }

  markNeedsReauth(providerId: string): void {
    if (!this.isKnownProvider(providerId)) {
      return;
    }
    this.needsReauthProviderIds.add(providerId);
    this.emitUpdated();
  }

  noteDeviceConnected(deviceId: string): void {
    const id = deviceId.trim();
    if (!id) {
      return;
    }
    this.trackedDeviceConnections = true;
    this.deviceConnections.set(id, (this.deviceConnections.get(id) ?? 0) + 1);
    this.syncOwnerConnected();
  }

  noteDeviceDisconnected(deviceId: string): void {
    const id = deviceId.trim();
    if (!id) {
      return;
    }
    const next = (this.deviceConnections.get(id) ?? 0) - 1;
    if (next <= 0) {
      this.deviceConnections.delete(id);
    } else {
      this.deviceConnections.set(id, next);
    }
    this.syncOwnerConnected();
  }

  setOwnerConnected(connected: boolean): void {
    this.ownerConnected = connected;
  }

  async chatResolveInput(): Promise<ResolveChatModelAccounts> {
    let accounts = await this.readAccounts();
    if (this.extensionProjectionPending) {
      await this.projectLoggedInProviders();
      this.extensionProjectionPending = false;
      accounts = await this.readAccounts();
    }
    this.lastOauthProviderIds = oauthProviderIds(accounts);
    const catalogModelIds = new Map<string, readonly string[]>();
    for (const account of accounts) {
      if (!isSubscriptionAccountUsable(account)) {
        continue;
      }
      catalogModelIds.set(account.providerId, this.catalogModelIds(account.providerId));
    }
    // readAccounts refreshed the extension snapshot; hand compilers the same one.
    return { accounts, catalogModelIds, extensionProviders: this.extensionProviders };
  }

  usableSubscriptionProviderIds(): string[] {
    return [...this.lastOauthProviderIds];
  }

  async refreshProvider(providerId: string): Promise<void> {
    const port = await this.ensurePort();
    await port.refreshProvider(providerId);
  }

  /**
   * Pull pi.dev overlay for logged-in subscription providers once.
   * Failure keeps the builtin / models-store cache; Host start must not crash.
   */
  async refreshLiveCatalog(providers?: readonly string[]): Promise<void> {
    try {
      const port = await this.ensurePort();
      await port.refreshLiveCatalog({
        ...(providers !== undefined ? { providers } : {}),
        signal: AbortSignal.timeout(LIVE_CATALOG_REFRESH_TIMEOUT_MS),
      });
    } catch {
      // Keep builtin / Host models-store.json catalog.
    }
  }

  async status(): Promise<AuthStatusData> {
    let accounts = await this.readAccounts();
    if (this.extensionProjectionPending) {
      await this.projectLoggedInProviders();
      this.extensionProjectionPending = false;
      accounts = await this.readAccounts();
    }
    const data: AuthStatusData = { accounts };
    if (this.active) {
      data.activeLogin = this.toActiveLoginStatus();
    }
    return data;
  }

  async login(input: AuthLoginInput): Promise<{ loginId: string } | { error: string; code: string }> {
    // Built-in ids never need the extension store; extension ids use a fresh claim list.
    if (!isSubscriptionOauthProviderId(input.providerId)) await this.readExtensionProviders();
    if (!this.isKnownProvider(input.providerId)) {
      return {
        error:
          `Unsupported subscription provider: ${input.providerId}. ` +
          'Extension providers need their extension installed and enabled first.',
        code: 'unsupported-subscription-provider',
      };
    }
    if (this.active) {
      return { error: 'A subscription login is already in progress.', code: 'auth-busy' };
    }
    if (input.providerId === 'openai-codex' && input.preferLoopback === true) {
      try {
        await assertCodexCallbackPortFree();
      } catch {
        return {
          error: '请先结束 CPA/其他工具的 Codex 登录',
          code: 'oauth-callback-port-busy',
        };
      }
    }
    const config = await this.loadConfig();
    const collidingChannelId = findCollidingChannelId(config, input.providerId);
    let newChannelId: string | undefined;
    if (collidingChannelId !== undefined) {
      if (input.relocateChannelId !== collidingChannelId) {
        return {
          error: `Channel id "${input.providerId}" collides with a subscription account.`,
          code: 'collision',
        };
      }
      newChannelId = await this.relocateChannel(config, collidingChannelId);
    }

    const loginId = randomUUID();
    const abort = new AbortController();
    this.active = {
      loginId,
      providerId: input.providerId,
      ownerDeviceId: input.ownerDeviceId,
      startedAt: new Date(this.now()).toISOString(),
      preferLoopback: input.preferLoopback === true,
      openAuthUrlOnHost: input.openAuthUrlOnHost !== false,
      abort,
      ...(newChannelId !== undefined ? { newChannelId } : {}),
    };
    const idle = setTimeout(() => {
      void this.cancel(loginId, 'owner');
    }, AUTH_LOGIN_IDLE_MS);
    idle.unref?.();

    void this.runLogin(input.providerId, abort.signal).finally(() => {
      clearTimeout(idle);
    });
    this.ownerConnected = true;
    this.emitUpdated();
    console.log(
      `[piwin-host] auth/login start provider=${input.providerId} loginId=${loginId} preferLoopback=${String(this.active.preferLoopback)}`,
    );
    return { loginId };
  }

  async respond(
    loginId: string,
    promptId: string,
    value: string,
    deviceId: string,
  ): Promise<{ error?: string; code?: string }> {
    const active = this.active;
    if (!active || active.loginId !== loginId) {
      return { error: 'Login is no longer active.', code: 'ticket-consumed' };
    }
    if (active.ownerDeviceId !== deviceId) {
      return { error: 'Another device owns this login.', code: 'auth-not-owner' };
    }
    if (!active.pending || active.pending.promptId !== promptId) {
      return { error: 'This prompt was already answered.', code: 'ticket-consumed' };
    }
    const pending = active.pending;
    delete active.pending;
    pending.resolve(value);
    return {};
  }

  async cancel(loginId: string, deviceId: string): Promise<{ error?: string; code?: string }> {
    const active = this.active;
    if (!active || active.loginId !== loginId) {
      return {};
    }
    if (deviceId !== 'owner' && active.ownerDeviceId !== deviceId) {
      return { error: 'Another device owns this login.', code: 'auth-not-owner' };
    }
    active.abort.abort();
    if (active.pending) {
      active.pending.reject(new Error('login-cancelled'));
      delete active.pending;
    }
    return {};
  }

  async claim(
    loginId: string,
    deviceId: string,
  ): Promise<{ error?: string; code?: string }> {
    const active = this.active;
    if (!active || active.loginId !== loginId) {
      return { error: 'Login is no longer active.', code: 'ticket-consumed' };
    }
    if (this.isOwnerStillConnected()) {
      return { error: 'The login owner is still connected.', code: 'auth-not-owner' };
    }
    active.ownerDeviceId = deviceId;
    this.ownerConnected = true;
    return {};
  }

  async logout(
    providerId: string,
    cancelRuns?: (providerId: string) => Promise<void>,
  ): Promise<{ error?: string; code?: string }> {
    if (!isSubscriptionOauthProviderId(providerId)) await this.readExtensionProviders();
    if (!this.isKnownProvider(providerId)) {
      return {
        error: `Unsupported subscription provider: ${providerId}`,
        code: 'unsupported-subscription-provider',
      };
    }
    const cancel = cancelRuns ?? this.cancelRuns;
    if (cancel) {
      await cancel(providerId);
    }

    if (isClaudeCodeOauthProviderId(providerId)) {
      // Independent of plain anthropic extra-usage card.
      await deleteOauthCredential(this.authPath, CLAUDE_CODE_OAUTH_PROVIDER_ID);
      this.syncErrorProviderIds.delete(providerId);
      this.needsReauthProviderIds.delete(providerId);
      await this.ensureLoggedInProviders();
      this.emitUpdated();
      return {};
    }

    const port = await this.ensurePort();
    const outcome = await port.logout(providerId);
    if (outcome.kind === 'failed') {
      return { error: outcome.message, code: 'provider-authentication' };
    }
    if (outcome.kind === 'sync-error') {
      this.syncErrorProviderIds.add(providerId);
    } else {
      this.syncErrorProviderIds.delete(providerId);
      this.needsReauthProviderIds.delete(providerId);
    }
    try {
      await this.ensureLoggedInProviders();
      if (providerId === 'devin') {
        await this.persistDevinLogoutWebSearch();
      }
    } catch (error) {
      // The credential is already gone. A settings-queue conflict must not
      // surface as a failed logout.
      console.warn('[piwin-host] auth/logout provider projection failed', error);
    }
    this.emitUpdated();
    return {};
  }

  async mergeConfiguredModels(channelModels: ConfiguredChatModels): Promise<ConfiguredChatModels> {
    await this.ensurePort();
    return mergeSubscriptionCatalogModels(
      channelModels,
      await this.readAccounts(),
      await this.loadConfig(),
      (providerId) => this.chatCatalogFor(providerId),
    );
  }

  startWatch(): void {
    this.credentialWatcher.start();
  }

  dispose(): void {
    if (this.active) {
      this.active.abort.abort();
      this.active.pending?.reject(new Error('login-cancelled'));
      this.active = undefined;
    }
    this.credentialWatcher.dispose();
  }

  catalogModelIds(providerId: string): string[] {
    return this.chatCatalogFor(providerId).map((model) => model.id);
  }

  private chatCatalogFor(providerId: string) {
    const catalogId = isClaudeCodeOauthProviderId(providerId) ? 'anthropic' : providerId;
    return this.port?.getChatCatalog(catalogId) ?? [];
  }

  /**
   * Never throws. `active` is the login gate (`auth-busy`), so every exit path
   * must clear it and push `auth/login-finished`: a throw from port creation or
   * post-login bookkeeping used to leave the account stuck on "logging-in"
   * until the Host was restarted.
   *
   * Pi renders the browser success page before exchanging the code, so a failed
   * outcome here is the only signal that the sign-in did not actually finish —
   * it must always reach the shell.
   */
  private async runLogin(providerId: string, signal: AbortSignal): Promise<void> {
    const loginId = this.active?.loginId;
    if (!loginId) {
      return;
    }
    const newChannelId = this.active?.newChannelId;
    let failureCode: string | undefined;
    let followUp: AuthLoginFinishedData['followUp'];
    let credentialStored = false;
    try {
      const port = await this.ensurePort();
      const authPath = this.authPath;
      const claudeCode = isClaudeCodeOauthProviderId(providerId);
      const piLoginId = piOauthLoginProviderId(providerId);
      const hadPlainAnthropic =
        claudeCode && authPath ? await hasOauthCredential(authPath, 'anthropic') : false;

      let outcome: Awaited<ReturnType<typeof port.login>>;
      if (claudeCode && authPath && (await hasOauthCredential(authPath, CLAUDE_CODE_OAUTH_PROVIDER_ID))) {
        outcome = { kind: 'ok' };
      } else if (claudeCode && authPath && hadPlainAnthropic) {
        // Independent card: clone existing anthropic OAuth into anthropic-claude-code.
        const copied = await materializeClaudeCodeCredentialFromAnthropic(
          authPath,
          CLAUDE_CODE_OAUTH_PROVIDER_ID,
        );
        outcome = copied
          ? { kind: 'ok' }
          : { kind: 'failed', message: 'Failed to materialize Claude Code credentials' };
      } else {
        outcome = await port.login(piLoginId, {
          signal,
          prompt: (prompt) => this.handlePrompt(prompt),
          notify: (event) => this.handleNotify(event),
        });
        if (outcome.kind === 'ok' && claudeCode && authPath) {
          await materializeClaudeCodeCredentialFromAnthropic(authPath, CLAUDE_CODE_OAUTH_PROVIDER_ID);
          // Keep bottom Claude card independent: drop plain anthropic if it was not logged in before.
          if (!hadPlainAnthropic) {
            await deleteOauthCredential(authPath, 'anthropic');
          }
        }
      }

      credentialStored = outcome.kind === 'ok';
      if (outcome.kind === 'failed') {
        failureCode =
          ('code' in outcome && outcome.code) || classifySubscriptionLoginFailure(outcome.message);
      }
      if (outcome.kind === 'sync-error') {
        this.syncErrorProviderIds.add(providerId);
      } else if (outcome.kind === 'ok') {
        this.syncErrorProviderIds.delete(providerId);
        this.needsReauthProviderIds.delete(providerId);
        // Plan-quota login deletes the temporary `anthropic` key. Refreshing it
        // would fail and mark this card sync-error even though auth succeeded.
        if (!(claudeCode && !hadPlainAnthropic)) {
          try {
            await port.refreshProvider(piLoginId);
          } catch {
            this.syncErrorProviderIds.add(providerId);
          }
        }
        const seeded = await this.ensureProviderForAccount(providerId);
        followUp = seeded.followUp;
        await this.evictSiblingClaudeAuth(providerId);
        await this.maybeSeedDefault(providerId);
        this.startWatch();
      }
    } catch (error) {
      // Outside the port's own error mapping: Pi/disk/bookkeeping blew up.
      console.error(
        `[piwin-host] auth/login error provider=${providerId} loginId=${loginId}`,
        error,
      );
      if (credentialStored) {
        // The credential is on disk; only the Host-side follow-up failed.
        this.syncErrorProviderIds.add(providerId);
      } else {
        failureCode = classifySubscriptionLoginFailure(error);
      }
    } finally {
      this.active = undefined;
      this.push?.({
        type: 'auth/login-finished',
        result: {
          loginId,
          providerId,
          ok: failureCode === undefined,
          ...(failureCode !== undefined ? { errorCode: failureCode } : {}),
          ...(newChannelId !== undefined ? { newChannelId } : {}),
          ...(followUp !== undefined ? { followUp } : {}),
        },
      });
      if (failureCode !== undefined) {
        console.warn(
          `[piwin-host] auth/login failed provider=${providerId} loginId=${loginId} code=${failureCode}`,
        );
      }
      this.emitUpdated();
    }
  }

  private async handlePrompt(prompt: HostAuthPrompt): Promise<string> {
    const active = this.active;
    if (!active) {
      throw new Error('login-cancelled');
    }
    if (prompt.type === 'select') {
      const method = selectSubscriptionLoginMethod(prompt.options);
      if (method) {
        return method;
      }
    }
    if (
      prompt.message?.includes('press Enter for browser login') ||
      // Extension OAuth flows commonly offer "browser login or paste a key";
      // shells drive the browser path, so accept it before any URL arrives.
      (this.isExtensionProvider(active.providerId) &&
        prompt.type === 'text' &&
        !active.authUrl &&
        prompt.message?.includes('browser login'))
    ) {
      return '';
    }
    const promptId = randomUUID();
    const payload = promptToPayload(active, promptId, prompt);
    active.currentPrompt = payload;
    this.push?.({ type: 'auth/prompt', prompt: payload });
    return new Promise<string>((resolve, reject) => {
      active.pending = { promptId, resolve, reject };
      const signal = prompt.signal;
      if (!signal) {
        return;
      }
      const onAbort = (): void => {
        if (active.pending?.promptId !== promptId) {
          return;
        }
        delete active.pending;
        const cancelled: AuthPromptPayload = {
          ...payload,
          kind: 'prompt-cancelled',
          expectsResponse: false,
        };
        active.currentPrompt = cancelled;
        this.push?.({ type: 'auth/prompt', prompt: cancelled });
        reject(new Error('prompt-cancelled'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private handleNotify(event: HostAuthEvent): void {
    const active = this.active;
    if (!active) {
      return;
    }
    const payload = eventToPayload(active, randomUUID(), event);
    active.currentPrompt = payload;
    if (payload.kind === 'auth_url') {
      active.authUrl = payload;
    }
    const openUrl =
      payload.kind === 'auth_url'
        ? payload.url
        : payload.kind === 'device_code'
          ? payload.verificationUri
          : undefined;
    if (openUrl && active.openAuthUrlOnHost) {
      console.log(`[piwin-host] auth/prompt ${payload.kind} opening ${openUrl}`);
      this.openAuthUrl?.(openUrl);
    }
    this.push?.({ type: 'auth/prompt', prompt: payload });
  }

  private async relocateChannel(config: PiwinConfig, oldId: string): Promise<string> {
    const newId = allocateRelocateChannelId(
      oldId,
      config.providers.map((provider) => provider.id),
    );
    const renamed = {
      ...config,
      providers: config.providers.map((provider) =>
        provider.id === oldId
          ? { ...provider, id: newId, name: `${provider.name}（API Key）` }
          : provider,
      ),
    };
    const rewritten = rewriteChannelModelRefs(renamed, oldId, newId);
    await this.saveConfig(rewritten);
    await this.relocatePersist?.(oldId, newId);
    return newId;
  }

  private async readAccounts(): Promise<SubscriptionAccount[]> {
    const port = await this.ensurePort();
    let credentials: Awaited<ReturnType<SubscriptionAuthPort['listCredentials']>> = [];
    try {
      credentials = await port.listCredentials();
    } catch (error) {
      throw Object.assign(
        error instanceof Error ? error : new Error('auth-store-unreadable'),
        { code: 'auth-store-unreadable' },
      );
    }
    // Isolated `api_key` copy. Pi lists it, but account state only counted
    // `oauth` — overwrite so the plan card stays logged-in after Host restart.
    if (await hasOauthCredential(this.authPath, CLAUDE_CODE_OAUTH_PROVIDER_ID)) {
      credentials = [
        ...credentials.filter((entry) => entry.providerId !== CLAUDE_CODE_OAUTH_PROVIDER_ID),
        { providerId: CLAUDE_CODE_OAUTH_PROVIDER_ID, type: 'oauth' },
      ];
    }
    const config = await this.loadConfig();
    const extensionProviders = await this.readExtensionProviders();
    return buildSubscriptionAccounts(credentials, config, {
      ...(this.active ? { loggingInProviderId: this.active.providerId } : {}),
      syncErrorProviderIds: this.syncErrorProviderIds,
      needsReauthProviderIds: this.needsReauthProviderIds,
    }, extensionProviders.map((provider) => ({
      providerId: provider.providerId,
      displayName: extensionDisplayName(provider, port),
    })));
  }

  private async readExtensionProviders(): Promise<readonly SubscriptionExtensionProvider[]> {
    this.extensionProviders = await readSubscriptionExtensionProviders(getPiwinRoot(this.piwinRoot));
    return this.extensionProviders;
  }

  private isExtensionProvider(providerId: string): boolean {
    return this.extensionProviders.some((provider) => provider.providerId === providerId);
  }

  /** Built-in Host subscription ids plus ids claimed by enabled extensions. */
  private isKnownProvider(providerId: string): boolean {
    return isSubscriptionOauthProviderId(providerId) || this.isExtensionProvider(providerId);
  }

  private async emitUpdatedIfChanged(): Promise<void> {
    let accounts: SubscriptionAccount[];
    try {
      accounts = await this.readAccounts();
    } catch (error) {
      // Fire-and-forget from the auth.json watcher: an unreadable store must not
      // become an unhandled rejection (shells re-read on `auth/status`).
      console.warn('[piwin-host] auth/updated skipped: account read failed', error);
      return;
    }
    const fingerprint = accounts
      .map((account) => `${account.providerId}:${account.state}:${account.collidingChannelId ?? ''}`)
      .join('|');
    if (fingerprint === this.lastFingerprint) {
      return;
    }
    const previousOauth = this.lastOauthProviderIds;
    const nextOauth = oauthProviderIds(accounts);
    this.lastFingerprint = fingerprint;
    this.lastOauthProviderIds = nextOauth;
    this.emitUpdated(accounts);
    if (this.cancelRuns) {
      for (const providerId of previousOauth) {
        if (!nextOauth.has(providerId)) {
          await this.cancelRuns(providerId);
        }
      }
    }
  }

  private emitUpdated(accounts?: SubscriptionAccount[]): void {
    void this.pushUpdated(accounts);
  }

  /** Never rejects: one failed read must not take the Host down. */
  private async pushUpdated(accounts?: SubscriptionAccount[]): Promise<void> {
    let next: SubscriptionAccount[];
    try {
      next = accounts ?? (await this.readAccounts());
    } catch (error) {
      console.warn('[piwin-host] auth/updated skipped: account read failed', error);
      return;
    }
    this.lastFingerprint = next
      .map((account) => `${account.providerId}:${account.state}:${account.collidingChannelId ?? ''}`)
      .join('|');
    this.lastOauthProviderIds = oauthProviderIds(next);
    this.push?.({ type: 'auth/updated', accounts: next });
  }

  private toActiveLoginStatus(): ActiveLoginStatus {
    const active = this.active;
    if (!active) {
      throw new Error('no active login');
    }
    const status: ActiveLoginStatus = {
      loginId: active.loginId,
      providerId: active.providerId,
      ownerDeviceId: active.ownerDeviceId,
      ownerConnected: this.isOwnerStillConnected(),
      startedAt: active.startedAt,
    };
    if (active.currentPrompt) {
      status.currentPrompt = active.currentPrompt;
    }
    if (active.authUrl) {
      status.authUrl = active.authUrl;
    }
    return status;
  }

  private isOwnerStillConnected(): boolean {
    if (!this.active) {
      return this.ownerConnected;
    }
    if (!this.trackedDeviceConnections) {
      return this.ownerConnected;
    }
    return (this.deviceConnections.get(this.active.ownerDeviceId) ?? 0) > 0;
  }

  private syncOwnerConnected(): void {
    this.ownerConnected = this.isOwnerStillConnected();
  }

  async ensureLoggedInProviders(): Promise<PiwinConfig> {
    await this.ensurePort();
    await this.refreshLiveCatalog();
    const config = await this.projectLoggedInProviders();
    this.extensionProjectionPending = false;
    return config;
  }

  /**
   * User-triggered overlay pull. Throws on network/sync failure so the Settings
   * button can surface it. Boot still uses {@link refreshLiveCatalog} (swallows).
   */
  async pullLiveCatalog(): Promise<{ modelCount: number }> {
    const port = await this.ensurePort();
    await port.refreshLiveCatalog({
      signal: AbortSignal.timeout(LIVE_CATALOG_REFRESH_TIMEOUT_MS),
    });
    await this.projectLoggedInProviders();
    const accounts = await this.readAccounts();
    let modelCount = 0;
    for (const account of accounts) {
      if (account.state !== 'logged-in') continue;
      modelCount += this.catalogModelIds(account.providerId).length;
    }
    return { modelCount };
  }

  private async persistDevinLogoutWebSearch(): Promise<void> {
    if (this.externalConfigStore) {
      const config = await this.loadConfig();
      const next = applyDevinLogoutWebSearch(config);
      if (next !== config) {
        await this.saveConfig(next);
      }
      return;
    }
    await applySubscriptionSettings({
      ...(this.piwinRoot !== undefined ? { piwinRoot: this.piwinRoot } : {}),
      derive: applyDevinLogoutWebSearch,
      ...(this.push ? { push: this.push } : {}),
      ...(this.onSettingsApplied ? { onApplied: this.onSettingsApplied } : {}),
    });
  }

  private async projectLoggedInProviders(): Promise<PiwinConfig> {
    const accounts = await this.readAccounts();
    const derive = (config: PiwinConfig): PiwinConfig =>
      ensureSubscriptionProviders(config, accounts, (providerId) => this.chatCatalogFor(providerId));
    if (this.externalConfigStore) {
      const config = await this.loadConfig();
      const next = derive(config);
      if (next !== config) {
        await this.saveConfig(next);
      }
      return next;
    }
    const result = await applySubscriptionSettings({
      ...(this.piwinRoot !== undefined ? { piwinRoot: this.piwinRoot } : {}),
      derive,
      ...(this.push ? { push: this.push } : {}),
      ...(this.onSettingsApplied ? { onApplied: this.onSettingsApplied } : {}),
    });
    return result?.snapshot.config ?? (await this.loadConfig());
  }


  /**
   * Claude extra (`anthropic`) and extension-path (`anthropic-claude-code`) are
   * mutually exclusive: logging into one signs the other out.
   */
  private async evictSiblingClaudeAuth(providerId: string): Promise<void> {
    if (providerId !== 'anthropic' && !isClaudeCodeOauthProviderId(providerId)) {
      return;
    }
    const siblingId =
      providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID ? 'anthropic' : CLAUDE_CODE_OAUTH_PROVIDER_ID;
    try {
      if (isClaudeCodeOauthProviderId(siblingId)) {
        await deleteOauthCredential(this.authPath, CLAUDE_CODE_OAUTH_PROVIDER_ID);
      } else {
        try {
          const port = await this.ensurePort();
          await port.logout(siblingId);
        } catch {
          // already logged out
        }
        await deleteOauthCredential(this.authPath, siblingId);
      }
    } catch {
      // ignore sibling eviction failures
    }
    this.syncErrorProviderIds.delete(siblingId);
    this.needsReauthProviderIds.delete(siblingId);
    try {
      const config = await this.loadConfig();
      const nextProviders = config.providers.filter((provider) => provider.id !== siblingId);
      if (nextProviders.length !== config.providers.length) {
        await this.saveConfig({ ...config, providers: nextProviders });
      }
    } catch {
      // ignore
    }
  }

  private async ensureProviderForAccount(providerId: string): Promise<Pick<AuthLoginFinishedData, 'followUp'>> {
    if (!this.isKnownProvider(providerId)) {
      return {};
    }
    const port = await this.ensurePort();
    const config = await this.loadConfig();
    const extension = this.extensionProviders.find((provider) => provider.providerId === providerId);
    const upserted = upsertSubscriptionProvider(
      config,
      providerId,
      this.chatCatalogFor(providerId),
      extension ? extensionDisplayName(extension, port) : undefined,
    );
    const { config: next, followUp } = applySubscriptionLoginDefaults(upserted, providerId);
    if (next !== config) {
      await this.saveConfig(next);
    }
    return followUp ? { followUp } : {};
  }

  private async maybeSeedDefault(providerId: string): Promise<void> {
    const config = await this.loadConfig();
    const accounts = await this.readAccounts();
    const catalogModelIds = new Map<string, readonly string[]>([
      [providerId, this.catalogModelIds(providerId)],
    ]);
    if (resolveConfiguredDefaultModelRef(config, { accounts, catalogModelIds })) {
      return;
    }
    const modelId = this.catalogModelIds(providerId)[0];
    if (!modelId) {
      return;
    }
    await this.saveConfig({
      ...config,
      defaultProviderId: providerId,
      defaultModelId: modelId,
    });
  }

  private async ensurePort(): Promise<SubscriptionAuthPort> {
    if (!this.active && this.reloadPortOnExtensions && this.port) {
      const sources = await this.readExtensionProviders();
      const fingerprint = sources.map((source) => source.entryPath).join('|');
      if (fingerprint !== this.portExtensionFingerprint) {
        this.port.dispose();
        this.port = undefined;
        this.portExtensionFingerprint = fingerprint;
        this.extensionProjectionPending = true;
      }
    }
    if (!this.port) {
      if (this.reloadPortOnExtensions && this.portExtensionFingerprint === undefined) {
        const sources = await this.readExtensionProviders();
        this.portExtensionFingerprint = sources.map((source) => source.entryPath).join('|');
        this.extensionProjectionPending = sources.length > 0;
      }
      this.port = await this.portFactory();
      this.startWatch();
    }
    return this.port;
  }
}

/** Manifest name, then the extension's own Pi registration name, then the id. */
function extensionDisplayName(
  provider: SubscriptionExtensionProvider,
  port: Pick<SubscriptionAuthPort, 'getProviderName'>,
): string {
  return provider.displayName ?? port.getProviderName?.(provider.providerId) ?? provider.providerId;
}

export { LIVE_ACCOUNT_STATES };
