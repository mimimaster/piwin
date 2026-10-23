import { describeMcpServerLaunch, type McpServerConfig } from '@piwin/contracts';
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
      console.log(`${state}\t${id}\t${describeMcpServerLaunch(config)}`.trimEnd());
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
    const serverConfig = id ? readAddServerConfig(argv) : undefined;
    if (!id || !serverConfig) {
      console.error(
        'Usage: piwin mcp add <id> --command <cmd> [--args a,b] [--env KEY=VAL]\n' +
          '       piwin mcp add <id> --url <https://…> [--type http|sse] [--header "Name: value"]',
      );
      process.exitCode = 1;
      return;
    }
    const document = await loadMcpConfig(root);
    document.mcpServers[id] = serverConfig;
    // Same validator the Host applies on load, so a bad entry fails here, not at start.
    const checked = tryValidateMcpConfig(document);
    if (!checked.ok) {
      for (const issue of checked.issues) console.error(`${issue.path}: ${issue.message}`);
      process.exitCode = 1;
      return;
    }
    const path = await saveMcpConfig(root, checked.document);
    console.log(`saved ${id} -> ${path}`);
    return;
  }

  console.error(`Unknown mcp subcommand: ${sub}`);
  process.exitCode = 1;
}

/** `--command` makes a stdio server, `--url` a remote one; both or neither is a usage error. */
function readAddServerConfig(argv: string[]): McpServerConfig | undefined {
  const command = readOption(argv, '--command');
  const url = readOption(argv, '--url');
  if (url && !command) {
    const type = readOption(argv, '--type');
    const header = readOption(argv, '--header');
    const separator = header?.indexOf(':') ?? -1;
    return {
      url,
      ...(type === 'http' || type === 'sse' ? { type } : {}),
      ...(header && separator > 0
        ? { headers: { [header.slice(0, separator).trim()]: header.slice(separator + 1).trim() } }
        : {}),
    };
  }
  if (!command || url) return undefined;
  const config: McpServerConfig = { command };
  const argsRaw = readOption(argv, '--args');
  if (argsRaw) {
    config.args = argsRaw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const envRaw = readOption(argv, '--env');
  if (envRaw) {
    const [envKey, ...rest] = envRaw.split('=');
    if (envKey) config.env = { [envKey]: rest.join('=') };
  }
  return config;
}
