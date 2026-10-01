/** Disposable browser smoke Host: real inventory + real adapter launch, fixture artifact, no paid prompts. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostRuntime } from '@piwin/host-runtime';
import { installFixtureAgentAdapter } from '@piwin/host-runtime/testing';
import { HostServer } from '../src/host-server.js';

const rootDir = await mkdtemp(join(tmpdir(), 'piwin-agent-browser-'));
// The reviewed id the desktop shell already knows; the artifact is a local fixture.
const installed = await installFixtureAgentAdapter(rootDir, {
  agentId: 'grok',
  script: { steps: [{ kind: 'text', text: 'Fixture adapter browser smoke complete.' }] },
});
const runtime = new HostRuntime({
  mode: 'sdk', mock: true, piwinRoot: rootDir,
  externalAgents: { env: installed.env },
});
const server = new HostServer({ runtime, piwinRoot: rootDir, port: 8876, host: '127.0.0.1', pairingEnabled: false });
const address = await server.start();
console.log(`Agent browser fixture (fixture adapter, disposable state): ${address.url}`);
console.log(`Serve apps/desktop/dist separately and connect the Web shell to ${address.url}`);
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await server.stop();
  await runtime.dispose();
  await rm(rootDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
