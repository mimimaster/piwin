import type {
  ClientToolRequestDisplay,
  ModelRef,
  PiwinConfig,
  PromptContextRef,
} from '@piwin/contracts';

export function isExplicitAppleHealthTurn(
  refs: readonly PromptContextRef[] | undefined,
): boolean {
  return (
    refs?.some(
      (ref) => ref.kind === 'connected-source' && ref.source === 'apple-health',
    ) === true
  );
}

export function healthProviderDisclosure(
  model: ModelRef | undefined,
  config: PiwinConfig | undefined,
): ClientToolRequestDisplay['provider'] | undefined {
  if (model === undefined) {
    return undefined;
  }
  const provider = config?.providers?.find((item) => item.id === model.providerId);
  const baseUrl = provider && 'baseUrl' in provider ? provider.baseUrl : undefined;
  const processing: 'local' | 'external' =
    isLoopbackUrl(baseUrl) || isLocalHealthProviderId(model.providerId) || isLocalHealthProviderId(provider?.id)
      ? 'local'
      : 'external';
  const label =
    provider && typeof provider.name === 'string' && provider.name.trim().length > 0
      ? provider.name.trim()
      : model.providerId;
  return {
    id: model.providerId,
    label,
    processing,
  };
}

function isLocalHealthProviderId(id: string | undefined): boolean {
  return id === 'ollama' || id === 'lmstudio';
}

function isLoopbackUrl(value: string | undefined): boolean {
  if (value === undefined || value.length === 0) {
    return false;
  }
  try {
    const host = new URL(value).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}
