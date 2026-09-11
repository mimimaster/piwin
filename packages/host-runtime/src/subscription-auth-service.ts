import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { dirname } from 'node:path';
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
  AUTH_UPDATED_DEBOUNCE_MS,
  allocateRelocateChannelId,
  isModelEnabled,
  isProviderEnabled,
  isV1SubscriptionProviderId,
} from '@piwin/contracts';
import {
  createSubscriptionAuthPort,
  defaultPiAuthPaths,
  LIVE_CATALOG_REFRESH_TIMEOUT_MS,
  type HostAuthEvent,
  type HostAuthPrompt,
  type SubscriptionAuthPort,
} from '@piwin/agent-host';
import { applySubscriptionSettings } from './apply-subscription-settings.js';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinRoot, resolveHostPiAgentDir } from './paths.js';
import { rewriteChannelModelRefs } from './rewrite-channel-model-refs.js';
import { buildSubscriptionAccounts } from './subscription-account-status.js';
import { isSubscriptionAccountUsable } from './resolve-chat-model.js';
import {
  ensureSubscriptionProviders,
  overlayCatalogLimits,
  upsertSubscriptionProvider,
} from './seed-subscription-provider.js';
import { resolveConfiguredDefaultModelRef } from './provider-helpers.js';
import { selectSubscriptionLoginMethod } from './select-subscription-login-method.js';
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
  abort: AbortController;
  currentPrompt?: AuthPromptPayload;
  authUrl?: AuthPromptPayload;
  pending?: PendingPrompt;
  newChannelId?: string;
};

const LIVE_ACCOUNT_STATES = new Set(['logged-in', 'logging-in', 'sync-error', 'needs-reauth']);

