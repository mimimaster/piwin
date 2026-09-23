import { openCliHost } from './cli-host.js';
import { runTurnRedo, runTurnUndo } from './turn-change-command.js';
import { formatError } from '@piwin/contracts';
import { parseMock, parseMode } from './cli-args.js';

/**
 * `piwin turn` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandTurn(argv: string[]): Promise<void> {
  const sub = argv[1] ?? '';
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
    console.error('Usage: piwin turn undo|redo <changeSetId> --expected-version <revision>');
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
