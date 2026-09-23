import { openCliHost } from './cli-host.js';
import { hasFlag } from './cli-args.js';

/**
 * `piwin cron` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandCron(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  if (sub !== 'list') {
    console.error('Usage: piwin cron list [--mock]');
    process.exitCode = 1;
    return;
  }
  const mock = hasFlag(argv, '--mock') || process.env.PIWIN_MOCK === '1';
  const runtime = await openCliHost({
    mode: 'sdk',
    mock: mock === true,
  });
  try {
    const response = await runtime.handleCommand({ type: 'cron/list' });
    if (!response.success) {
      console.error(response.error);
      process.exitCode = 1;
      return;
    }
    const jobs = (response.data as { jobs?: Array<Record<string, unknown>> }).jobs ?? [];
    if (jobs.length === 0) {
      console.log('No cron jobs (host-local; no background daemon).');
      return;
    }
    for (const job of jobs) {
      const last = job.lastStatus ? ` last=${job.lastStatus}` : '';
      const when = job.lastRunAt ? ` at=${job.lastRunAt}` : '';
      console.log(
        `${job.id}\t${job.enabled ? 'on' : 'off'}\t${job.schedule}\t${job.name}${last}${when}`,
      );
    }
  } finally {
    await runtime.dispose();
  }
}
