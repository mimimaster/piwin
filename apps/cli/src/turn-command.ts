import { openCliHost } from './cli-host.js';
import { runTurnRedo, runTurnShow, runTurnUndo } from './turn-change-command.js';
import { formatError } from '@piwin/contracts';
import { parseMock, parseMode } from './cli-args.js';

/**
 * `piwin turn` subcommand: argv handling, host lifecycle, and output.
 */

const TURN_USAGE = [
  'Usage: piwin turn undo|redo <changeSetId> --expected-version <revision>',
  '       piwin turn show <sessionId> <runId...>',
].join('\n');

export async function commandTurn(argv: string[]): Promise<void> {
  const sub = argv[1] ?? '';
  if (sub === 'show') {
    const sessionId = argv[2];
    const runIds = argv.slice(3).filter((arg) => !arg.startsWith('--'));
    if (!sessionId || runIds.length === 0) {
      console.error(TURN_USAGE);
      process.exitCode = 1;
      return;
    }
    const runtime = await openCliHost({ mode: parseMode(argv), mock: parseMock(argv) });
    try {
      await runTurnShow(runtime, sessionId, runIds, console.log);
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await runtime.dispose();
    }
    return;
  }
  const changeSetId = argv[2];
  const versionFlag = argv.indexOf('--expected-version');
  const revisionRaw = versionFlag >= 0 ? argv[versionFlag + 1] : undefined;
  const revision = revisionRaw !== undefined ? Number(revisionRaw) : Number.NaN;
  if (
    (sub !== 'undo' && sub !== 'redo') ||
    !changeSetId ||
    changeSetId.startsWith('--') ||
    !Number.isInteger(revision)
  ) {
    console.error(TURN_USAGE);
    process.exitCode = 1;
    return;
  }
  const mock = parseMock(argv);
  const mode = parseMode(argv);
  const runtime = await openCliHost({ mode, mock });
  try {
    if (sub === 'undo') {
      await runTurnUndo(runtime, changeSetId, revision, console.log);
    } else {
      await runTurnRedo(runtime, changeSetId, revision, console.log);
    }
  } catch (error) {
    console.error(formatError(error));
    process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}
