import type { HostCommand } from '@piwin/contracts';
import { openCliHost } from './cli-host.js';
import {
  runSessionBranches,
  runSessionContinue,
  runSessionRetry,
  runSessionSwitch,
} from './session-branch-command.js';
import {
  runSessionColdStorageExecute,
  runSessionColdStorageImport,
  runSessionColdStoragePlan,
  runSessionColdStorageReconcile,
  runSessionColdStorageRestore,
  runSessionColdStorageStatus,
} from './session-cold-storage-command.js';
import { runSessionLifecycleApply, runSessionLifecyclePlan } from './session-lifecycle-command.js';
import {
  runSessionPackCreate,
  runSessionPackList,
  runSessionPackVerify,
} from './session-pack-command.js';
import {
  runSessionQueueCancel,
  runSessionQueueEdit,
  runSessionQueueList,
  runSessionQueueReorder,
  runSessionReplaceRun,
} from './session-queue-command.js';
import { formatError } from '@piwin/contracts';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  collectPositionals,
  hasFlag,
  parseCliRevision,
  parseMock,
  parseMode,
  parseOptionalProject,
  parseProject,
  readOption,
} from './cli-args.js';

/**
 * `piwin session` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandSession(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const mock = parseMock(argv);
  const mode = parseMode(argv);
  const runtime = await openCliHost({ mode, mock });

  try {
    if (sub === 'lifecycle') {
      const action = argv[2] ?? 'plan';
      try {
        if (action === 'plan') {
          await runSessionLifecyclePlan(runtime, console.log);
          return;
        }
        if (action === 'apply') {
          const planId = readOption(argv, '--plan');
          if (!planId) {
            console.error('Usage: piwin session lifecycle apply --plan <plan-id> [--mock]');
            process.exitCode = 1;
            return;
          }
          const result = await runSessionLifecycleApply(runtime, planId, console.log);
          if (result.failed.length > 0) {
            process.exitCode = 2;
          }
          return;
        }
        console.error(`Unknown lifecycle action: ${action}`);
        console.error('Usage: piwin session lifecycle plan|apply --plan <plan-id>');
        process.exitCode = 1;
        return;
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
        return;
      }
    }

    if (sub === 'cold') {
      const action = argv[2] ?? 'status';
      try {
        if (action === 'status') {
          await runSessionColdStorageStatus(runtime, console.log);
          return;
        }
        if (action === 'plan') {
          const sessionId = readOption(argv, '--session');
          await runSessionColdStoragePlan(
            runtime,
            sessionId ? [sessionId] : undefined,
            console.log,
          );
          return;
        }
        if (action === 'execute') {
          const planId = readOption(argv, '--plan');
          const confirmationDigest = readOption(argv, '--confirm');
          if (!planId || !confirmationDigest) {
            console.error(
              'Usage: piwin session cold execute --plan <plan-id> --confirm <digest> [--mock]',
            );
            process.exitCode = 1;
            return;
          }
          const result = await runSessionColdStorageExecute(
            runtime,
            { planId, confirmationDigest },
            console.log,
          );
          if (result.failed.length > 0) {
            process.exitCode = 2;
          }
          return;
        }
        if (action === 'restore') {
          const sessionId = argv[3];
          const packPath = readOption(argv, '--pack');
          if (!sessionId) {
            console.error('Usage: piwin session cold restore <sessionId> [--pack <path>] [--mock]');
            process.exitCode = 1;
            return;
          }
          await runSessionColdStorageRestore(
            runtime,
            { sessionId, ...(packPath ? { packPath } : {}) },
            console.log,
          );
          return;
        }
        if (action === 'import') {
          const packPath = readOption(argv, '--pack');
          if (!packPath) {
            console.error('Usage: piwin session cold import --pack <path> [--mock]');
            process.exitCode = 1;
            return;
          }
          await runSessionColdStorageImport(runtime, packPath, console.log);
          return;
        }
        if (action === 'reconcile') {
          await runSessionColdStorageReconcile(runtime, console.log);
          return;
        }
        console.error(`Unknown cold action: ${action}`);
        console.error('Usage: piwin session cold status|plan|execute|restore|import|reconcile');
        process.exitCode = 1;
        return;
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
        return;
      }
    }

    if (sub === 'pack') {
      const action = argv[2] ?? 'list';
      try {
        if (action === 'create') {
          const sessionId = argv[3];
          const outputDir = readOption(argv, '--out');
          const packId = readOption(argv, '--pack-id');
          if (!sessionId || !outputDir) {
            console.error(
              'Usage: piwin session pack create <sessionId> --out <host-dir> [--pack-id <id>] [--mock]',
            );
            process.exitCode = 1;
            return;
          }
          await runSessionPackCreate(
            runtime,
            {
              sessionId,
              outputDir,
              ...(packId ? { packId } : {}),
            },
            console.log,
          );
          return;
        }
        if (action === 'verify') {
          const packPath = argv[3];
          if (!packPath) {
            console.error('Usage: piwin session pack verify <packPath> [--mock]');
            process.exitCode = 1;
            return;
          }
          await runSessionPackVerify(runtime, packPath, console.log);
          return;
        }
        if (action === 'list') {
          const directory = readOption(argv, '--dir');
          if (!directory) {
            console.error('Usage: piwin session pack list --dir <host-dir> [--mock]');
            process.exitCode = 1;
            return;
          }
          await runSessionPackList(runtime, directory, console.log);
          return;
        }
        console.error(`Unknown pack action: ${action}`);
        console.error('Usage: piwin session pack create|verify|list ...');
        process.exitCode = 1;
        return;
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
        return;
      }
    }

    if (sub === 'list') {
      const projectPath = parseOptionalProject(argv);
      const response = await runtime.handleCommand(
        projectPath
          ? { type: 'session/list', projectPath }
          : { type: 'session/list', scope: { kind: 'general' } },
      );
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const sessions =
        (
          response.data as {
            sessions?: Array<{
              id: string;
              updatedAt: string;
              name?: string;
              isPinned?: boolean;
              lastPreview?: string;
            }>;
          }
        )?.sessions ?? [];
      if (sessions.length === 0) {
        console.log(projectPath ? `(no sessions for ${projectPath})` : '(no general sessions)');
        return;
      }
      for (const session of sessions) {
        const pin = session.isPinned === true ? 'pin' : '   ';
        console.log(
          `${pin}\t${session.id}\t${session.updatedAt}\t${session.name ?? ''}\t${session.lastPreview ?? ''}`,
        );
      }
      return;
    }

    if (sub === 'pin' || sub === 'unpin') {
      const sessionId = argv[2];
      if (!sessionId) {
        console.error(`Usage: piwin session ${sub} <sessionId> [--mock]`);
        process.exitCode = 1;
        return;
      }
      const response = await runtime.handleCommand({
        type: sub === 'pin' ? 'session/pin' : 'session/unpin',
        sessionId,
      });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      console.log(`${sub} ok ${sessionId}`);
      return;
    }

    if (sub === 'queue') {
      const action = argv[2] ?? 'list';
      const sessionId = argv[3];
      if (!sessionId) {
        console.error(
          'Usage: piwin session queue list|edit|cancel|reorder <sessionId> [options] [--mock]',
        );
        process.exitCode = 1;
        return;
      }
      try {
        if (action === 'list') {
          await runSessionQueueList(runtime, sessionId, console.log);
          return;
        }
        const revisionOption = readOption(argv, '--revision');
        const expectedRevision =
          revisionOption === undefined ? undefined : parseCliRevision(revisionOption);
        if (action === 'edit') {
          const queuedTurnId = argv[4];
          const text = readOption(argv, '--text')?.trim();
          if (!queuedTurnId || !text) {
            throw new Error(
              'Usage: piwin session queue edit <sessionId> <queuedTurnId> --text <text> [--revision n] [--mock]',
            );
          }
          const updated = await runSessionQueueEdit(
            runtime,
            sessionId,
            queuedTurnId,
            text,
            expectedRevision,
          );
          console.log(JSON.stringify(updated, null, 2));
          return;
        }
        if (action === 'cancel') {
          const queuedTurnId = argv[4];
          if (!queuedTurnId) {
            throw new Error(
              'Usage: piwin session queue cancel <sessionId> <queuedTurnId> [--revision n] [--mock]',
            );
          }
          const cancelled = await runSessionQueueCancel(
            runtime,
            sessionId,
            queuedTurnId,
            expectedRevision,
          );
          console.log(JSON.stringify(cancelled, null, 2));
          return;
        }
        if (action === 'reorder') {
          const orderedIds = collectPositionals(argv.slice(4), ['--revision']);
          if (orderedIds.length === 0) {
            throw new Error(
              'Usage: piwin session queue reorder <sessionId> <queuedTurnId...> [--revision n] [--mock]',
            );
          }
          const reordered = await runSessionQueueReorder(
            runtime,
            sessionId,
            orderedIds,
            expectedRevision,
          );
          console.log(JSON.stringify(reordered, null, 2));
          return;
        }
        throw new Error(`Unknown queue action: ${action}`);
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
        return;
      }
    }

    if (sub === 'replace') {
      const sessionId = argv[2];
      const runId = argv[3];
      const text = collectPositionals(argv.slice(4), ['--queued-id', '--user-message-id'])
        .join(' ')
        .trim();
      if (!sessionId || !runId || !text) {
        console.error(
          'Usage: piwin session replace <sessionId> <runId> <text> [--queued-id id] [--user-message-id id] [--mock]',
        );
        process.exitCode = 1;
        return;
      }
      try {
        const replaced = await runSessionReplaceRun(runtime, sessionId, runId, text, {
          queuedTurnId: readOption(argv, '--queued-id') ?? randomUUID(),
          userMessageId: readOption(argv, '--user-message-id') ?? randomUUID(),
        });
        console.log(JSON.stringify(replaced, null, 2));
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
      return;
    }

    if (sub === 'pause' || sub === 'resume-run') {
      const sessionId = argv[2];
      if (!sessionId) {
        console.error(
          `Usage: piwin session ${sub} <sessionId>${
            sub === 'pause' ? ' [--run-id <runId>]' : ' [--checkpoint <checkpointId>]'
          } [--mock]`,
        );
        process.exitCode = 1;
        return;
      }
      const runId = readOption(argv, '--run-id');
      const checkpointId = readOption(argv, '--checkpoint');
      const command: HostCommand =
        sub === 'pause'
          ? { type: 'session/pause', sessionId, ...(runId ? { runId } : {}) }
          : { type: 'session/resume-run', sessionId, ...(checkpointId ? { checkpointId } : {}) };
      const response = await runtime.handleCommand(command);
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(response.data ?? {}, null, 2));
      return;
    }

    if (sub === 'search') {
      const queryTokens: string[] = [];
      const args = argv.slice(2);
      for (let index = 0; index < args.length; index += 1) {
        const token = args[index];
        if (!token) continue;
        if (token === '--project' || token === '--mode') {
          index += 1;
          continue;
        }
        if (token === '--mock' || token.startsWith('--')) continue;
        queryTokens.push(token);
      }
      const query = queryTokens.join(' ').trim();
      if (!query) {
        console.error('Usage: piwin session search <query> [--project <path>] [--mock]');
        process.exitCode = 1;
        return;
      }
      const projectPath = parseProject(argv);
      const response = await runtime.handleCommand({
        type: 'session/search',
        query: { query, projectPath, limit: 30 },
      });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const hits =
        (
          response.data as {
            hits?: Array<{
              sessionId: string;
              name?: string;
              snippet?: string;
              isPinned?: boolean;
            }>;
          }
        )?.hits ?? [];
      if (hits.length === 0) {
        console.log('(no hits)');
        return;
      }
      for (const hit of hits) {
        const pin = hit.isPinned === true ? 'pin' : '   ';
        console.log(`${pin}\t${hit.sessionId}\t${hit.name ?? ''}\t${hit.snippet ?? ''}`);
      }
      return;
    }

    if (sub === 'export') {
      const sessionId = argv[2];
      if (!sessionId || sessionId.startsWith('--')) {
        console.error(
          'Usage: piwin session export <id> --format md|html [--redact-tools] [--out <path>] [--mock]',
        );
        process.exitCode = 1;
        return;
      }
      const formatRaw = readOption(argv, '--format') ?? 'md';
      if (formatRaw !== 'md' && formatRaw !== 'html') {
        console.error(`Unsupported format: ${formatRaw} (use md or html)`);
        process.exitCode = 1;
        return;
      }
      const redactTools = hasFlag(argv, '--redact-tools');
      const outOption = readOption(argv, '--out');
      const command: Extract<HostCommand, { type: 'session/export' }> = {
        type: 'session/export',
        sessionId,
        format: formatRaw,
        redactTools,
        ...(outOption ? { outputPath: resolve(outOption) } : {}),
      };
      const response = await runtime.handleCommand(command);
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const data = response.data as {
        path?: string;
        format?: string;
        redactTools?: boolean;
        byteLength?: number;
      };
      console.log(data.path ?? '(export written)');
      if (typeof data.byteLength === 'number') {
        console.error(
          `exported ${data.byteLength} bytes format=${data.format ?? formatRaw}` +
            (data.redactTools ? ' redact-tools' : ''),
        );
      }
      return;
    }

    if (sub === 'branches') {
      const sessionId = argv[2];
      if (!sessionId) {
        console.error('Usage: piwin session branches <sessionId> [--mock]');
        process.exitCode = 1;
        return;
      }
      try {
        await runSessionBranches(runtime, sessionId, console.log);
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
      return;
    }

    if (sub === 'continue') {
      const sessionId = argv[2];
      if (!sessionId) {
        console.error('Usage: piwin session continue <sessionId> [--mock]');
        process.exitCode = 1;
        return;
      }
      try {
        await runSessionContinue(runtime, sessionId, console.log);
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
      return;
    }

    if (sub === 'retry') {
      const sessionId = argv[2];
      const userMessageId = argv[3];
      if (!sessionId || !userMessageId) {
        console.error(
          'Usage: piwin session retry <sessionId> <userMessageId> [--keep] [--confirm] [--mock]',
        );
        process.exitCode = 1;
        return;
      }
      try {
        await runSessionRetry(runtime, sessionId, userMessageId, console.log, {
          keepPrevious: argv.includes('--keep'),
          confirm: argv.includes('--confirm'),
        });
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
      return;
    }

    if (sub === 'switch') {
      const sessionId = argv[2];
      const messageId = argv[3];
      if (!sessionId || !messageId) {
        console.error('Usage: piwin session switch <sessionId> <messageId> [--confirm] [--mock]');
        process.exitCode = 1;
        return;
      }
      try {
        await runSessionSwitch(runtime, sessionId, messageId, console.log, {
          confirm: argv.includes('--confirm'),
        });
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
      return;
    }

    console.error(`Unknown session subcommand: ${sub}`);
    console.error(
      'Usage: piwin session list|pin|unpin|pause|resume-run|queue|replace|search|export|branches|switch|retry|lifecycle|pack|cold',
    );
    process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}