export class SubscriptionAuthService {
  private port: SubscriptionAuthPort | undefined;
  private readonly portFactory: () => Promise<SubscriptionAuthPort>;
  private readonly loadConfig: () => Promise<PiwinConfig>;
  private readonly saveConfig: (config: PiwinConfig) => Promise<void>;
  private readonly piwinRoot: string | undefined;
  private readonly authPath: string;
  private readonly now: () => number;
  private readonly openAuthUrl: ((url: string) => void) | undefined;
  private push: ((message: HostPush) => void) | undefined;
  private onSettingsApplied: ((result: SettingsApplyResult) => void) | undefined;
  private cancelRuns: ((providerId: string) => Promise<void>) | undefined;
  private relocatePersist: ((fromProviderId: string, toProviderId: string) => Promise<void>) | undefined;
  private active: ActiveLogin | undefined;
  private watcher: FSWatcher | undefined;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private watchRetry: ReturnType<typeof setTimeout> | undefined;
  private watchingParent = false;
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
    this.now = options.now ?? Date.now;
    this.openAuthUrl = options.openAuthUrl;
    this.loadConfig =
      deps.loadConfig ?? (() => loadPiwinConfig(getPiwinRoot(options.piwinRoot)));
    this.saveConfig =
      deps.applySettings ??
      deps.saveConfig ??
      (async (config) => {
        await applySubscriptionSettings({
          ...(options.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : {}),
          next: config,
          ...(this.push ? { push: this.push } : {}),
          ...(this.onSettingsApplied ? { onApplied: this.onSettingsApplied } : {}),
        });
      });
    this.piwinRoot = options.piwinRoot;
    this.port = options.port;
    this.portFactory =
      deps.createPort ??
      (async () =>
        options.port ??
        createSubscriptionAuthPort({
          authPath: paths.authPath,
          modelsPath: paths.modelsPath,
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
    if (!isV1SubscriptionProviderId(providerId)) {
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
    const accounts = await this.readAccounts();
    this.lastOauthProviderIds = oauthProviderIds(accounts);
    const catalogModelIds = new Map<string, readonly string[]>();
    for (const account of accounts) {
      if (!isSubscriptionAccountUsable(account)) {
        continue;
      }
      catalogModelIds.set(account.providerId, this.catalogModelIds(account.providerId));
    }
    return { accounts, catalogModelIds };
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
    const accounts = await this.readAccounts();
    const data: AuthStatusData = { accounts };
    if (this.active) {
      data.activeLogin = this.toActiveLoginStatus();
    }
    return data;
  }

  async login(input: AuthLoginInput): Promise<{ loginId: string } | { error: string; code: string }> {
    if (!isV1SubscriptionProviderId(input.providerId)) {
      return {
        error: `Unsupported subscription provider: ${input.providerId}`,
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
    const colliding = config.providers.find((provider) => provider.id === input.providerId);
    let newChannelId: string | undefined;
    if (colliding) {
      if (input.relocateChannelId !== colliding.id) {
        return {
          error: `Channel id "${input.providerId}" collides with a subscription account.`,
          code: 'collision',
        };
      }
      newChannelId = await this.relocateChannel(config, colliding.id);
    }

    const loginId = randomUUID();
    const abort = new AbortController();
    this.active = {
      loginId,
      providerId: input.providerId,
      ownerDeviceId: input.ownerDeviceId,
      startedAt: new Date(this.now()).toISOString(),
      preferLoopback: input.preferLoopback === true,
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
    if (!isV1SubscriptionProviderId(providerId)) {
      return {
        error: `Unsupported subscription provider: ${providerId}`,
        code: 'unsupported-subscription-provider',
      };
    }
    const cancel = cancelRuns ?? this.cancelRuns;
    if (cancel) {
      await cancel(providerId);
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
    await this.ensureLoggedInProviders();
    this.emitUpdated();
    return {};
  }

  /**
   * Overlay Pi catalog metadata onto the secret-free picker list.
   * Do not resurrect providers/models the user disabled on the Models page:
   * `projectConfiguredChatModels` already dropped them, and putting them back
   * made Composer keep showing subscription rows after the toggle was turned off.
   */
  async mergeConfiguredModels(channelModels: {
    defaultProviderId?: string;
    defaultModelId?: string;
    models: Array<Record<string, unknown>>;
  }): Promise<{
    defaultProviderId?: string;
    defaultModelId?: string;
    models: Array<Record<string, unknown>>;
  }> {
    const port = await this.ensurePort();
    const accounts = await this.readAccounts();
    const config = await this.loadConfig();
    const providerById = new Map(
      config.providers.map((provider) => [provider.id, provider] as const),
    );
    const models = [...channelModels.models];
    const existing = new Set(models.map((model) => `${model.providerId}::${model.modelId}`));
    for (const account of accounts) {
      if (account.surface !== 'v1' || account.collidingChannelId) {
        continue;
      }
      if (account.state !== 'logged-in' && account.state !== 'sync-error') {
        continue;
      }
      const provider = providerById.get(account.providerId);
      if (provider !== undefined && !isProviderEnabled(provider)) {
        continue;
      }
      for (const model of port.getChatCatalog(account.providerId)) {
        const configuredModel = provider?.models.find((entry) => entry.id === model.id);
        if (configuredModel !== undefined && !isModelEnabled(configuredModel)) {
          continue;
        }
        const key = `${account.providerId}::${model.id}`;
        if (existing.has(key)) {
          const current = models.find(
            (entry) => `${entry.providerId}::${entry.modelId}` === key,
          );
          if (current) {
            overlayCatalogLimits(current, model);
            if (!current['input'] && Array.isArray(model.input) && model.input.length > 0) {
              current['input'] = [...model.input];
            }
            if (current['reasoning'] === undefined && typeof model.reasoning === 'boolean') {
              current['reasoning'] = model.reasoning;
            }
            if (Array.isArray(model.thinkingLevels) && model.thinkingLevels.length > 0) {
              current['thinkingLevels'] = model.thinkingLevels;
            }
          }
          continue;
        }
        existing.add(key);
        const next: Record<string, unknown> = {
          providerId: account.providerId,
          modelId: model.id,
          label: model.name,
          source: 'subscription',
          group: 'subscription',
        };
        if (model.reasoning !== undefined) {
          next.reasoning = model.reasoning;
        }
        if (model.thinkingLevels) {
          next.thinkingLevels = model.thinkingLevels;
        }
        if (Array.isArray(model.input) && model.input.length > 0) {
          next.input = [...model.input];
        }
        overlayCatalogLimits(next, model);
        models.push(next);
      }
    }
    return { ...channelModels, models };
  }

  startWatch(): void {
    if (this.watcher && !this.watchingParent) {
      return;
    }
    const onChange = (): void => {
      if (this.watchTimer) {
        clearTimeout(this.watchTimer);
      }
      this.watchTimer = setTimeout(() => {
        void this.emitUpdatedIfChanged();
        if (this.watchingParent) {
          this.startWatch();
        }
      }, AUTH_UPDATED_DEBOUNCE_MS);
    };
    const authDir = dirname(this.authPath);
    try {
      const next = watch(authDir, onChange);
      this.watcher?.close();
      this.watcher = next;
      this.watchingParent = false;
      return;
    } catch {
      // `{PIWIN_ROOT}/pi-agent` may not exist until the first login.
    }
    if (this.watcher) {
      return;
    }
    try {
      this.watcher = watch(dirname(authDir), onChange);
      this.watchingParent = true;
      return;
    } catch {
      this.watchRetry = setTimeout(() => {
        this.watchRetry = undefined;
        this.startWatch();
      }, 2_000);
      this.watchRetry.unref?.();
    }
  }

  dispose(): void {
    if (this.active) {
      this.active.abort.abort();
      this.active.pending?.reject(new Error('login-cancelled'));
      this.active = undefined;
    }
    this.watcher?.close();
    this.watcher = undefined;
    this.watchingParent = false;
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = undefined;
    }
    if (this.watchRetry) {
      clearTimeout(this.watchRetry);
      this.watchRetry = undefined;
    }
  }

  catalogModelIds(providerId: string): string[] {
    return this.port?.getChatCatalog(providerId).map((model) => model.id) ?? [];
  }

  private async runLogin(providerId: string, signal: AbortSignal): Promise<void> {
    const loginId = this.active?.loginId;
    if (!loginId) {
      return;
    }
    const port = await this.ensurePort();
    const outcome = await port.login(providerId, {
      signal,
      prompt: (prompt) => this.handlePrompt(prompt),
      notify: (event) => this.handleNotify(event),
    });
    const finished: AuthLoginFinishedData = {
      loginId,
      providerId,
      ok: outcome.kind !== 'failed',
      ...(outcome.kind === 'failed' && outcome.code ? { errorCode: outcome.code } : {}),
      ...(outcome.kind === 'failed' ? { errorCode: outcome.code ?? 'provider-authentication' } : {}),
      ...(this.active?.newChannelId !== undefined ? { newChannelId: this.active.newChannelId } : {}),
    };
    if (outcome.kind === 'sync-error') {
      this.syncErrorProviderIds.add(providerId);
    } else if (outcome.kind === 'ok') {
      this.syncErrorProviderIds.delete(providerId);
      this.needsReauthProviderIds.delete(providerId);
      try {
        await port.refreshProvider(providerId);
      } catch {
        this.syncErrorProviderIds.add(providerId);
      }
      await this.ensureProviderForAccount(providerId);
      await this.maybeSeedDefault(providerId);
      this.startWatch();
    }
    this.active = undefined;
    this.push?.({ type: 'auth/login-finished', result: finished });
    this.emitUpdated();
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
    if (openUrl) {
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
    const config = await this.loadConfig();
    return buildSubscriptionAccounts(credentials, config, {
      ...(this.active ? { loggingInProviderId: this.active.providerId } : {}),
      syncErrorProviderIds: this.syncErrorProviderIds,
      needsReauthProviderIds: this.needsReauthProviderIds,
    });
  }

  private async emitUpdatedIfChanged(): Promise<void> {
    const accounts = await this.readAccounts();
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
    void (async () => {
      const next = accounts ?? (await this.readAccounts());
      this.lastFingerprint = next
        .map((account) => `${account.providerId}:${account.state}:${account.collidingChannelId ?? ''}`)
        .join('|');
      this.lastOauthProviderIds = oauthProviderIds(next);
      this.push?.({ type: 'auth/updated', accounts: next });
    })();
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
    const port = await this.ensurePort();
    await this.refreshLiveCatalog();
    const accounts = await this.readAccounts();
    const config = await this.loadConfig();
    const next = ensureSubscriptionProviders(config, accounts, (providerId) =>
      port.getChatCatalog(providerId),
    );
    if (next !== config) {
      await this.saveConfig(next);
    }
    return next;
  }

  private async ensureProviderForAccount(providerId: string): Promise<void> {
    if (!isV1SubscriptionProviderId(providerId)) {
      return;
    }
    const port = await this.ensurePort();
    const config = await this.loadConfig();
    const next = upsertSubscriptionProvider(config, providerId, port.getChatCatalog(providerId));
    if (next !== config) {
      await this.saveConfig(next);
    }
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
    if (!this.port) {
      this.port = await this.portFactory();
      this.startWatch();
    }
    return this.port;
  }
}

function promptToPayload(
  active: ActiveLogin,
  promptId: string,
  prompt: HostAuthPrompt,
): AuthPromptPayload {
  return {
    loginId: active.loginId,
    promptId,
    providerId: active.providerId,
    kind: prompt.type,
    message: prompt.message,
    expectsResponse: true,
    ...(prompt.placeholder !== undefined ? { placeholder: prompt.placeholder } : {}),
    ...(prompt.options !== undefined ? { options: prompt.options } : {}),
  };
}

function eventToPayload(
  active: ActiveLogin,
  promptId: string,
  event: HostAuthEvent,
): AuthPromptPayload {
  const base = {
    loginId: active.loginId,
    promptId,
    providerId: active.providerId,
    kind: event.type,
    expectsResponse: false as const,
  };
  switch (event.type) {
    case 'auth_url':
      return {
        ...base,
        url: event.url,
        ...(event.instructions !== undefined ? { instructions: event.instructions } : {}),
      };
    case 'device_code':
      return {
        ...base,
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds !== undefined ? { intervalSeconds: event.intervalSeconds } : {}),
        ...(event.expiresInSeconds !== undefined
          ? { expiresInSeconds: event.expiresInSeconds }
          : {}),
      };
    case 'progress':
    case 'info':
      return {
        ...base,
        message: event.message,
        ...(event.type === 'info' && event.links !== undefined ? { links: event.links } : {}),
      };
  }
}

function oauthProviderIds(accounts: readonly SubscriptionAccount[]): Set<string> {
  return new Set(
    accounts.filter((account) => isSubscriptionAccountUsable(account)).map((account) => account.providerId),
  );
}

export { LIVE_ACCOUNT_STATES };
