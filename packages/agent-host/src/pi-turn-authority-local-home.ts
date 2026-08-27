/**
 * Isolated Pi agentDir + cwd for local fake-SSE turn-authority proof.
 * Not a production module.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LOCAL_TURN_IDLE_TIMEOUT_MS = 400;
export const LOCAL_TURN_RETRY_MAX = 1;
export const LOCAL_TURN_RETRY_BASE_DELAY_MS = 20;
export const FIXTURE_PROVIDER_ID = 'fixture';
export const FIXTURE_MODEL_ID = 'fixture-model';
export const FIXTURE_API_KEY_ENV = 'PIWIN_FIXTURE_API_KEY';
export const FIXTURE_API_KEY = 'fixture-key';

export type TurnAuthorityLocalHome = {
  homeDir: string;
  agentDir: string;
  workingDirectory: string;
  close: () => Promise<void>;
};

export async function createTurnAuthorityLocalHome(): Promise<TurnAuthorityLocalHome> {
  const homeDir = join(
    tmpdir(),
    `piwin-turn-authority-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const agentDir = join(homeDir, '.pi', 'agent');
  const workingDirectory = join(homeDir, 'work');
  await mkdir(agentDir, { recursive: true });
  await mkdir(workingDirectory, { recursive: true });
  await writeFile(join(agentDir, 'auth.json'), '{}\n', 'utf8');
  await writeFile(join(agentDir, 'models.json'), '{}\n', 'utf8');
  await writeFile(
    join(agentDir, 'settings.json'),
    `${JSON.stringify(
      {
        httpIdleTimeoutMs: LOCAL_TURN_IDLE_TIMEOUT_MS,
        defaultTools: [],
        retry: {
          enabled: true,
          maxRetries: LOCAL_TURN_RETRY_MAX,
          baseDelayMs: LOCAL_TURN_RETRY_BASE_DELAY_MS,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return {
    homeDir,
    agentDir,
    workingDirectory,
    close: async () => {
      await rm(homeDir, { recursive: true, force: true });
    },
  };
}
