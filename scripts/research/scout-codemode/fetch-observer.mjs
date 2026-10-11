import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

// An experiment-only preload for SDK and real RPC Scouts. It forwards the
// original fetch arguments unchanged; response clones collect usage metadata.
const nativeFetch = globalThis.fetch;
const observerTag = Symbol.for('piwin.experiment.fetch-observer');
if (!globalThis[observerTag]) {
  globalThis[observerTag] = true;
  globalThis.fetch = async function observedFetch(input, init) {
    const destination = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const directory = process.env.PIWIN_EXPERIMENT_OBSERVER_RUN_DIR;
    if (!directory || !/^https:\/\/api\.x\.ai\/v1\/(responses|chat\/completions)/.test(destination)) {
      return nativeFetch(input, init);
    }
    const request = new Request(input, init);
    const body = await request.clone().text();
    const payload = JSON.parse(body);
    const path = join(directory, `${process.pid}-${randomUUID()}.json`);
    const record = { pid: process.pid, endpoint: destination, model: payload.model,
      reasoningEffort: payload.reasoning?.effort ?? payload.reasoning_effort ?? null,
      startedAt: new Date().toISOString(), requestBodyHash: createHash('sha256').update(body).digest('hex'),
      tools: payload.tools?.map(tool => tool.function?.name ?? tool.name).filter(Boolean) ?? [],
      usage: null, responseModel: null, status: null, durationMs: null, completed: false };
    const started = performance.now();
    await mkdir(directory, { recursive: true });
    const save = async () => writeFile(path, JSON.stringify(record));
    let response;
    try { response = await nativeFetch(input, init); }
    catch (error) { record.failure = error.name; record.durationMs = Math.round(performance.now() - started); await save(); throw error; }
    record.status = response.status;
    await save();
    void (async () => {
      try {
        if (!response.headers.get('content-type')?.includes('event-stream')) {
          const value = await response.clone().json();
          record.usage = value.usage ?? null; record.responseModel = value.model ?? null;
          record.providerErrorCode = value.error?.code ?? null;
        } else {
          const reader = response.clone().body.getReader();
          const decoder = new TextDecoder(); let pending = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            let newline;
            while ((newline = pending.indexOf('\n')) !== -1) {
              const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
              if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
              const event = JSON.parse(line.slice(6));
              if (event.usage || event.response?.usage) record.usage = event.usage ?? event.response.usage;
              if (event.model || event.response?.model) record.responseModel = event.model ?? event.response.model;
              if (event.type === 'error' || event.type === 'response.failed') record.providerErrorCode = event.error?.code ?? event.response?.error?.code ?? 'stream-error';
            }
          }
        }
        record.completed = true;
      } catch (error) { record.observationFailure = error.name; }
      finally { record.durationMs = Math.round(performance.now() - started); await save(); }
    })().catch(error => { process.stderr.write(`Experiment observer write failed: ${error.name}\n`); });
    return response;
  };
}
