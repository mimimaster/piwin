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
  DEVIN_HOST,
  buildChatRequest,
  decodeChatResponse,
  frameConnect,
  getUserJwt,
  parseConnectFrames,
  trailerError,
} from './protocol.js';

const CHAT_PATH = '/exa.api_server_pb.ApiServerService/GetChatMessage';

export function streamDevin(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output: AssistantMessage = {
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

  void (async () => {
    try {
      const apiKey = options?.apiKey;
      if (!apiKey) throw new Error('No Devin credential. Run /login devin');
      const fetchImpl = options?.fetch ?? fetch;
      const host = model.baseUrl || DEVIN_HOST;
      const userJwt = await getUserJwt(apiKey, options?.signal, fetchImpl);
      const request = frameConnect(buildChatRequest(model, context, options ?? {}, apiKey, userJwt));
      const response = await fetchImpl(`${host}${CHAT_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/connect+proto',
          'connect-protocol-version': '1',
          'connect-content-encoding': 'gzip',
          'accept-encoding': 'identity',
          'user-agent': 'connect-go/1.18.1 (go1.26.3)',
          'connect-accept-encoding': 'gzip',
        },
        body: new Uint8Array(request),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      if (!response.ok) {
        throw new Error(`Devin chat failed: ${response.status} ${await response.text()}`);
      }
      if (!response.body) {
        throw new Error('Devin chat returned an empty body');
      }

      stream.push({ type: 'start', partial: output });
      const reader = response.body.getReader();
      let pending: Buffer = Buffer.alloc(0);
      let textBlock: TextContent | undefined;
      let thinkingBlock: ThinkingContent | undefined;
      const tools = new Map<string, ToolCall>();
      const partialTools = new Map<string, string>();
      let stopReason = 0;

      for (;;) {
        const next = await reader.read();
        if (next.value?.length) pending = Buffer.concat([pending, Buffer.from(next.value)]);
        const complete = completeFrames(pending);
        pending = complete.rest;
        for (const frame of parseConnectFrames(complete.bytes)) {
          if (frame.trailer) {
            const error = trailerError(frame.payload);
            if (error) throw new Error(`Devin stream error: ${error}`);
            continue;
          }
          for (const delta of decodeChatResponse(frame.payload)) {
            if (delta.type === 'message') output.responseId = delta.id;
            if (delta.type === 'text') {
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
              stream.push({
                type: 'text_delta',
                contentIndex: output.content.indexOf(textBlock),
                delta: delta.value,
                partial: output,
              });
            }
            if (delta.type === 'thinking') {
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
              if (delta.signature) thinkingBlock.thinkingSignature = delta.signature;
              stream.push({
                type: 'thinking_delta',
                contentIndex: output.content.indexOf(thinkingBlock),
                delta: delta.value,
                partial: output,
              });
            }
            if (delta.type === 'tool') {
              endText(stream, output, textBlock);
              endThinking(stream, output, thinkingBlock);
              textBlock = undefined;
              thinkingBlock = undefined;
              let tool = tools.get(delta.id);
              if (!tool) {
                tool = { type: 'toolCall', id: delta.id, name: delta.name, arguments: {} };
                tools.set(delta.id, tool);
                partialTools.set(delta.id, '');
                output.content.push(tool);
                stream.push({
                  type: 'toolcall_start',
                  contentIndex: output.content.length - 1,
                  partial: output,
                });
              }
              tool.name = delta.name || tool.name;
              const previous = partialTools.get(delta.id) ?? '';
              const accumulated = delta.argumentsJson.startsWith(previous)
                ? delta.argumentsJson
                : previous + delta.argumentsJson;
              partialTools.set(delta.id, accumulated);
              try {
                tool.arguments = JSON.parse(accumulated) as Record<string, unknown>;
              } catch {
                // Partial JSON arrives across frames.
              }
              stream.push({
                type: 'toolcall_delta',
                contentIndex: output.content.indexOf(tool),
                delta: accumulated.slice(previous.length),
                partial: output,
              });
            }
            if (delta.type === 'usage') {
              output.usage.input = delta.input;
              output.usage.output = delta.output;
              output.usage.cacheRead = delta.cacheRead;
              output.usage.cacheWrite = delta.cacheWrite;
              output.usage.totalTokens =
                delta.input + delta.output + delta.cacheRead + delta.cacheWrite;
              calculateCost(model, output.usage);
            }
            if (delta.type === 'stop') stopReason = delta.reason;
          }
        }
        if (next.done) break;
      }

      endText(stream, output, textBlock);
      endThinking(stream, output, thinkingBlock);
      for (const tool of tools.values()) {
        stream.push({
          type: 'toolcall_end',
          contentIndex: output.content.indexOf(tool),
          toolCall: tool,
          partial: output,
        });
      }
      const doneReason = tools.size
        ? 'toolUse'
        : stopReason === 1 || stopReason === 3
          ? 'length'
          : 'stop';
      output.stopReason = doneReason;
      calculateCost(model, output.usage);
      stream.push({ type: 'done', reason: doneReason, message: output });
      stream.end();
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

function completeFrames(buffer: Buffer): { bytes: Buffer; rest: Buffer } {
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const length = buffer.readUInt32BE(offset + 1);
    if (offset + 5 + length > buffer.length) break;
    offset += 5 + length;
  }
  return { bytes: buffer.subarray(0, offset), rest: buffer.subarray(offset) };
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
