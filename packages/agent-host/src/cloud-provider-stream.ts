/**
 * Google Vertex AI / Amazon Bedrock wiring (protocols `google-vertex`,
 * `amazon-bedrock`). Transport, auth chains and token refresh are Pi's own
 * (`google-vertex` via @google/genai + google-auth-library ADC,
 * `bedrock-converse-stream` via the AWS SDK default credential chain); this
 * module only turns a product provider row into Pi stream options.
 */
import { DEFAULT_BEDROCK_REGION, DEFAULT_VERTEX_LOCATION } from '@piwin/contracts';
import type { NativeSearchStreamSimple } from './native-web-search.js';

export type CloudStreamOptions = {
  /** Explicit key (Vertex express-mode key or Bedrock API key) — undefined = credential chain. */
  apiKey?: string;
  bearerToken?: string;
  project?: string;
  location?: string;
  region?: string;
  profile?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  /** Vertex: rewrite budget-style thinking for models that only accept levels. */
  vertexThinkingLevels?: boolean;
};

/**
 * Pi only sends a request for a provider it considers configured, i.e. one
 * with an API key. A keyless cloud row authenticates through ADC / the AWS
 * chain instead, so register Pi's own "ambient credentials" marker; the
 * stream wrapper below drops it before the request, so it is never sent.
 */
export const CLOUD_CREDENTIAL_CHAIN_API_KEY = '<authenticated>';

/** Gemini 1.x / 2.x take `thinkingBudget`; newer families take `thinkingLevel`. */
const GEMINI_BUDGET_MODEL = /(?:^|\/)gemini-(?:1|2)(?:\.|-)/u;

/**
 * Pi 0.84 only knows Gemini 2.x (budget) and 3.x (level) by id. A newer
 * model (e.g. `gemini-4-argon`) would get `thinkingBudget` and Vertex rejects
 * it ("Use thinking level instead"), so map the budget onto a level.
 */
export function rewriteVertexThinkingPayload(
  payload: unknown,
  modelId: string,
  reasoning: unknown,
): unknown {
  if (GEMINI_BUDGET_MODEL.test(modelId.toLowerCase())) return payload;
  const params = payload as { config?: { thinkingConfig?: Record<string, unknown> } } | undefined;
  const thinking = params?.config?.thinkingConfig;
  if (!thinking || thinking.thinkingBudget === undefined || thinking.thinkingLevel !== undefined) {
    return payload;
  }
  const { thinkingBudget, ...rest } = thinking;
  const config = { ...params.config };
  if (thinkingBudget === 0 || !reasoning || reasoning === 'off') {
    // "Thinking off": let the model use its default instead of an invalid budget.
    delete config.thinkingConfig;
  } else {
    const level = reasoning === 'minimal' || reasoning === 'low' ? 'LOW' : 'HIGH';
    config.thinkingConfig = { ...rest, thinkingLevel: level };
  }
  return { ...params, config };
}

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

/** Cloud-only provider fields (config row or worker envelope `cloud`). */
export type CloudProviderFields = {
  protocol?: string;
  project?: string;
  location?: string;
  credentialsFile?: string;
  region?: string;
  profile?: string;
};

