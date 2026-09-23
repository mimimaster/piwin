import { HostRuntime } from '@piwin/host-runtime';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `piwin host-mode` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandHostMode(): Promise<void> {
  const sdkRoot = await mkdtemp(join(tmpdir(), 'piwin-cli-host-mode-sdk-'));
  const rpcRoot = await mkdtemp(join(tmpdir(), 'piwin-cli-host-mode-rpc-'));
  const sdkRuntime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: sdkRoot });
  const rpcRuntime = new HostRuntime({ mode: 'rpc', mock: true, piwinRoot: rpcRoot });
  console.log(`sdk runtime mode=${sdkRuntime.getMode()}`);
  console.log(`rpc runtime mode=${rpcRuntime.getMode()}`);
  await sdkRuntime.dispose();
  await rpcRuntime.dispose();
}
