/** Manual browser acceptance fixture: actual Host/Pi/Extension/FSRS; only model text is scripted. */
import { createServer } from 'node:http';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDefaultPiwinConfig, savePiwinConfig, installExtension, HostRuntime } from '@piwin/host-runtime';
import { HostServer } from '@piwin/host-server';

// Never defaults to the operator's config/data. The real installer stages an inactive revision.
const requestedRoot = process.env.PIWIN_STUDY_UI_ROOT;
if (requestedRoot && (!resolve(requestedRoot).startsWith(resolve(tmpdir()) + '/') || !requestedRoot.split('/').at(-1)?.startsWith('piwin-study-ui-'))) throw new Error('Only this fixture\'s temporary data root may be reused');
const root = requestedRoot ?? await mkdtemp(join(tmpdir(), 'piwin-study-ui-'));
process.env.PIWIN_ROOT = root;
process.env.PIWIN_PI_AGENT_DIR = join(root, 'pi-agent');
process.env.STUDY_SPACE_TEST_KEY = 'local-fixture-only';
let runtime: HostRuntime | undefined;
let nextResponse: string | undefined;
const wire = createServer((request, response) => {
  void (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (request.url === '/response' && request.method === 'POST') {
      nextResponse = Buffer.concat(chunks).toString();
      response.writeHead(200); response.end('queued'); return;
    }
    if (request.url === '/command') {
      if (!runtime) throw new Error('Host not ready');
      const command = JSON.parse(Buffer.concat(chunks).toString()) as Parameters<HostRuntime['handleCommand']>[0];
      const result = await runtime.handleCommand(command, { idempotencyKey: `smoke-${Date.now()}` });
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result)); return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { tools?: unknown[]; messages?: Array<{ role: string }> };
    let output = 'data: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"study-fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"Offline teaching fixture. Your ordinary coding rules are preserved."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    // Naming/other background completions cannot consume the next interactive tool response.
    if (body.tools?.length && body.messages?.at(-1)?.role === 'user') {
      output = nextResponse ?? output;
      nextResponse = undefined;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(output);
  })().catch(error => {
    console.error('[study-ui fixture]', error);
    response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'fixture failed' } }));
  });
});
await new Promise<void>(ready => wire.listen(Number(process.env.PIWIN_STUDY_UI_WIRE_PORT ?? 0), '127.0.0.1', ready));
const wireAddress = wire.address();
if (!wireAddress || typeof wireAddress === 'string') throw new Error('No model fixture address');
const config = createDefaultPiwinConfig();
config.providers = [{ id: 'study-local', name: 'Study UI offline fixture', protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${wireAddress.port}/v1`, apiKeyEnv: 'STUDY_SPACE_TEST_KEY', models: [{ id: 'study-fixture', input: ['text'], reasoning: false }] }];
config.defaultProviderId = 'study-local'; config.defaultModelId = 'study-fixture';
config.flashcards = { enabled: true };
await savePiwinConfig(config, root);
await mkdir(join(root, 'workspace'), { recursive: true });
const installed = await installExtension({ piwinRoot: root, source: { kind: 'local', path: resolve('../../packages/agent-host/standalone-extensions/study-space') } });
runtime = new HostRuntime({ piwinRoot: root, mode: 'sdk', mock: false });
const enabled = await runtime.handleCommand({ type: 'extensions/set_enabled', extensionId: installed.extensionId, enabled: true });
if (!enabled.success) throw new Error(`Extension enable failed: ${enabled.error}`);
const host = new HostServer({ runtime, host: '127.0.0.1', port: Number(process.env.PIWIN_STUDY_UI_HOST_PORT ?? 0), mode: 'sdk', instanceId: runtime.getHostInstanceId(), piwinRoot: root, pairingEnabled: false, allowedOrigins: ['http://127.0.0.1:14390'] });
const address = await host.start();
console.log(JSON.stringify({ root, workspace: join(root, 'workspace'), endpoint: address.url, control: `http://127.0.0.1:${wireAddress.port}/command`, extensionId: installed.extensionId }));
async function close() {
  await host.stop(); await runtime?.dispose();
  await new Promise<void>(closed => wire.close(() => closed()));
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void close().catch(error => { console.error(error); process.exitCode = 1; }); });
