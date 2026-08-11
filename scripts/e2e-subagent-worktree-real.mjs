#!/usr/bin/env node

/**
 * Credentialed multi-process subagent worktree E2E.
 *
 * Uses a temporary Piwin root populated from the user's configured provider
 * references. Secret values are never printed. This script is intentionally
 * not part of the default test gate.
 */
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = join(import.meta.dirname, '..');
const sourcePiwinRoot = join(process.env.HOME ?? '', '.piwin');
const mainModel = {
  protocol: 'openai-compatible',
  providerId: 'custom-openai',
  modelId: 'deepseek-v4-flash',
};
const coderModel = { ...mainModel, modelId: 'grok-4.5' };
const reviewerModel = { ...mainModel, modelId: 'gpt-5.6-luna' };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function git(cwd, ...args) {
  const result = await execFileAsync('git', args, { cwd });
  return result.stdout.trim();
}

async function copyProviderConfiguration(targetRoot) {
  await mkdir(targetRoot, { recursive: true });
  const config = JSON.parse(await readFile(join(sourcePiwinRoot, 'config.json'), 'utf8'));
  const provider = config.providers?.find((candidate) => candidate.id === mainModel.providerId);
  assert(provider, `provider not configured: ${mainModel.providerId}`);
  const apiKeyRef = provider.apiKeyRef;
  assert(typeof apiKeyRef === 'string' && apiKeyRef.length > 0, 'provider apiKeyRef is missing');
  let rawSecret;
  if (apiKeyRef.startsWith('keychain:')) {
    const service = apiKeyRef.slice('keychain:'.length);
    rawSecret = (await execFileAsync('security', ['find-generic-password', '-w', '-s', service]))
      .stdout;
  } else {
    const relativeSecretPath = apiKeyRef.startsWith('file:') ? apiKeyRef.slice(5) : apiKeyRef;
    rawSecret = await readFile(join(sourcePiwinRoot, relativeSecretPath), 'utf8');
  }
  const apiKey = rawSecret
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  assert(apiKey, 'provider credential is empty');
  delete provider.apiKeyRef;
  provider.apiKeyEnv = 'PIWIN_E2E_PROVIDER_KEY';
  await writeFile(join(targetRoot, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  return { PIWIN_E2E_PROVIDER_KEY: apiKey };
}

function createHostClient(child) {
  const pending = new Map();
  const pushes = [];
  const pushWaiters = [];
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });

  // Drain diagnostics so a verbose provider cannot block the subprocess. The
  // harness intentionally does not print them because they may describe local
  // credential configuration.
  child.stderr.resume();
  reader.on('line', (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.type === 'response') {
      const waiter = pending.get(message.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(message.id);
        waiter.resolve(message);
      }
      return;
    }
    const delivered =
      message.type === 'push/batch' ? message.items.map((item) => item.push) : [message];
    for (const push of delivered) {
      pushes.push(push);
      for (let index = pushWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = pushWaiters[index];
        if (waiter.predicate(push)) {
          clearTimeout(waiter.timer);
          pushWaiters.splice(index, 1);
          waiter.resolve(push);
        }
      }
    }
  });

  function request(command, timeoutMs = 30_000) {
    const id = randomUUID();
    child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`response timeout: ${command.type}`));
      }, timeoutMs);
      pending.set(id, { resolve, timer });
    });
  }

  function waitForPush(predicate, timeoutMs = 180_000) {
    const existing = pushes.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = pushWaiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) pushWaiters.splice(index, 1);
        reject(new Error('push timeout'));
      }, timeoutMs);
      pushWaiters.push({ predicate, resolve, timer });
    });
  }

  return {
    request,
    waitForPush,
  };
}

async function waitForBatch(client, runId, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await client.request({ type: 'subagent/batch-status', runId });
    assert(response.success, response.error ?? 'subagent/batch-status failed');
    if (response.data.status !== 'running') return response.data;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`batch timeout: ${runId}`);
}

