export async function catalogFetch(url) {
  if (String(url) === 'https://opencode.ai/zen/v1/models') return Response.json({ data: [{ id: 'future-free' }] });
  if (String(url) === 'https://models.dev/api.json') return Response.json({ opencode: {
    npm: '@ai-sdk/openai-compatible', models: { 'future-free': {
      id: 'future-free', name: 'Future Free', reasoning: true, tool_call: true,
      modalities: { input: ['text'], output: ['text'] },
      cost: { input: 0, output: 0 }, limit: { context: 123456, output: 6789 },
    } },
  } });
  throw new Error(`Unexpected network access: ${url}`);
}
