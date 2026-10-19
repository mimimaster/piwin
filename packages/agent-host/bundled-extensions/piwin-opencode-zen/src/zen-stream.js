import { createAssistantMessageEventStream, openAICompletionsApi } from '@earendil-works/pi-ai/compat';
import { buildZenHeaders, resolveZenSessionId, shapeZenPayload, ZEN_BASE_URL } from './zen-request.js';
const sessionId = resolveZenSessionId(process.env.OPENCODE_ZEN_SESSION);

/** @param {import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>} model
 * @returns {import('@earendil-works/pi-ai').AssistantMessage}
 */
function emptyMessage(model) {
  return { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'pending', timestamp: Date.now() };
}
/** Native Pi parser/transport; only request shaping and a terminal tool guard.
 * @param {import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>} model
 * @param {import('@earendil-works/pi-ai').Context} context
 * @param {import('@earendil-works/pi-ai').SimpleStreamOptions} [options]
 * @returns {import('@earendil-works/pi-ai').AssistantMessageEventStream}
 */
export function streamZen(model, context, options) {
  const allowed = new Set((context.tools ?? []).map((tool) => tool.name));
  const { onPayload, ...rest } = options ?? {};
  const upstreamModel = /** @type {import('@earendil-works/pi-ai').Model<'openai-completions'>} */ ({ ...model, api: 'openai-completions', baseUrl: ZEN_BASE_URL, headers: {} });
  const native = openAICompletionsApi().streamSimple(upstreamModel, context, {
    ...rest, apiKey: 'public', headers: buildZenHeaders(model.headers, rest.headers, sessionId),
    onPayload: async (payload, hookModel) => shapeZenPayload((await onPayload?.(payload, hookModel)) ?? payload, allowed),
  });
  const output = createAssistantMessageEventStream();
  void (async () => {
    let latest = emptyMessage(model);
    try {
      for await (const event of native) {
        if ('partial' in event) latest = event.partial;
        if (event.type === 'done') {
          const unexpected = event.message.content.find((block) => block.type === 'toolCall' && !allowed.has(block.name));
          if (unexpected?.type === 'toolCall') {
            const error = { ...event.message, content: event.message.content.filter((block) => block.type !== 'toolCall'), stopReason: /** @type {const} */ ('error'), errorMessage: `Zen returned an unavailable tool: ${unexpected.name || '(unnamed)'}` };
            output.push({ type: 'error', reason: 'error', error }); output.end(error); return;
          }
        }
        output.push(event);
      }
      output.end(await native.result());
    } catch (failure) {
      const error = { ...latest, content: latest.content.filter((block) => block.type !== 'toolCall'), stopReason: /** @type {'aborted' | 'error'} */ (options?.signal?.aborted ? 'aborted' : 'error'), errorMessage: failure instanceof Error ? failure.message : String(failure) };
      output.push({ type: 'error', reason: error.stopReason, error }); output.end(error);
    }
  })();
  return output;
}
