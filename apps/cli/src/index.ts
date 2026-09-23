#!/usr/bin/env node
import { runKbCommand } from './kb-command.js';
import { SideChatHostClient } from './side-chat-command.js';
import { WalkthroughHostClient } from './walkthrough-command.js';
import { formatError } from '@piwin/contracts';
import { commandAuth } from './auth-command.js';
import { commandCards } from './cards-command.js';
import { commandChat } from './chat-command.js';
import { commandConfig } from './config-command.js';
import { commandContext } from './context-command.js';
import { commandCron } from './cron-command.js';
import { commandDocCards } from './doccards-command.js';
import { commandDoctor } from './doctor-command.js';
import { commandExtension } from './extension-command.js';
import { commandHostMode } from './host-mode-command.js';
import { commandHostServe } from './host-serve-command.js';
import { commandMcp } from './mcp-command.js';
import { commandNotes } from './notes-command.js';
import { commandPlugin } from './plugin-command.js';
import { commandPrompt } from './prompt-command.js';
import { commandScheme } from './scheme-command.js';
import { commandSession } from './session-command.js';
import { commandSideChat } from './side-chat-command.js';
import { commandSkill } from './skill-command.js';
import { commandStatus } from './status-command.js';
import { commandStudy } from './study-command.js';
import { commandSubagent } from './subagent-command.js';
import { commandTurn } from './turn-command.js';
import { commandUsage } from './usage-command.js';
import { commandWalkthrough } from './walkthrough-command.js';

function printHelp(): void {
  console.log(`piwin — private coding agent shell

Usage:
  piwin doctor [--repair-transcripts]
  piwin host-mode
  piwin config init
  piwin config show
  piwin session list [--project <path>] [--mock]
  piwin session pin <sessionId> [--mock]
  piwin session unpin <sessionId> [--mock]
  piwin session pause <sessionId> [--run-id <runId>] [--mock]
  piwin session resume-run <sessionId> [--checkpoint <checkpointId>] [--mock]
  piwin session queue list <sessionId> [--mock]
  piwin session queue edit <sessionId> <queuedTurnId> --text <text> [--revision n] [--mock]
  piwin session queue cancel <sessionId> <queuedTurnId> [--revision n] [--mock]
  piwin session queue reorder <sessionId> <queuedTurnId...> [--revision n] [--mock]
  piwin session replace <sessionId> <runId> <text> [--queued-id id] [--user-message-id id] [--mock]
  piwin session search <query> [--project <path>] [--mock]
  piwin session export <id> --format md|html [--redact-tools] [--out <path>] [--mock]
  piwin session branches <sessionId> [--mock]
  piwin session switch <sessionId> <messageId> [--confirm] [--mock]
  piwin session continue <sessionId> [--mock]
  piwin session retry <sessionId> <userMessageId> [--keep] [--confirm] [--mock]
  piwin session lifecycle plan [--mock]
  piwin session pack create <sessionId> --out <host-dir> [--pack-id <id>] [--mock]
  piwin session pack verify <packPath> [--mock]
  piwin session pack list --dir <host-dir> [--mock]
  piwin session cold status [--mock]
  piwin session cold plan [--session <id>] [--mock]
  piwin session cold execute --plan <plan-id> --confirm <digest> [--mock]
  piwin session cold restore <sessionId> [--pack <path>] [--mock]
  piwin session cold import --pack <path> [--mock]
  piwin session cold reconcile [--mock]
  piwin session lifecycle apply --plan <plan-id> [--mock]
  piwin status [--project <path>] [--mock]
  piwin chat <text> [--project <path>] [--mode sdk|rpc] [--mock] [--image <path>] [--permission-mode auto|ask-all|bypass] [--scheme <id>] [--ref <path>…]
  piwin scheme list [--mock]
  piwin scheme show <id> [--mock]
  piwin host serve [--mode sdk|rpc] [--mock] [--test-fixture <name>] [--permission-mode auto|ask-all|bypass]
  piwin skill list [--project <path>]
  piwin skill install --local <dir> | --git <url> [--name <id>]
  piwin skill uninstall <skill-id>
  piwin skill ensure-bundled
  piwin extension list [--project <path>]
  piwin extension ensure-bundled
  piwin extension install --local <file|dir> | --git <url> [--name <id>]
  piwin prompt list [--project <path>]
  piwin mcp list
  piwin mcp validate [path]
  piwin mcp add <id> --command <cmd> [--args a,b] [--env KEY=VAL]
  piwin plugin list
  piwin plugin install --local <dir> | --git <url> | --registry <id> | --bundled <id> [--secret KEY=VAL...]
  piwin plugin uninstall <id>
  piwin plugin registry [--url <url>]
  piwin notes add <content> --title <t> [--collection c] [--tags a,b]
  piwin notes list [--collection c]
  piwin notes search <query> [--limit n] [--tags t1,t2]
  piwin notes show <id> | delete <id> | reindex
  piwin notes pin <query> <noteId...>       (add golden eval case)
  piwin notes eval   (deferred — retrieval now uses the knowledge engine)
  piwin cards add <front> --back <b> [--deck d] [--tags a,b]
  piwin cards list [--deck d] | decks | show <id> | delete <id>
  piwin cards due [--deck d]
  piwin cards review [--deck d]             (interactive FSRS loop)
  piwin cards export [--deck d] [--out <path>]   (Anki TSV)
  piwin cards study <catalog|start|get|claim|checkpoint|next|rate|undo|pause|resume|end|operation>
  piwin study catalog [--query q] [--cursor c] [--limit n] [--deck d]
  piwin study start sequence --item <id> | --sequence <id>
  piwin study start scheduled [--deck d]
  piwin study get <roundId> | claim <roundId> --revision n --epoch n
  piwin study checkpoint <roundId> --revision n --epoch n --entry id --content-version v --face question|answer
  piwin study next|rate|undo|pause|resume|end|operation   (Host snapshot; no tear / no touch)
  piwin doccards scan <folder>
  piwin doccards index <folder>
  piwin doccards retrieve <folder> <query> [--limit n]
  piwin doccards list <folder>
  piwin doccards generate <folder> [--topic t] [--limit n]   (print generation prompt)
  piwin doccards rebind <oldPath> <newPath>
  piwin doccards forget <folder>
  piwin kb list
  piwin kb add <folder> [--name n]
  piwin kb remove <id> [--delete-index]
  piwin kb search <query> [--kb id ...] [--limit n]
  piwin cron list [--mock]
  piwin usage [--project <path> | --global] [--mock]
  piwin auth status | login <kimi-coding|openai-codex|anthropic|xai|github-copilot> | logout <id>
  piwin walkthrough list <session-id>
  piwin walkthrough generate <session-id> <message-id>
  piwin walkthrough export <session-id> <message-id> [--output <path>]
  piwin context <sessionId> [--mock]
  piwin subagent status <runId>
  piwin subagent cancel <runId>
  piwin subagent results <parentSessionId>
  piwin subagent result <resultId>
  piwin turn undo <changeSetId> --expected-version <revision>
  piwin turn redo <changeSetId> --expected-version <revision>
  piwin side-chat list <source-session-id> [--include-archived]
  piwin side-chat open <source-session-id> [--name <name>] [--message <message-id>]
  piwin side-chat sync <side-chat-session-id>
  piwin side-chat send <side-chat-session-id> <text>
  piwin side-chat resume <side-chat-session-id>

Host modes: sdk | rpc
Offline: --mock or PIWIN_MOCK=1
host serve: JSONL IPC on stdin/stdout for desktop sidecar
test fixture: harness-only delayed session; rejected outside NODE_ENV=test
`);
}

