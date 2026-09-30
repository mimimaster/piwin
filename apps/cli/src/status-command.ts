import { formatTurnWorkSummary } from './turn-work-summary-format.js';
import type { HostRuntimeResourcesData, HostStatusData, SessionTranscriptPageData } from '@piwin/contracts';
import { openCliHost } from './cli-host.js';
import { formatRuntimeResourcesLines } from './runtime-resources-format.js';
import { formatCapabilityMatrixLines } from '@piwin/contracts';
import { parseMock, parseMode, readOption } from './cli-args.js';

/**
 * `piwin status` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandStatus(argv: string[]): Promise<void> {
  const runtime = await openCliHost({
    mode: parseMode(argv),
    mock: parseMock(argv),
  });
  try {
    const response = await runtime.handleCommand({ type: 'host/status' });
    if (!response.success) {
      console.error(response.error);
      process.exitCode = 1;
      return;
    }
    const data = response.data as HostStatusData;
    console.log('piwin status');
    console.log(`- mode: ${data.mode}`);
    console.log(`- ready: ${data.ready}`);
    console.log(`- mock: ${data.mock}`);
    console.log(`- piwinRoot: ${data.piwinRoot}`);
    console.log(`- activeSessions: ${data.activeSessionIds.join(', ') || '(none)'}`);
    console.log('--- capability matrix ---');
    for (const line of formatCapabilityMatrixLines(data.capabilities, {
      mode: data.mode as 'sdk' | 'rpc',
      mock: data.mock,
    })) {
      console.log(`- ${line}`);
    }
    console.log(
      '- usage: chip/events available after first assistant turn (see usage/update); CLI chat prints [usage] lines',
    );
    const sessionId = readOption(argv, '--session');
    if (argv.includes('--session') && (!sessionId || sessionId.startsWith('--'))) {
      throw new Error('Usage: piwin status --session <sessionId>');
    }
    if (sessionId) {
      const transcript = await runtime.handleCommand({
        type: 'session/transcript-page',
        query: { sessionId, limit: 50, maximumBytes: 256 * 1024 },
      });
      if (!transcript.success) {
        console.error(transcript.error);
        process.exitCode = 1;
        return;
      }
      const page = transcript.data as SessionTranscriptPageData;
      const summary = page.status === 'page' ? page.page.turnSummaries?.at(-1) : undefined;
      console.log('--- latest turn work ---');
      console.log(summary ? formatTurnWorkSummary(summary) : '- complete turn summary unavailable');
    }
    const resources = await runtime.handleCommand({ type: 'host/runtime-resources' });
    if (resources.success) {
      console.log('--- runtime residency ---');
      for (const line of formatRuntimeResourcesLines(resources.data as HostRuntimeResourcesData)) {
        console.log(`- ${line}`);
      }
    } else {
      console.log(`- runtime residency: (unavailable: ${resources.error})`);
    }
  } finally {
    await runtime.dispose();
  }
}
