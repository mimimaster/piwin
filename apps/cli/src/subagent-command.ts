import { runSubagentResult, runSubagentResults } from './subagent-result-command.js';
import { formatError } from '@piwin/contracts';
import { parseMock, parseMode } from './cli-args.js';
import { createWalkthroughHostClient } from './cli-host-clients.js';

/**
 * `piwin subagent` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandSubagent(argv: string[]): Promise<void> {
  const sub = argv[1] ?? '';
  const mock = parseMock(argv);
  const mode = parseMode(argv);

  if (sub === 'status') {
    const runId = argv[2];
    if (!runId || runId.startsWith('--')) {
      console.error('Usage: piwin subagent status <runId> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createWalkthroughHostClient(mode, mock);
    try {
      const response = await client.handleCommand({
        type: 'subagent/batch-status',
        runId,
      });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
      } else {
        const result = response.data as {
          runId: string;
          status: string;
          results: Array<{ taskId: string; executionStatus: string; error?: string }>;
        };
        console.log(`Batch ${result.runId}: ${result.status}`);
        for (const task of result.results) {
          const errorSuffix = task.error ? ` — ${task.error}` : '';
          console.log(`  [${task.taskId}] ${task.executionStatus}${errorSuffix}`);
        }
      }
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'results') {
    const parentSessionId = argv[2];
    if (!parentSessionId || parentSessionId.startsWith('--')) {
      console.error('Usage: piwin subagent results <parentSessionId> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createWalkthroughHostClient(mode, mock);
    try {
      await runSubagentResults(client, parentSessionId, console.log);
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'result') {
    const resultId = argv[2];
    if (!resultId || resultId.startsWith('--')) {
      console.error('Usage: piwin subagent result <resultId> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createWalkthroughHostClient(mode, mock);
    try {
      await runSubagentResult(client, resultId, console.log);
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'cancel') {
    const runId = argv[2];
    if (!runId || runId.startsWith('--')) {
      console.error('Usage: piwin subagent cancel <runId> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createWalkthroughHostClient(mode, mock);
    try {
      const response = await client.handleCommand({
        type: 'subagent/batch-cancel',
        runId,
      });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
      } else {
        console.log(`Batch ${runId} cancellation requested.`);
      }
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  console.error(`Unknown subagent subcommand: ${sub || '(none)'}`);
  console.error('Usage: piwin subagent status|cancel|results|result');
  process.exitCode = 1;
}