/** Positional tokens, excluding flags and the value tokens of the given options. */

/** Explicit --project path, or null when the user did not pass --project. */

/** Legacy helper: --project or process.cwd() for project-bound commands. */

/**
 * Parse the session-level permission mode override (ADR 0019 §3) and emit the
 * stderr warning when the dangerous alias is used. Returns `undefined` when
 * neither flag is present so the configured `config.permissions.mode` applies.
 */

/**
 * Stateful assistant event formatter for the CLI.
 * Accumulates thinking deltas into a block and tool output per tool call.
 */

/**
 * CE-SUB-ORCH: CLI subagent batch observation and cancellation.
 * Usage: piwin subagent status <runId> | cancel <runId>
 */

/**
 * CLI side-chat commands (spec §12).
 * Usage: piwin side-chat list|open|sync|send|resume
 */

/** Same attached/in-process Host as other CLI verbs. Study never opens a second flashcards root. */

/**
 * Build a {@link SideChatHostClient} on the live Host, or an in-process runtime.
 */

/**
 * Build a {@link WalkthroughHostClient} on the live Host, or an in-process runtime.
 * `onPush` is bridged so `generate` can wait for `walkthrough/updated`.
 */

async function main(argv: string[]): Promise<void> {
  const command = argv[0] ?? 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command === 'doctor') {
    await commandDoctor(argv.slice(1));
    return;
  }
  if (command === 'host-mode') {
    await commandHostMode();
    return;
  }
  if (command === 'config') {
    await commandConfig(argv);
    return;
  }
  if (command === 'session') {
    await commandSession(argv);
    return;
  }
  if (command === 'status') {
    await commandStatus(argv);
    return;
  }
  if (command === 'chat') {
    await commandChat(argv);
    return;
  }
  if (command === 'scheme') {
    await commandScheme(argv);
    return;
  }
  if (command === 'skill') {
    await commandSkill(argv);
    return;
  }
  if (command === 'extension') {
    await commandExtension(argv);
    return;
  }
  if (command === 'prompt') {
    await commandPrompt(argv);
    return;
  }
  if (command === 'mcp') {
    await commandMcp(argv);
    return;
  }
  if (command === 'plugin') {
    await commandPlugin(argv);
    return;
  }
  if (command === 'cron') {
    await commandCron(argv);
    return;
  }
  if (command === 'notes') {
    await commandNotes(argv);
    return;
  }
  if (command === 'cards') {
    await commandCards(argv);
    return;
  }
  if (command === 'study') {
    await commandStudy(argv.slice(1));
    return;
  }
  if (command === 'doccards') {
    await commandDocCards(argv);
    return;
  }
  if (command === 'kb') {
    await runKbCommand(argv);
    return;
  }
  if (command === 'host' && argv[1] === 'serve') {
    await commandHostServe(argv);
    return;
  }
  if (command === 'usage') {
    await commandUsage(argv);
    return;
  }
  if (command === 'auth') {
    await commandAuth(argv.slice(1));
    return;
  }
  if (command === 'walkthrough') {
    await commandWalkthrough(argv);
    return;
  }
  if (command === 'context') {
    await commandContext(argv);
    return;
  }
  if (command === 'subagent') {
    await commandSubagent(argv);
    return;
  }
  if (command === 'turn') {
    await commandTurn(argv);
    return;
  }
  if (command === 'side-chat') {
    await commandSideChat(argv);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