async function main() {
  const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-real-e2e-root-'));
  const projectPath = await mkdtemp(join(tmpdir(), 'piwin-real-e2e-project-'));
  let child;
  try {
    const providerEnvironment = await copyProviderConfiguration(piwinRoot);
    await git(projectPath, 'init', '-b', 'main');
    await git(projectPath, 'config', 'user.name', 'Piwin E2E');
    await git(projectPath, 'config', 'user.email', 'e2e@piwin.invalid');
    await writeFile(join(projectPath, 'README.md'), '# Snake E2E\n');
    const hookPath = join(projectPath, '.git', 'hooks', 'pre-commit');
    await writeFile(hookPath, '#!/bin/sh\necho "commits disabled in worktree E2E" >&2\nexit 1\n');
    await chmod(hookPath, 0o755);
    await git(projectPath, 'add', 'README.md');
    await git(projectPath, 'commit', '--no-verify', '-m', 'base');

    child = spawn(
      'pnpm',
      [
        '--filter',
        '@piwin/cli',
        'exec',
        'tsx',
        'src/index.ts',
        'host',
        'serve',
        '--mode',
        'rpc',
        '--permission-mode',
        'bypass',
      ],
      {
        cwd: repositoryRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...providerEnvironment,
          PIWIN_ROOT: piwinRoot,
          PIWIN_MOCK: '0',
          PIWIN_AGENT_WORKER_SCRIPT: join(repositoryRoot, 'dist-host', 'agent-worker.mjs'),
        },
      },
    );
    const client = createHostClient(child);
    await client.waitForPush((push) => push.type === 'host/status' && push.ready === true, 30_000);

    for (const command of [
      { type: 'project/open', path: projectPath },
      { type: 'project/trust', path: projectPath },
    ]) {
      const response = await client.request(command);
      assert(response.success, response.error ?? `${command.type} failed`);
    }

    const createResponse = await client.request({
      type: 'session/create',
      input: {
        scope: { kind: 'project', projectPath },
        sessionName: 'real-e2e-main-deepseek',
        model: mainModel,
        thinkingLevel: 'max',
      },
    });
    assert(createResponse.success, createResponse.error ?? 'main session creation failed');
    const parentSessionId = createResponse.data.sessionId;

    const promptResponse = await client.request({
      type: 'session/prompt',
      sessionId: parentSessionId,
      input: { text: 'Reply with exactly MAIN_READY. Do not call tools.' },
    });
    assert(promptResponse.success, promptResponse.error ?? 'main prompt failed');
    const parentRunId = promptResponse.data.runId;
    const mainTerminal = await client.waitForPush(
      (push) => push.type === 'run/terminal' && push.run?.runId === parentRunId,
      180_000,
    );
    assert(mainTerminal.run.status === 'completed', `main run ended ${mainTerminal.run.status}`);

    const coderStart = await client.request({
      type: 'subagent/batch-start',
      request: {
        parentSessionId,
        maxConcurrency: 1,
        tasks: [
          {
            id: 'snake-coder',
            parentSessionId,
            task: 'Create a complete browser Snake game in the current worktree. Create index.html, game.js, styles.css and update README.md. Include keyboard and touch controls, scoring, collision/game-over, and restart. Collision must allow moving into the current tail cell when the snake is not eating. Accept at most one direction change per game tick and reject any queued 180-degree reversal relative to the actual movement direction. D-pad restart behavior must be deterministic. Verify syntax. Do not run git commit; leave all changes uncommitted. Finish with a concise summary.',
            profileId: 'implementer',
            model: coderModel,
            thinkingLevel: 'high',
            isolationOverride: 'worktree',
            applyPolicy: 'auto',
            allowedOutputPaths: ['index.html', 'game.js', 'styles.css', 'README.md'],
          },
        ],
      },
    });
    assert(coderStart.success, coderStart.error ?? 'coder batch start failed');
    const coderBatch = await waitForBatch(client, coderStart.data.runId);
    const coderResult = coderBatch.results[0];
    assert(
      coderBatch.status === 'completed',
      `coder batch status=${coderBatch.status}; result=${JSON.stringify(coderResult)}`,
    );
    assert(coderResult?.executionStatus === 'completed', 'coder execution did not complete');
    assert(
      coderResult?.integrationStatus === 'applied',
      `coder integration=${coderResult?.integrationStatus}`,
    );
    assert(!coderResult?.error, `coder result error=${coderResult?.error}`);

    for (const file of ['index.html', 'game.js', 'styles.css', 'README.md']) {
      const content = await readFile(join(projectPath, file), 'utf8');
      assert(content.length > 20, `${file} was not generated`);
    }
    await execFileAsync('node', ['--check', join(projectPath, 'game.js')]);
    assert(
      (await git(projectPath, 'diff', '--cached', '--name-only')) === '',
      'parent index was modified',
    );
    assert(
      (await git(projectPath, 'worktree', 'list', '--porcelain'))
        .split('\n')
        .filter((line) => line.startsWith('worktree ')).length === 1,
      'coder worktree was not cleaned',
    );
    assert(
      (await git(projectPath, 'branch', '--list', 'piwin/subagent/*')) === '',
      'coder branch was not cleaned',
    );
    console.log('coder integration passed: parent index preserved; worktree and branch cleaned');

    const reviewerStart = await client.request({
      type: 'subagent/batch-start',
      request: {
        parentSessionId,
        maxConcurrency: 1,
        tasks: [
          {
            id: 'snake-reviewer',
            parentSessionId,
            task: 'Review the integrated Snake game in the project. Inspect index.html, game.js, styles.css and README.md. Check keyboard/touch controls, score, collision/game-over, restart and obvious syntax defects. Do not modify files. End with REVIEW_ACCEPTED if it passes, otherwise REVIEW_REJECTED and concrete reasons.',
            profileId: 'reviewer',
            model: reviewerModel,
            thinkingLevel: 'low',
            isolationOverride: 'readonly',
            applyPolicy: 'none',
          },
        ],
      },
    });
    assert(reviewerStart.success, reviewerStart.error ?? 'reviewer batch start failed');
    const reviewerBatch = await waitForBatch(client, reviewerStart.data.runId);
    const reviewerResult = reviewerBatch.results[0];
    assert(reviewerBatch.status === 'completed', `reviewer batch status=${reviewerBatch.status}`);
    assert(reviewerResult?.executionStatus === 'completed', 'reviewer execution did not complete');
    assert(
      reviewerResult?.summaryPreview?.includes('REVIEW_ACCEPTED'),
      `reviewer did not accept: ${reviewerResult?.summaryPreview ?? '(no summary)'}`,
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          mainModel: mainModel.modelId,
          coderModel: coderModel.modelId,
          coderIntegration: coderResult.integrationStatus,
          reviewerModel: reviewerModel.modelId,
          reviewerAccepted: true,
          parentIndexPreserved: true,
          worktreeCleaned: true,
          branchCleaned: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (child) {
      child.stdin.end();
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    await rm(piwinRoot, { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `real subagent E2E failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
