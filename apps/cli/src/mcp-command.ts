import { getPiwinRoot } from '@piwin/host-runtime';
import { listEnabledServers, loadMcpConfig, saveMcpConfig, tryValidateMcpConfig } from '@piwin/mcp';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readOption } from './cli-args.js';

/**
 * `piwin mcp` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandMcp(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();

  if (sub === 'list') {
    const document = await loadMcpConfig(root);
    const servers = Object.entries(document.mcpServers);
    if (servers.length === 0) {
      console.log('(no mcp servers in ~/.piwin/mcp.json)');
      return;
    }
    for (const [id, config] of servers) {
      const state = config.disabled ? 'off' : 'on';
      const args = config.args?.join(' ') ?? '';
      console.log(`${state}\t${id}\t${config.command} ${args}`.trimEnd());
    }
    const enabled = listEnabledServers(document);
    console.log(`enabled: ${enabled.length}/${servers.length}`);
    return;
  }

  if (sub === 'validate') {
    const pathArg = argv[2];
    const raw = pathArg
      ? await readFile(resolve(pathArg), 'utf8')
      : JSON.stringify(await loadMcpConfig(root));
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error('invalid JSON', error);
      process.exitCode = 1;
      return;
    }
    const result = tryValidateMcpConfig(parsed);
    if (result.ok) {
      console.log('ok');
      console.log(`servers: ${Object.keys(result.document.mcpServers).length}`);
      return;
    }
    for (const issue of result.issues) {
      console.error(`${issue.path}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (sub === 'add') {
    const id = argv[2];
    const command = readOption(argv, '--command');
    if (!id || !command) {
      console.error('Usage: piwin mcp add <id> --command <cmd> [--args a,b] [--env KEY=VAL]');
      process.exitCode = 1;
      return;
    }
    const document = await loadMcpConfig(root);
    const serverConfig: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    } = { command };
    const argsRaw = readOption(argv, '--args');
    if (argsRaw) {
      serverConfig.args = argsRaw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    const envRaw = readOption(argv, '--env');
    if (envRaw) {
      const [envKey, ...rest] = envRaw.split('=');
      if (envKey) {
        serverConfig.env = { [envKey]: rest.join('=') };
      }
    }
    document.mcpServers[id] = serverConfig;
    const path = await saveMcpConfig(root, document);
    console.log(`saved ${id} -> ${path}`);
    return;
  }

  console.error(`Unknown mcp subcommand: ${sub}`);
  process.exitCode = 1;
}
