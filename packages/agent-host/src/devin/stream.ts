import {
  calculateCost,
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
} from '@earendil-works/pi-ai';
import {
  DEVIN_CHAT_PATH,
  DEVIN_HOST,
  buildChatRequest,
  buildDevinRpcHeaders,
  completeConnectFrames,
  decodeChatResponse,
  frameConnect,
  parseConnectFrames,
  parseDevinConnectError,
  rememberDevinGeminiThought,
  rememberDevinSignatureType,
  type DevinConnectError,
} from './protocol.js';
import { decodeDevinToolId, encodeDevinToolId } from './tool-schema.js';

type StreamOutcome =
  | { kind: 'done' }
  | { kind: 'retry-unsigned' }
  | { kind: 'error'; error: DevinConnectError };

function createInitialAssistantMessage(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'pending',
    timestamp: Date.now(),
  };
}

export function streamDevin(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  let output = createInitialAssistantMessage(model);

  void (async () => {
    try {
      const apiKey = options?.apiKey;
      if (!apiKey) throw new Error('No Devin credential. Run /login devin');
      const fetchImpl = options?.fetch ?? fetch;
      let outcome = await runDevinAttempt(
        model,
        context,
        options ?? {},
        apiKey,
        fetchImpl,
        output,
        stream,
        { unsigned: false },
      );
      if (outcome.kind === 'retry-unsigned' && !options?.signal?.aborted) {
        output = createInitialAssistantMessage(model);
        outcome = await runDevinAttempt(
          model,
          context,
          options ?? {},
          apiKey,
          fetchImpl,
          output,
          stream,
          { unsigned: true },
        );
      }
      if (outcome.kind === 'error') {
        throw new Error(`Devin chat failed: ${outcome.error.message}`);
      }
    } catch (error) {
      const errorReason = options?.signal?.aborted ? 'aborted' : 'error';
      output.stopReason = errorReason;
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: 'error', reason: errorReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

async function runDevinAttempt(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
  apiKey: string,
  fetchImpl: typeof fetch,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
  attemptOptions: { unsigned: boolean },
): Promise<StreamOutcome> {
  const built = buildChatRequest(model, context, options, apiKey, attemptOptions);
  const framed = frameConnect(built.body);
  const host = model.baseUrl || DEVIN_HOST;
  const response = await fetchImpl(`${host}${DEVIN_CHAT_PATH}`, {
    method: 'POST',
    headers: buildDevinRpcHeaders(apiKey, framed),
    body: new Uint8Array(framed),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    const parsed = parseDevinConnectError(response.status, bodyText) ?? {
      code: '',
      message: `${response.status} ${bodyText}`.trim(),
    };
    if (
      !attemptOptions.unsigned &&
      built.hasSignedThinking &&
      parsed.code === 'invalid_argument'
    ) {
      return { kind: 'retry-unsigned' };
    }
    return { kind: 'error', error: parsed };
  }
  if (!response.body) {
    return { kind: 'error', error: { code: '', message: 'Devin chat returned an empty body' } };
  }

  const reader = response.body.getReader();
  let pending: Buffer = Buffer.alloc(0);
  let started = false;
  let textBlock: TextContent | undefined;
  let thinkingBlock: ThinkingContent | undefined;
  let activeTool: ToolCall | undefined;
  const tools: ToolCall[] = [];
  const partialTools = new Map<ToolCall, string>();
  const rawCallIds: string[] = [];
  let ownText = '';
  let ownThinking = '';
  let ownSignature = '';
  let ownSignatureType = '';
  let stopReason = 0;

  const ensureStarted = (): void => {
    if (!started) {
      started = true;
      stream.push({ type: 'start', partial: output });
    }
  };

  for (;;) {
    const next = await reader.read();
    if (next.value?.length) {
      pending = Buffer.concat([pending, Buffer.from(next.value)]);
    }
    const complete = completeConnectFrames(pending);
    pending = complete.rest;
    for (const frame of parseConnectFrames(complete.bytes)) {
      if (frame.trailer) {
        const trailerErr = parseDevinConnectError(200, frame.payload.toString('utf8'));
        if (trailerErr) {
          if (
            !started &&
            !attemptOptions.unsigned &&
            built.hasSignedThinking &&
            trailerErr.code === 'invalid_argument'
          ) {
            await reader.cancel().catch(() => undefined);
            return { kind: 'retry-unsigned' };
          }
          throw new Error(`Devin stream error: ${trailerErr.message}`);
        }
        continue;
      }

      for (const delta of decodeChatResponse(frame.payload)) {
        if (delta.type === 'message') {
          output.responseId = delta.id;
        } else if (delta.type === 'text') {
          ensureStarted();
          endThinking(stream, output, thinkingBlock);
          thinkingBlock = undefined;
          if (!textBlock) {
            textBlock = { type: 'text', text: '' };
            output.content.push(textBlock);
            stream.push({
              type: 'text_start',
              contentIndex: output.content.length - 1,
              partial: output,
            });
          }
          textBlock.text += delta.value;
          ownText += delta.value;
          stream.push({
            type: 'text_delta',
            contentIndex: output.content.indexOf(textBlock),
            delta: delta.value,
            partial: output,
          });
        } else if (delta.type === 'thinking') {
          ensureStarted();
          endText(stream, output, textBlock);
          textBlock = undefined;
          if (!thinkingBlock) {
            thinkingBlock = { type: 'thinking', thinking: '' };
            output.content.push(thinkingBlock);
            stream.push({
              type: 'thinking_start',
              contentIndex: output.content.length - 1,
              partial: output,
            });
          }
          thinkingBlock.thinking += delta.value;
          ownThinking += delta.value;
          stream.push({
            type: 'thinking_delta',
            contentIndex: output.content.indexOf(thinkingBlock),
            delta: delta.value,
            partial: output,
          });
        } else if (delta.type === 'signature') {
          ownSignature += delta.value;
          const target = thinkingBlock ?? findLastThinkingBlock(output.content);
          if (target) {
            target.thinkingSignature = ownSignature;
          } else {
            ensureStarted();
            thinkingBlock = { type: 'thinking', thinking: '', thinkingSignature: ownSignature };
            output.content.push(thinkingBlock);
            stream.push({
              type: 'thinking_start',
              contentIndex: output.content.length - 1,
              partial: output,
            });
          }
        } else if (delta.type === 'signatureType') {
          ownSignatureType = delta.value;
        } else if (delta.type === 'tool') {
          ensureStarted();
          endText(stream, output, textBlock);
          endThinking(stream, output, thinkingBlock);
          textBlock = undefined;
          thinkingBlock = undefined;
          if (delta.name) {
            const safeId = delta.id
              ? encodeDevinToolId(delta.id)
              : `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
            const tool: ToolCall = {
              type: 'toolCall',
              id: safeId,
              name: delta.name,
              arguments: {},
            };
            activeTool = tool;
            tools.push(tool);
            partialTools.set(tool, '');
            rawCallIds.push(decodeDevinToolId(safeId));
            output.content.push(tool);
            stream.push({
              type: 'toolcall_start',
              contentIndex: output.content.length - 1,
              partial: output,
            });
          }
          if (delta.argumentsJson && activeTool) {
            const previous = partialTools.get(activeTool) ?? '';
            const accumulated = delta.argumentsJson.startsWith(previous) && previous.length > 0
              ? delta.argumentsJson
              : previous + delta.argumentsJson;
            partialTools.set(activeTool, accumulated);
            const parsedArgs = tryParseArguments(accumulated);
            if (parsedArgs !== undefined) {
              activeTool.arguments = parsedArgs;
            }
            stream.push({
              type: 'toolcall_delta',
              contentIndex: output.content.indexOf(activeTool),
              delta: accumulated.slice(previous.length),
              partial: output,
            });
          }
        } else if (delta.type === 'usage') {
          output.usage.input = delta.input;
          output.usage.output = delta.output;
          output.usage.cacheRead = delta.cacheRead;
          output.usage.cacheWrite = delta.cacheWrite;
          output.usage.totalTokens =
            delta.input + delta.output + delta.cacheRead + delta.cacheWrite;
          calculateCost(model, output.usage);
        } else if (delta.type === 'stop') {
          stopReason = delta.reason;
        }
      }
    }
    if (next.done) break;
  }

  if (pending.length > 0) {
    throw new Error('Devin stream ended with an incomplete frame');
  }
  if (!ownText && !ownThinking && tools.length === 0) {
    throw new Error('Devin returned an empty reply');
  }

  ensureStarted();
  if (ownSignature && ownSignatureType) {
    rememberDevinSignatureType(ownSignature, ownSignatureType);
  }
  if (/gemini/i.test(model.id) && ownSignature && (ownSignatureType || 'gemini') === 'gemini') {
    rememberDevinGeminiThought(
      { callIds: rawCallIds, text: ownText },
      { signature: ownSignature, type: ownSignatureType || 'gemini', model: model.id },
    );
    for (const tool of tools) {
      tool.thoughtSignature = ownSignature;
    }
  }

  endText(stream, output, textBlock);
  endThinking(stream, output, thinkingBlock);
  for (const tool of tools) {
    stream.push({
      type: 'toolcall_end',
      contentIndex: output.content.indexOf(tool),
      toolCall: tool,
      partial: output,
    });
  }

  const doneReason =
    tools.length > 0 || stopReason === 10
      ? 'toolUse'
      : stopReason === 3
        ? 'length'
        : 'stop';
  output.stopReason = doneReason;
  calculateCost(model, output.usage);
  stream.push({ type: 'done', reason: doneReason, message: output });
  stream.end();
  return { kind: 'done' };
}

function findLastThinkingBlock(content: AssistantMessage['content']): ThinkingContent | undefined {
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const item = content[index];
    if (item?.type === 'thinking') return item;
  }
  return undefined;
}

function tryParseArguments(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Partial JSON arrives across frames.
  }
  return undefined;
}

function endText(
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
  block?: TextContent,
): void {
  if (block) {
    stream.push({
      type: 'text_end',
      contentIndex: output.content.indexOf(block),
      content: block.text,
      partial: output,
    });
  }
}

function endThinking(
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
  block?: ThinkingContent,
): void {
  if (block) {
    stream.push({
      type: 'thinking_end',
      contentIndex: output.content.indexOf(block),
      content: block.thinking,
      partial: output,
    });
  }
}
