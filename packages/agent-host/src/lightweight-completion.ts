import type { ModelProviderConfig } from '@piwin/contracts';

/** Max chars for an LLM-generated session title. */
const MAX_TITLE_CHARS = 80;

const TITLE_SYSTEM_PROMPT =
  'Generate a concise, descriptive title (3-7 words) for this coding session from the user message and optional assistant reply. Return ONLY the title text, no quotes, no markdown, no trailing punctuation.';

export async function generateTitleViaProvider(input: {
  provider: ModelProviderConfig;
  modelId: string;
  apiKey: string;
  systemPrompt?: string;
  userPrompt: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { provider, modelId, apiKey, userPrompt, signal } = input;
  const systemPrompt = input.systemPrompt ?? TITLE_SYSTEM_PROMPT;
  try {
    if (provider.protocol === 'openai-compatible') {
      return await fetchOpenAiCompatible(provider, modelId, apiKey, systemPrompt, userPrompt, signal);
    }
    if (provider.protocol === 'anthropic-compatible') {
      return await fetchAnthropicCompatible(provider, modelId, apiKey, systemPrompt, userPrompt, signal);
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchOpenAiCompatible(
  provider: Extract<ModelProviderConfig, { protocol: 'openai-compatible' }>,
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...provider.headers,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers,
    ...(signal ? { signal } : {}),
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 50,
      temperature: 0.3,
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return cleanTitle(data.choices?.[0]?.message?.content);
}

async function fetchAnthropicCompatible(
  provider: Extract<ModelProviderConfig, { protocol: 'anthropic-compatible' }>,
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${provider.baseUrl.replace(/\/$/, '')}/messages`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    ...provider.headers,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers,
    ...(signal ? { signal } : {}),
    body: JSON.stringify({
      model: modelId,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 50,
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  return cleanTitle(data.content?.find((b) => b.type === 'text')?.text);
}

function cleanTitle(raw: string | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let title = raw.trim();
  const jsonMatch = title.match(/\{[^}]*"title"\s*:\s*"([^"]+)"/);
  if (jsonMatch) title = jsonMatch[1] ?? '';
  title = title.replace(/^["'`]+|["'`]+$/g, '');
  title = title.replace(/^(#{1,6}\s+)?/, '');
  title = title.replace(/\*\*(.+?)\*\*/g, '$1');
  title = title.replace(/[.!?]+$/, '');
  title = title.replace(/\s+/g, ' ').trim();
  if (title.length === 0) return null;
  if (title.length > MAX_TITLE_CHARS) title = `${title.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
  return title;
}
