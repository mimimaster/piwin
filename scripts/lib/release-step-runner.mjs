/**
 * Runs release steps with output appended to a per-lane log file. Two lanes
 * build at once, so the console only gets start / done / failed lines with
 * durations — the timings are what tells us where a slow release went.
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

const FAILURE_TAIL_LINES = 40;

export class ReleaseStepError extends Error {
  /**
   * @param {string} lane
   * @param {string} step
   * @param {string} detail
   */
  constructor(lane, step, detail) {
    super(`[${lane}] ${step} failed\n${detail}`);
    this.name = 'ReleaseStepError';
    this.lane = lane;
    this.step = step;
  }
}

/**
 * @param {{ lane: string, logPath: string }} options
 */
export function createStepRunner(options) {
  const log = createWriteStream(options.logPath, { flags: 'a' });
  /** @type {{ step: string, seconds: number }[]} */
  const timings = [];

  /**
   * @param {string} step
   * @param {string} command
   * @param {string[]} args
   * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, allowFailure?: boolean }} [spawnOptions]
   * @returns {Promise<{ code: number, output: string }>}
   */
  function run(step, command, args, spawnOptions = {}) {
    const startedAt = Date.now();
    console.log(`[${options.lane}] start ${step}`);
    log.write(`\n===== ${step} =====\n$ ${command} ${args.join(' ')}\n`);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: spawnOptions.cwd,
        env: spawnOptions.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      /** @type {string[]} */
      const chunks = [];
      /** @param {Buffer} chunk */
      const collect = (chunk) => {
        log.write(chunk);
        chunks.push(chunk.toString('utf8'));
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', (error) => {
        reject(new ReleaseStepError(options.lane, step, String(error)));
      });
      child.on('close', (code) => {
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        const output = chunks.join('');
        timings.push({ step, seconds });
        if (code !== 0 && !spawnOptions.allowFailure) {
          console.log(
            `[${options.lane}] failed ${step} after ${seconds}s (log: ${options.logPath})`,
          );
          const tail = output.trimEnd().split('\n').slice(-FAILURE_TAIL_LINES).join('\n');
          reject(new ReleaseStepError(options.lane, step, tail));
          return;
        }
        console.log(`[${options.lane}] done ${step} ${seconds}s`);
        resolve({ code: code ?? 1, output });
      });
    });
  }

  return { run, timings, lane: options.lane, logPath: options.logPath };
}

/** @typedef {ReturnType<typeof createStepRunner>} StepRunner */
