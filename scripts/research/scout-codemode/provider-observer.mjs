import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';

// Transparent forwarding only: never injects answers, tools, or usage. Records
// metadata/usage, not prompts, authorization headers, or full provider payloads.
export async function openProviderObserver(baseUrl, secret) {
  const requests = [];
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const parsed = JSON.parse(body.toString('utf8'));
      const request = { index: requests.length + 1, model: parsed.model,
        reasoningEffort: parsed.reasoning_effort ?? null, startedAt: new Date().toISOString(),
        tools: parsed.tools?.map(tool => tool.function?.name) ?? [], usage: null,
        responseModel: null, status: null, durationMs: null, completed: false };
      requests.push(request);
      const started = performance.now();
      const controller = new AbortController();
      outgoing.once('close', () => { if (!outgoing.writableEnded) controller.abort(); });
      try {
        const upstream = await fetch(baseUrl.replace(/\/$/, '') + incoming.url.replace(/^\/v1/, ''), {
          method: incoming.method, headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
          body, signal: controller.signal,
        });
        request.status = upstream.status;
        outgoing.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream' });
        let pending = '';
        const decoder = new TextDecoder();
        for await (const chunk of upstream.body) {
          outgoing.write(chunk);
          pending += decoder.decode(chunk, { stream: true });
          let newline;
          while ((newline = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.usage) request.usage = event.usage;
              if (event.model) request.responseModel = event.model;
            } catch { /* Only SSE JSON metadata is observed; incomplete chunks are forwarded unchanged. */ }
          }
        }
        request.completed = true;
        outgoing.end();
      } catch (error) {
        request.failure = error.name;
        outgoing.destroy();
      } finally { request.durationMs = Math.round(performance.now() - started); }
    })().catch(() => outgoing.destroy());
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('observer bind failed');
  return { requests, baseUrl: `http://127.0.0.1:${address.port}/v1`, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}

export function sumObservedUsage(requests) {
  if (!requests.length || requests.some(request => !request.completed || !request.usage)) return null;
  const sum = (getter) => {
    const values = requests.map(request => getter(request.usage));
    return values.every(value => typeof value === 'number') ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    promptTokensIncludingCache: sum(usage => usage.prompt_tokens ?? usage.input_tokens),
    completionTokens: sum(usage => usage.completion_tokens ?? usage.output_tokens),
    cacheReadTokens: sum(usage => usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens),
    cacheWriteTokens: sum(usage => usage.prompt_tokens_details?.cache_write_tokens ?? usage.cache_creation_input_tokens),
    reasoningTokens: sum(usage => usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens),
    totalTokens: sum(usage => usage.total_tokens),
  };
}
