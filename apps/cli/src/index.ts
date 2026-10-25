#!/usr/bin/env node
import './node-version-guard.js';
import { formatError } from '@piwin/contracts';
import { isPrintFlag, printModeArgv, readPrintStdin, takeStdinMode } from './print-mode.js';

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
  piwin sessions search <query>   (alias of session search)
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
  piwin status [--project <path>] [--session <id>] [--mock]
  piwin -p <text> [chat options] [-|--no-stdin]   (same as chat; piped stdin is appended to the prompt if it arrives within 200ms; '-' waits for all of stdin, --no-stdin ignores it)
  piwin chat <text> [--project <path>] [--mode sdk|rpc] [--agent pi|grok] [--mock] [--image <path>] [--permission-mode auto|ask-all|bypass|unrestricted] [--scheme <id>] [--ref <path>…] [--output-format text|json|stream-json]
  piwin tui [--session <id>] [--continue|-c] [--resume|-r [id]] [--project <projectId> | --project-path <dir>] [--embedded] [--agent <id>] [--mock]
  piwin scheme list [--mock]
  piwin scheme show <id> [--mock]
  piwin host serve [--mode sdk|rpc] [--mock] [--test-fixture <name>] [--permission-mode auto|ask-all|bypass|unrestricted]
  piwin pair '<piwin://pair?v=3…>' [--alias <name>]     (pair this CLI with a Host; ADR 0101)
  piwin hosts list | use <host>|--local | alias <host> <name> | forget <host>
  piwin host pair [--operator]                         (on the attached Host)
  piwin relay status | configure --url <wss://…> [--enroll-token t] | --off | legacy full|migrate-only|off
  piwin relay user create|rename <name> | enrollment-line | export | import <bundle|@file>
  (attach: PIWIN_HOST=<alias|hostId>, or PIWIN_HOST_URL=ws://127.0.0.1:<port> on the Host's machine)
  piwin skill list [--project <path>]
  piwin skill install skills.sh:<owner>/<repo>/<skill> | --local <dir> | --git <url> [--name <id>]
  piwin skill update <skill-id>
  piwin skill uninstall <skill-id>
  piwin skill ensure-bundled
  piwin extension list [--project <path>]
  piwin extension ensure-bundled
  piwin extension install --local <file|dir> | --git <url> [--name <id>] | --registry <owner/name>
  piwin market search [query] [--type extension|skill|mcp]
  piwin market show <entry-id>
  piwin market installed [--session <id>] [--project <path>]
  piwin market uninstall-extension <extension-id> | remove-mcp <server-id>
  piwin prompt list [--project <path>]
  piwin mcp list
  piwin mcp validate [path]
  piwin mcp add <id> --command <cmd> [--args a,b] [--env KEY=VAL]
  piwin plugin list
  piwin plugin install --local <dir> | --git <url> | --registry <id> | --bundled <id> [--secret KEY=VAL...]
  piwin plugin uninstall <id>
  piwin plugin registry [--url <url>]
  piwin agents list [--mock]
  piwin agents check [--agent <id>] [--mock]
  piwin agents enable|disable|uninstall --agent <id>
  piwin agents login [--agent <id>] [--mock]
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

async function main(argv: string[]): Promise<void> {
  if (isPrintFlag(argv[0])) {
    // `piwin -p <text>`: the script-friendly spelling of `piwin chat`.
    const { argv: printArgv, mode } = takeStdinMode(argv);
    argv = printModeArgv(printArgv, await readPrintStdin(process.stdin, mode));
  }
  const command = argv[0] ?? 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command === 'doctor') {
    const { commandDoctor } = await import('./doctor-command.js');
    await commandDoctor(argv.slice(1));
    return;
  }
  if (command === 'host-mode') {
    const { commandHostMode } = await import('./host-mode-command.js');
    await commandHostMode();
    return;
  }
  if (command === 'config') {
    const { commandConfig } = await import('./config-command.js');
    await commandConfig(argv);
    return;
  }
  if (command === 'session' || command === 'sessions') {
    const { commandSession } = await import('./session-command.js');
    await commandSession(argv);
    return;
  }
  if (command === 'status') {
    const { commandStatus } = await import('./status-command.js');
    await commandStatus(argv);
    return;
  }
  if (command === 'chat') {
    const { commandChat } = await import('./chat-command.js');
    await commandChat(argv);
    return;
  }
  if (command === 'tui') {
    const { commandTui } = await import('./tui/tui-command.js');
    await commandTui(argv);
    return;
  }
  if (command === 'scheme') {
    const { commandScheme } = await import('./scheme-command.js');
    await commandScheme(argv);
    return;
  }
  if (command === 'skill') {
    const { commandSkill } = await import('./skill-command.js');
    await commandSkill(argv);
    return;
  }
  if (command === 'extension') {
    const { commandExtension } = await import('./extension-command.js');
    await commandExtension(argv);
    return;
  }
  if (command === 'market') {
    const { commandMarket } = await import('./market-command.js');
    await commandMarket(argv);
    return;
  }
  if (command === 'prompt') {
    const { commandPrompt } = await import('./prompt-command.js');
    await commandPrompt(argv);
    return;
  }
  if (command === 'mcp') {
    const { commandMcp } = await import('./mcp-command.js');
    await commandMcp(argv);
    return;
  }
  if (command === 'plugin') {
    const { commandPlugin } = await import('./plugin-command.js');
    await commandPlugin(argv);
    return;
  }
  if (command === 'agents') {
    const { commandAgents } = await import('./agents-command.js');
    await commandAgents(argv);
    return;
  }
  if (command === 'cron') {
    const { commandCron } = await import('./cron-command.js');
    await commandCron(argv);
    return;
  }
  if (command === 'notes') {
    const { commandNotes } = await import('./notes-command.js');
    await commandNotes(argv);
    return;
  }
  if (command === 'cards') {
    const { commandCards } = await import('./cards-command.js');
    await commandCards(argv);
    return;
  }
  if (command === 'study') {
    const { commandStudy } = await import('./study-command.js');
    await commandStudy(argv.slice(1));
    return;
  }
  if (command === 'doccards') {
    const { commandDocCards } = await import('./doccards-command.js');
    await commandDocCards(argv);
    return;
  }
  if (command === 'kb') {
    const { runKbCommand } = await import('./kb-command.js');
    await runKbCommand(argv);
    return;
  }
  if (command === 'pair') {
    const { commandPair } = await import('./remote-host-command.js');
    process.exitCode = await commandPair(argv);
    return;
  }
  if (command === 'hosts') {
    const { commandHosts } = await import('./remote-host-command.js');
    process.exitCode = await commandHosts(argv);
    return;
  }
  if (command === 'relay' || (command === 'host' && argv[1] === 'pair')) {
    const { commandRelay } = await import('./relay-command.js');
    process.exitCode = await commandRelay(argv);
    return;
  }
  if (command === 'host' && argv[1] === 'serve') {
    const { commandHostServe } = await import('./host-serve-command.js');
    await commandHostServe(argv);
    return;
  }
  if (command === 'usage') {
    const { commandUsage } = await import('./usage-command.js');
    await commandUsage(argv);
    return;
  }
  if (command === 'auth') {
    const { commandAuth } = await import('./auth-command.js');
    await commandAuth(argv.slice(1));
    return;
  }
  if (command === 'walkthrough') {
    const { commandWalkthrough } = await import('./walkthrough-command.js');
    await commandWalkthrough(argv);
    return;
  }
  if (command === 'context') {
    const { commandContext } = await import('./context-command.js');
    await commandContext(argv);
    return;
  }
  if (command === 'subagent') {
    const { commandSubagent } = await import('./subagent-command.js');
    await commandSubagent(argv);
    return;
  }
  if (command === 'turn') {
    const { commandTurn } = await import('./turn-command.js');
    await commandTurn(argv);
    return;
  }
  if (command === 'side-chat') {
    const { commandSideChat } = await import('./side-chat-command.js');
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
