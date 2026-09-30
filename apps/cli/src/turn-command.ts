import { isAbsolute, resolve } from 'node:path';

import { openCliHost } from './cli-host.js';
import {
  runTurnCancel,
  runTurnExport,
  runTurnOperation,
  runTurnOperations,
  runTurnRedo,
  runTurnRepair,
  runTurnShow,
  runTurnUndo,
  type TurnChangeHostClient,
} from './turn-change-command.js';
import { formatError } from '@piwin/contracts';
import { parseMock, parseMode } from './cli-args.js';

/**
 * `piwin turn` subcommand: argv handling, host lifecycle, and output.
 */

const TURN_USAGE = [
  'Usage: piwin turn undo|redo <changeSetId> --expected-version <revision>',
  '       piwin turn show <sessionId> <runId...>',
  '       piwin turn operations [projectPath]      # undo/redo record (default: cwd)',
  '       piwin turn operation <operationId>',
  '       piwin turn cancel <operationId>          # only before its first write',
  '       piwin turn repair <operationId> --expected-version <revision> [--yes]',
  '       piwin turn export <operationId> <destination>   # copy its backup to a new dir on the Host',
].join('\n');

/** Flags that take a value; their value is not a positional argument. */
const VALUE_FLAGS = new Set(['--expected-version', '--mode']);

function positional(argv: string[], from: number): string[] {
  const values: string[] = [];
  for (let index = from; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (VALUE_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith('--')) values.push(arg);
  }
  return values;
}

function expectedRevision(argv: string[]): number {
  const flag = argv.indexOf('--expected-version');
  const raw = flag >= 0 ? argv[flag + 1] : undefined;
  return raw !== undefined ? Number(raw) : Number.NaN;
}

/** Parse argv into one Host call; null means print usage. */
function planTurnCommand(
  argv: string[],
): ((client: TurnChangeHostClient) => Promise<void>) | null {
  const sub = argv[1] ?? '';
  const args = positional(argv, 2);
  const write = (line: string): void => console.log(line);
  switch (sub) {
    case 'show': {
      const [sessionId, ...runIds] = args;
      return sessionId && runIds.length > 0
        ? (client) => runTurnShow(client, sessionId, runIds, write)
        : null;
    }
    case 'undo':
    case 'redo': {
      const changeSetId = args[0];
      const revision = expectedRevision(argv);
      if (!changeSetId || !Number.isInteger(revision)) return null;
      return sub === 'undo'
        ? (client) => runTurnUndo(client, changeSetId, revision, write)
        : (client) => runTurnRedo(client, changeSetId, revision, write);
    }
    case 'operations': {
      const projectPath = args[0] ?? process.cwd();
      return (client) => runTurnOperations(client, projectPath, write);
    }
    case 'operation': {
      const operationId = args[0];
      return operationId ? (client) => runTurnOperation(client, operationId, write) : null;
    }
    case 'cancel': {
      const operationId = args[0];
      return operationId ? (client) => runTurnCancel(client, operationId, write) : null;
    }
    case 'repair': {
      const operationId = args[0];
      const revision = expectedRevision(argv);
      if (!operationId || !Number.isInteger(revision)) return null;
      const confirm = argv.includes('--yes');
      return (client) => runTurnRepair(client, operationId, revision, confirm, write);
    }
    case 'export': {
      const [operationId, destination] = args;
      if (!operationId || !destination) return null;
      // The Host resolves nothing relative to its own cwd: send an absolute path.
      const absolute = isAbsolute(destination) ? destination : resolve(process.cwd(), destination);
      return (client) => runTurnExport(client, operationId, absolute, write);
    }
    default:
      return null;
  }
}

export async function commandTurn(argv: string[]): Promise<void> {
  const run = planTurnCommand(argv);
  if (!run) {
    console.error(TURN_USAGE);
    process.exitCode = 1;
    return;
  }
  const runtime = await openCliHost({ mode: parseMode(argv), mock: parseMock(argv) });
  try {
    await run(runtime);
  } catch (error) {
    console.error(formatError(error));
    process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}
