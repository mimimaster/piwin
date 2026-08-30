import type {
  LiveApplySettingsInput,
  LiveProviderDescriptor,
  LiveSetProviderKeyInput,
  LiveSettingsView,
  PiwinConfig,
} from '@piwin/contracts';
import { DEFAULT_CODEX_LIVE_VOICE, type LiveProviderRegistry } from '@piwin/voice';

export type LiveChannelSnapshot = {
  revision: number;
  selectedProviderId: string;
  values: Record<string, string>;
  registered: boolean;
  authReady: boolean;
  settingsValid: boolean;
  mediaKind?: import('@piwin/contracts').LiveMediaKind;
  mediaDriverId?: import('@piwin/contracts').LiveMediaDriverId;
};

export type LiveSettingsService = {
  schema(): Promise<LiveSettingsView>;
  snapshot(providerId?: string): Promise<LiveChannelSnapshot>;
  apply(
    input: LiveApplySettingsInput,
  ): Promise<{ ok: true; view: LiveSettingsView } | { ok: false; message: string }>;
  setProviderKey(
    input: LiveSetProviderKeyInput,
  ): Promise<{ ok: true; keyConfigured: boolean } | { ok: false; message: string }>;
  selectedProviderId(): string;
  settingsFor(providerId: string): Record<string, string>;
  revision(): number;
};

export function createLiveSettingsService(deps: {
  registry: LiveProviderRegistry;
  loadConfig: () => Promise<PiwinConfig>;
  saveConfig: (config: PiwinConfig) => Promise<void>;
  keyConfigured: (providerId: string) => Promise<boolean>;
  writeKey: (providerId: string, key: string) => Promise<void>;
  deleteKey: (providerId: string) => Promise<void>;
  endCallIfCurrent: (providerId: string) => Promise<void>;
}): LiveSettingsService {
  let revision = 1;

  async function selectedProviderId(): Promise<string> {
    const config = await deps.loadConfig();
    const providerId = config.speech?.live?.providerId?.trim();
    if (providerId && deps.registry.get(providerId)) return providerId;
    return 'openai-codex';
  }

  function readProviderValues(config: PiwinConfig, providerId: string): Record<string, string> {
    const stored = config.speech?.live?.byProvider?.[providerId];
    if (stored) return { ...stored };
    if (providerId === 'openai-codex' && config.speech?.live?.voice?.trim()) {
      return { voice: config.speech.live.voice.trim() };
    }
    return {};
  }

  async function describe(providerId: string, config: PiwinConfig): Promise<LiveProviderDescriptor> {
    const registration = deps.registry.get(providerId);
    if (!registration) {
      throw new Error(`unknown Live provider ${providerId}`);
    }
    await registration.refresh?.();
    const base = registration.descriptor();
    const stored = readProviderValues(config, providerId);
    const settings = base.settings.map((field) => ({
      ...field,
      defaultValue: stored[field.key] ?? field.defaultValue,
    }));
    if (base.auth.kind === 'subscription-oauth') {
      return {
        ...base,
        settings,
        auth: { ...base.auth, ready: await registration.authReady() },
      };
    }
    return {
      ...base,
      settings,
      auth: {
        ...base.auth,
        keyConfigured: await registration.authReady(),
      },
    };
  }

  async function schema(): Promise<LiveSettingsView> {
    const config = await deps.loadConfig();
    const selected = await selectedProviderId();
    const providers: LiveProviderDescriptor[] = [];
    for (const registration of deps.registry.list()) {
      const id = registration.descriptor().providerId;
      providers.push(await describe(id, config));
    }
    return { revision, selectedProviderId: selected, providers };
  }

  let cachedSelected = 'openai-codex';
  let cachedValues: Record<string, string> = { voice: DEFAULT_CODEX_LIVE_VOICE };

  async function snapshot(providerId?: string): Promise<LiveChannelSnapshot> {
    const config = await deps.loadConfig();
    const selected = providerId ?? (await selectedProviderId());
    cachedSelected = selected;
    const registration = deps.registry.get(selected);
    if (!registration) {
      return {
        revision,
        selectedProviderId: selected,
        values: {},
        registered: false,
        authReady: false,
        settingsValid: false,
      };
    }
    await registration.refresh?.();
    const descriptor = registration.descriptor();
    const stored = readProviderValues(config, selected);
    const validated = registration.validateSettings({
      ...Object.fromEntries(descriptor.settings.map((field) => [field.key, field.defaultValue])),
      ...stored,
    });
    cachedValues = validated.ok ? { ...validated.normalized } : stored;
    const authReady = await registration.authReady();
    return {
      revision,
      selectedProviderId: selected,
      values: cachedValues,
      registered: true,
      authReady,
      settingsValid: validated.ok,
      mediaKind: descriptor.mediaKind,
      mediaDriverId: descriptor.mediaDriverId,
    };
  }

  return {
    async schema() {
      const view = await schema();
      cachedSelected = view.selectedProviderId;
      return view;
    },
    snapshot,
    selectedProviderId() {
      return cachedSelected;
    },
    settingsFor(providerId) {
      if (providerId === cachedSelected) return { ...cachedValues };
      return { voice: DEFAULT_CODEX_LIVE_VOICE };
    },
    revision() {
      return revision;
    },
    async apply(input: LiveApplySettingsInput) {
      if (input.expectedRevision !== revision) {
        return { ok: false, message: 'live-conflict' };
      }
      const registration = deps.registry.get(input.providerId);
      if (!registration) return { ok: false, message: 'live-provider-unavailable' };
      await registration.refresh?.();
      const validated = registration.validateSettings(input.values);
      if (!validated.ok) return { ok: false, message: validated.message };
      const config = await deps.loadConfig();
      const previous = config.speech?.live?.providerId ?? 'openai-codex';
      const previousValues = readProviderValues(config, input.providerId);
      const changed =
        previous !== input.providerId ||
        JSON.stringify(previousValues) !== JSON.stringify(validated.normalized);
      const next: PiwinConfig = {
        ...config,
        speech: {
          ...config.speech,
          live: {
            ...config.speech?.live,
            providerId: input.providerId,
            byProvider: {
              ...config.speech?.live?.byProvider,
              [input.providerId]: { ...validated.normalized },
            },
          },
        },
      };
      await deps.saveConfig(next);
      revision += 1;
      if (changed) await deps.endCallIfCurrent(previous);
      return { ok: true, view: await schema() };
    },
    async setProviderKey(input) {
      const registration = deps.registry.get(input.providerId);
      if (!registration) return { ok: false, message: 'live-provider-unavailable' };
      const descriptor = registration.descriptor();
      if (descriptor.auth.kind !== 'api-key') return { ok: false, message: 'live-provider-unavailable' };
      if (input.operation === 'clear') {
        await deps.deleteKey(input.providerId);
        await deps.endCallIfCurrent(input.providerId);
        return { ok: true, keyConfigured: false };
      }
      const key = input.key?.trim();
      if (!key) return { ok: false, message: 'live-provider-auth' };
      await deps.writeKey(input.providerId, key);
      return { ok: true, keyConfigured: true };
    },
  };
}
