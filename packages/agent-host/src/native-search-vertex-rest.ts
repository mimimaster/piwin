/**
 * Direct non-streaming Vertex AI `generateContent` call for native search
 * (Google Search grounding). Pi's Vertex adapter rejects a custom `fetch` and
 * drops grounding metadata, so grounding cannot be observed through Pi; the
 * response shape matches the Gemini API, so `parseGeminiEvidence` reads it.
 *
 * Auth mirrors the chat transport: a Vertex API key (express mode) when the
 * row has one, otherwise Google ADC (gcloud login, service-account JSON or
 * `GOOGLE_APPLICATION_CREDENTIALS`) with the row's project as quota project.
 */
import { DEFAULT_VERTEX_LOCATION } from '@piwin/contracts';
import type { FetchLike } from './native-search-tee.js';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const VERTEX_API_VERSION = 'v1';

export class VertexRestSearchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VertexRestSearchError';
  }
}

export type VertexRestSearchRequest = {
  /** Blank = the official endpoint for `location`. */
  baseUrl?: string;
  /** Vertex API key (express mode); omitted = ADC. */
  apiKey?: string;
  project?: string;
  location?: string;
  credentialsFile?: string;
  modelId: string;
  headers?: Readonly<Record<string, string>>;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
};

/** Resolves an OAuth access token from ADC; a seam so tests never touch gcloud. */
export type VertexAccessTokenProvider = (input: {
  credentialsFile?: string;
}) => Promise<string>;

/** Returns the raw response body for `parseGeminiEvidence`. */
export async function completeVertexRestSearch(
  request: VertexRestSearchRequest,
  fetchImpl: FetchLike = globalThis.fetch,
  resolveAccessToken: VertexAccessTokenProvider = resolveAdcAccessToken,
): Promise<string> {
  const apiKey = request.apiKey?.trim();
  // Same fallback the chat transport uses when the row leaves the project blank.
  const project =
    request.project?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim() || process.env.GCLOUD_PROJECT?.trim();
  const location = request.location?.trim() || DEFAULT_VERTEX_LOCATION;
  if (!apiKey && !project) {
    throw new VertexRestSearchError('Vertex AI native search requires a project (or a Vertex API key)');
  }
  const authHeaders: Record<string, string> = apiKey
    ? { 'x-goog-api-key': apiKey }
    : {
        authorization: `Bearer ${await resolveAccessToken(
          request.credentialsFile?.trim() ? { credentialsFile: request.credentialsFile.trim() } : {},
        )}`,
        // ADC user credentials bill/quota against this project.
        ...(project ? { 'x-goog-user-project': project } : {}),
      };
  const endpoint = buildVertexGenerateContentUrl({
    ...(request.baseUrl ? { baseUrl: request.baseUrl } : {}),
    // Express mode addresses the publisher model without a project path.
    ...(apiKey ? {} : { project }),
    location,
    modelId: request.modelId,
  });
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...request.headers, ...authHeaders },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { maxOutputTokens: request.maxOutputTokens },
    }),
    ...(request.signal ? { signal: request.signal } : {}),
  });
  const body = await response.text();
  if (!response.ok) {
    // The body may echo request details; surface the status only.
    throw new VertexRestSearchError(`Vertex AI native search HTTP ${response.status}`);
  }
  return body;
}

/** `…/v1/[projects/{p}/locations/{l}/]publishers/google/models/{id}:generateContent`. */
export function buildVertexGenerateContentUrl(input: {
  baseUrl?: string;
  project?: string | undefined;
  location: string;
  modelId: string;
}): string {
  const configured = input.baseUrl?.trim().replace(/\/+$/u, '');
  // Pi's `{location}` template means "no custom endpoint".
  const custom = configured && !configured.includes('{location}') ? configured : undefined;
  if (custom && !/^https?:\/\//iu.test(custom)) {
    throw new VertexRestSearchError('Vertex AI native search requires an http(s) base URL');
  }
  const host =
    input.location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${input.location}-aiplatform.googleapis.com`;
  const root = custom ?? host;
  const versioned = /\/v\d+(?:beta\d*)?$/u.test(root) ? root : `${root}/${VERTEX_API_VERSION}`;
  const scope = input.project
    ? `/projects/${encodeURIComponent(input.project)}/locations/${encodeURIComponent(input.location)}`
    : '';
  // Accept a bare id, `models/x` or a full `publishers/…/models/x` resource.
  const model = input.modelId.replace(/^models\//u, '');
  const resource = model.startsWith('publishers/')
    ? model
    : `publishers/google/models/${encodeURIComponent(model)}`;
  return `${versioned}${scope}/${resource}:generateContent`;
}

async function resolveAdcAccessToken(input: { credentialsFile?: string }): Promise<string> {
  try {
    // Lazy: only Vertex search needs it, and Pi already ships it for chat.
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      scopes: [CLOUD_PLATFORM_SCOPE],
      ...(input.credentialsFile ? { keyFilename: input.credentialsFile } : {}),
    });
    const token = await auth.getAccessToken();
    if (!token) throw new Error('empty access token');
    return token;
  } catch (error) {
    throw new VertexRestSearchError(
      'Vertex AI native search could not obtain Google credentials (run `gcloud auth application-default login` or set a service-account file)',
      { cause: error },
    );
  }
}
