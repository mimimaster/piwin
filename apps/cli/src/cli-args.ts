import type { HostMode, PermissionMode } from '@piwin/contracts';
import { parsePermissionModeOverride } from './permission-mode-override.js';
import { HostRuntimeTestFixture } from '@piwin/host-runtime';
import { resolve } from 'node:path';

/**
 * CLI argument parsing shared by every subcommand.
 */

export function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export function collectPositionals(tokens: string[], valueOptions: string[]): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token.startsWith('--')) {
      if (valueOptions.includes(token)) {
        index += 1; // skip the option's value
      }
      continue;
    }
    positionals.push(token);
  }
  return positionals;
}

export function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

export function parseCliRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`Invalid revision: ${value}`);
  }
  return revision;
}

export function parseMode(argv: string[]): HostMode {
  const value = readOption(argv, '--mode');
  return value === 'rpc' ? 'rpc' : 'sdk';
}

export function parseOptionalProject(argv: string[]): string | null {
  const value = readOption(argv, '--project');
  if (!value) {
    return null;
  }
  return resolve(value);
}

export function parseProject(argv: string[]): string {
  return parseOptionalProject(argv) ?? resolve(process.cwd());
}

export function parseMock(argv: string[]): boolean {
  return hasFlag(argv, '--mock') || process.env.PIWIN_MOCK === '1';
}

export function resolvePermissionModeOverride(argv: string[]): PermissionMode | undefined {
  const result = parsePermissionModeOverride(argv);
  if (result.fromDangerousAlias) {
    console.error(
      '[piwin] --dangerously-bypass-permissions: bypassing all permission prompts for this session.',
    );
  }
  return result.mode;
}

export function parseHostServeTestFixture(argv: string[]): HostRuntimeTestFixture | undefined {
  const value = readOption(argv, '--test-fixture') ?? process.env.PIWIN_HOST_TEST_FIXTURE;
  if (value === undefined) {
    return undefined;
  }
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('--test-fixture is available only when NODE_ENV=test');
  }
  if (
    value === 'hang-until-abort' ||
    value === 'slow-first-token' ||
    value === 'high-rate-tool-output'
  ) {
    return value;
  }
  throw new Error(`Unknown host test fixture: ${value}`);
}
