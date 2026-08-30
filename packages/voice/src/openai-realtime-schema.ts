import {
  isLikelyRealtimeAudioModel,
  validateLiveApplyValues,
  validateLiveSettingFields,
  type LiveSettingField,
} from '@piwin/contracts';

export const OPENAI_REALTIME_LIVE_PROVIDER_ID = 'openai-realtime';
export const OPENAI_REALTIME_MEDIA_DRIVER_ID = 'openai-realtime-ws-v1' as const;

export const OPENAI_REALTIME_ROUTE_NONE = '__none__';
export const OPENAI_REALTIME_DEFAULT_VOICE = 'eve';

export const OPENAI_REALTIME_VOICES = [
  'eve',
  'ara',
  'rex',
  'sal',
  'leo',
  'cove',
] as const;

export type OpenaiRealtimeRoute = {
  /** `${providerId}::${modelId}` */
  routeId: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelLabel: string;
  baseUrl: string;
};

export function encodeOpenaiRealtimeRouteId(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export function parseOpenaiRealtimeRouteId(
  routeId: string,
): { providerId: string; modelId: string } | null {
  const separator = routeId.indexOf('::');
  if (separator <= 0 || separator >= routeId.length - 2) return null;
  return {
    providerId: routeId.slice(0, separator),
    modelId: routeId.slice(separator + 2),
  };
}

/** Tagged realtime-audio, or an OpenAI-protocol realtime / grok-voice id. */
export function modelLooksRealtimeAudio(model: {
  id: string;
  label?: string;
  capabilities?: readonly string[];
}): boolean {
  return isLikelyRealtimeAudioModel(model.id, model.label, model.capabilities);
}

export function openaiRealtimeLiveSettingFields(
  routes: readonly OpenaiRealtimeRoute[],
): LiveSettingField[] {
  const routeOptions =
    routes.length > 0
      ? routes.map((route) => ({
          value: route.routeId,
          label: `${route.providerName} / ${route.modelLabel}`,
        }))
      : [
          {
            value: OPENAI_REALTIME_ROUTE_NONE,
            label: 'Mark a model with realtime audio in Models settings',
          },
        ];
  const fields: LiveSettingField[] = [
    {
      key: 'route',
      control: 'select',
      label: 'Model',
      description:
        'OpenAI-Realtime-compatible models from configured openai-compatible providers.',
      required: true,
      defaultValue: routeOptions[0]?.value ?? OPENAI_REALTIME_ROUTE_NONE,
      options: routeOptions,
    },
    {
      key: 'voice',
      control: 'select',
      label: 'Voice',
      required: true,
      defaultValue: OPENAI_REALTIME_DEFAULT_VOICE,
      options: OPENAI_REALTIME_VOICES.map((voice) => ({ value: voice, label: voice })),
    },
  ];
  const schema = validateLiveSettingFields(fields);
  if (!schema.ok) throw new Error(schema.message);
  return fields;
}

export function validateOpenaiRealtimeLiveSettings(
  values: Readonly<Record<string, string>>,
  routes: readonly OpenaiRealtimeRoute[],
):
  | { ok: true; normalized: Readonly<Record<string, string>>; route: OpenaiRealtimeRoute }
  | { ok: false; field?: string; message: string } {
  const fields = openaiRealtimeLiveSettingFields(routes);
  const applied = validateLiveApplyValues(fields, values);
  if (!applied.ok) return applied;
  const routeId = applied.normalized.route ?? '';
  if (routeId === OPENAI_REALTIME_ROUTE_NONE) {
    return {
      ok: false,
      field: 'route',
      message: 'Configure an openai-compatible model with realtime-audio first',
    };
  }
  const route = routes.find((item) => item.routeId === routeId);
  if (!route) {
    return { ok: false, field: 'route', message: 'invalid route' };
  }
  return { ok: true, normalized: applied.normalized, route };
}

export function httpBaseUrlToRealtimeWs(baseUrl: string, modelId: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('live-provider-unavailable');
  }
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  else throw new Error('live-provider-unavailable');
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = `${path}/realtime`;
  url.search = '';
  url.searchParams.set('model', modelId);
  return url.toString();
}