/** Pick the cloud fields off a provider row for the worker envelope. */
export function pickCloudProviderFields(
  provider: CloudProviderFields,
): Omit<CloudProviderFields, 'protocol'> | undefined {
  if (provider.protocol !== 'google-vertex' && provider.protocol !== 'amazon-bedrock') {
    return undefined;
  }
  const out: Omit<CloudProviderFields, 'protocol'> = {};
  for (const key of ['project', 'location', 'credentialsFile', 'region', 'profile'] as const) {
    const value = trimmed(provider[key]);
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Pi refuses to register a custom model without a `baseUrl`, but a cloud row
 * leaves it blank to mean "the platform's own endpoint". Hand Pi the same
 * defaults its built-in catalog uses: the Vertex `{location}` template (which
 * its adapter treats as "no custom endpoint") and the standard regional
 * Bedrock runtime host (which it only pins when no region/profile is set).
 * A filled-in base URL (VPC endpoint, proxy) always wins.
 */
export function resolveCloudBaseUrl(
  provider: CloudProviderFields & { baseUrl?: string | undefined },
): string {
  const configured = trimmed(provider.baseUrl);
  if (configured) return configured;
  if (provider.protocol === 'google-vertex') {
    return 'https://{location}-aiplatform.googleapis.com';
  }
  if (provider.protocol === 'amazon-bedrock') {
    return `https://bedrock-runtime.${trimmed(provider.region) ?? DEFAULT_BEDROCK_REGION}.amazonaws.com`;
  }
  return '';
}

/** Pi stream options for a cloud provider row, or undefined for HTTP-key protocols. */
export function resolveCloudStreamOptions(
  provider: CloudProviderFields,
  apiKey?: string,
): CloudStreamOptions | undefined {
  const key = trimmed(apiKey);
  if (provider.protocol === 'google-vertex') {
    const project = trimmed(provider.project);
    const location = trimmed(provider.location) ?? DEFAULT_VERTEX_LOCATION;
    const credentialsFile = trimmed(provider.credentialsFile);
    const env: Record<string, string> = { GOOGLE_CLOUD_LOCATION: location };
    if (project) env.GOOGLE_CLOUD_PROJECT = project;
    if (credentialsFile) env.GOOGLE_APPLICATION_CREDENTIALS = credentialsFile;
    return {
      ...(key ? { apiKey: key } : {}),
      ...(project ? { project } : {}),
      location,
      env,
      // ADC user credentials bill/quota against this project (x-goog-user-project).
      ...(project && !key ? { headers: { 'x-goog-user-project': project } } : {}),
      vertexThinkingLevels: true,
    };
  }
  if (provider.protocol === 'amazon-bedrock') {
    const region = trimmed(provider.region);
    const profile = trimmed(provider.profile);
    const env: Record<string, string> = {};
    if (region) env.AWS_REGION = region;
    if (profile) env.AWS_PROFILE = profile;
    return {
      ...(key ? { apiKey: key, bearerToken: key } : {}),
      ...(region ? { region } : {}),
      ...(profile ? { profile } : {}),
      env,
    };
  }
  return undefined;
}

/**
 * Inject cloud options into every request. The configured key (or its
 * absence) always wins over whatever Pi resolved, so a placeholder such as
 * `<authenticated>` never reaches Bedrock as a bearer token.
 */
export function wrapStreamSimpleWithCloudOptions(
  stream: NativeSearchStreamSimple,
  cloud: CloudStreamOptions,
): NativeSearchStreamSimple {
  return (model, context, options) => {
    const base = (options ?? {}) as Record<string, unknown>;
    const { apiKey: _ignored, bearerToken: _ignoredBearer, ...rest } = base;
    const baseEnv = (rest.env as Record<string, string> | undefined) ?? {};
    const baseHeaders = (rest.headers as Record<string, string> | undefined) ?? {};
    const next: Record<string, unknown> = {
      ...rest,
      ...(cloud.apiKey ? { apiKey: cloud.apiKey } : {}),
      ...(cloud.bearerToken ? { bearerToken: cloud.bearerToken } : {}),
      ...(cloud.project ? { project: cloud.project } : {}),
      ...(cloud.location ? { location: cloud.location } : {}),
      ...(cloud.region ? { region: cloud.region } : {}),
      ...(cloud.profile ? { profile: cloud.profile } : {}),
      env: { ...baseEnv, ...cloud.env },
    };
    if (cloud.headers || rest.headers) {
      next.headers = { ...baseHeaders, ...cloud.headers };
    }
    if (cloud.vertexThinkingLevels) {
      const previous = rest.onPayload as
        | ((payload: unknown, model: unknown) => unknown | Promise<unknown>)
        | undefined;
      const modelId = typeof model?.id === 'string' ? model.id : '';
      next.onPayload = async (payload: unknown, piModel: unknown) => {
        const chained = previous ? ((await previous(payload, piModel)) ?? payload) : payload;
        return rewriteVertexThinkingPayload(chained, modelId, rest.reasoning);
      };
    }
    return stream(model, context, next as Parameters<NativeSearchStreamSimple>[2]);
  };
}
