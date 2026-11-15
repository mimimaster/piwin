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
/** @param {import('@earendil-works/pi-ai').Usage} previous
 * @param {import('@earendil-works/pi-ai').Usage} current
 * @returns {import('@earendil-works/pi-ai').Usage}
 */
function addUsage(previous, current) {
  return {
    input: previous.input + current.input, output: previous.output + current.output,
    cacheRead: previous.cacheRead + current.cacheRead, cacheWrite: previous.cacheWrite + current.cacheWrite,
    totalTokens: previous.totalTokens + current.totalTokens,
    cost: {
      input: previous.cost.input + current.cost.input, output: previous.cost.output + current.cost.output,
      cacheRead: previous.cost.cacheRead + current.cost.cacheRead, cacheWrite: previous.cost.cacheWrite + current.cost.cacheWrite,
      total: previous.cost.total + current.cost.total,
    },
  };
}
/** Reject the entire batch without executing any tool, including mixed batches.
 * @param {import('@earendil-works/pi-ai').Context} context
 * @param {import('@earendil-works/pi-ai').AssistantMessage} message
 * @param {ReadonlySet<string>} allowed
 * @returns {import('@earendil-works/pi-ai').Context}
 */
function correctionContext(context, message, allowed) {
  const guidance = allowed.size ? `Available tools: ${[...allowed].join(', ')}. Use only these tools.` : 'No tools are available. Respond directly.';
  const results = message.content.filter((block) => block.type === 'toolCall').map((call) => ({
    role: /** @type {const} */ ('toolResult'), toolCallId: call.id, toolName: call.name,
    content: [{ type: /** @type {const} */ ('text'), text: `This tool batch was not executed because it included an unavailable tool. ${guidance} bash/read declarations may be protocol placeholders, not executable tools. Continue the user request; return requested code directly in your reply when file/shell tools are unavailable.` }],
    isError: true, timestamp: Date.now(),
  }));
  return { ...context, messages: [...context.messages, message, ...results] };
}
/** Native Pi parser/transport with one correction for protocol-only tool calls.
 * @param {import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>} model
 * @param {import('@earendil-works/pi-ai').Context} context
 * @param {import('@earendil-works/pi-ai').SimpleStreamOptions} [options]
 * @returns {import('@earendil-works/pi-ai').AssistantMessageEventStream}
 */
export function streamZen(model, context, options) {
  const allowed = new Set((context.tools ?? []).map((tool) => tool.name));
  const { onPayload, ...rest } = options ?? {};
  const upstreamModel = /** @type {import('@earendil-works/pi-ai').Model<'openai-completions'>} */ ({ ...model, api: 'openai-completions', baseUrl: ZEN_BASE_URL, headers: {} });
  const output = createAssistantMessageEventStream();
  void (async () => {
    let latest = emptyMessage(model);
    let previousUsage = latest.usage;
    /** @type {import('@earendil-works/pi-ai').AssistantMessage['content']} */
    let prefix = [];
    let requestContext = context;
    /** @param {import('@earendil-works/pi-ai').AssistantMessage} message */
    const project = (message) => ({ ...message, content: [...prefix, ...message.content], usage: addUsage(previousUsage, message.usage) });
    /** @param {import('@earendil-works/pi-ai').AssistantMessageEvent} event */
    const forward = (event) => {
      if ('partial' in event) {
        latest = project(event.partial);
        output.push({ ...event, ...('contentIndex' in event ? { contentIndex: prefix.length + event.contentIndex } : {}), partial: latest });
      }
    };
    output.push({ type: 'start', partial: latest });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        options?.signal?.throwIfAborted();
        const native = openAICompletionsApi().streamSimple(upstreamModel, requestContext, {
          ...rest, apiKey: 'public', headers: buildZenHeaders(model.headers, rest.headers, sessionId),
          onPayload: async (payload, hookModel) => shapeZenPayload((await onPayload?.(payload, hookModel)) ?? payload, allowed),
        });
        // Native partial objects are mutable. Hold events from the first tool
        // onward until the whole batch is validated; keep earlier text streaming.
        /** @type {import('@earendil-works/pi-ai').AssistantMessageEvent[]} */
        const pending = [];
        for await (const event of native) {
          if (event.type === 'start') continue;
          if (event.type === 'done') {
            const unexpected = event.message.content.filter((block) => block.type === 'toolCall').filter((call) => !allowed.has(call.name));
            if (unexpected.length) {
              if (attempt === 0 && unexpected.every((call) => call.name === 'bash' || call.name === 'read')) {
                requestContext = correctionContext(context, event.message, allowed);
                prefix = latest.content;
                previousUsage = addUsage(previousUsage, event.message.usage);
                latest = { ...latest, usage: previousUsage };
                const lastTextIndex = prefix.reduce((found, block, index) => block.type === 'text' ? index : found, -1);
                const lastText = prefix[lastTextIndex];
                if (lastText?.type === 'text') {
                  prefix = prefix.map((block, index) => index === lastTextIndex ? { ...lastText, text: `${lastText.text}\n\n` } : block);
                  latest = { ...latest, content: prefix };
                  output.push({ type: 'text_delta', contentIndex: lastTextIndex, delta: '\n\n', partial: latest });
                }
                break;
              }
              const error = project({ ...event.message, content: event.message.content.filter((block) => block.type !== 'toolCall'), stopReason: /** @type {const} */ ('error'), errorMessage: `Zen returned an unavailable tool: ${unexpected[0]?.name || '(unnamed)'}` });
              output.push({ type: 'error', reason: 'error', error }); output.end(error); return;
            }
            for (const buffered of pending) forward(buffered);
            const message = project(event.message);
            output.push({ ...event, message }); output.end(message); return;
          }
          if (event.type === 'error') {
            const error = project({ ...event.error, content: event.error.content.filter((block) => block.type !== 'toolCall') });
            output.push({ ...event, error }); output.end(error); return;
          }
          if (pending.length || event.type.startsWith('toolcall_')) { pending.push(event); continue; }
          const firstTool = event.partial.content.findIndex((block) => block.type === 'toolCall');
          forward({ ...event, partial: { ...event.partial, content: firstTool < 0 ? [...event.partial.content] : event.partial.content.slice(0, firstTool) } });
        }
      }
      throw new Error('Zen stream ended without a terminal response');
    } catch (failure) {
      const error = { ...latest, content: latest.content.filter((block) => block.type !== 'toolCall'), stopReason: /** @type {'aborted' | 'error'} */ (options?.signal?.aborted ? 'aborted' : 'error'), errorMessage: failure instanceof Error ? failure.message : String(failure) };
      output.push({ type: 'error', reason: error.stopReason, error }); output.end(error);
    }
  })();
  return output;
}
