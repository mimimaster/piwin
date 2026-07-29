import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { maybeAutoNameSession } from './session-naming-service.js';
import { saveSessionIndex } from '@piwin/session';
import type {
  OpenAiCompatibleProviderConfig,
  SessionIndexRecord,
  HostPush,
  ModelProviderConfig,
} from '@piwin/contracts';
import type { SecretResolver } from './secret-resolver.js';

const provider: OpenAiCompatibleProviderConfig = {
  id: 'openai',
  protocol: 'openai-compatible',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  models: [{ id: 'gpt-4o-mini' }],
};

const secretResolver: SecretResolver = {
  resolveProviderSecret: async () => 'sk-test',
  reportProviderSecret: async () => ({ providerId: 'openai', status: 'ok' }),
  writeProviderSecret: async () => 'keychain:x',
  readProviderSecret: async () => null,
};

function mockFetchTitle(title: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: title } }] }),
    } as unknown as Response),
  );
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-naming-'));
  await mkdir(join(root, 'sessions-index'), { recursive: true });
  return root;
}

async function seedSession(
  root: string,
  record: Partial<SessionIndexRecord> & { id: string },
): Promise<void> {
  const indexPath = join(root, 'sessions-index', 'index.json');
  const base: SessionIndexRecord = {
    projectPath: '/p',
    scope: { kind: 'project', projectPath: '/p' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 2,
    ...record,
  };
  await saveSessionIndex(indexPath, { version: 2, sessions: [base] });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('maybeAutoNameSession', () => {
  it('writes LLM title and pushes name-updated when nameSource is default', async () => {
    const root = await makeRoot();
    await seedSession(root, { id: 's1', messageCount: 2 });
    mockFetchTitle('Fix login bug');
    const pushes: HostPush[] = [];
    await maybeAutoNameSession({
      piwinRoot: root,
      sessionId: 's1',
      firstMessage: 'Fix the login bug',
      assistantReply: 'I will fix it',
      modelRef: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4o-mini' },
      providers: [provider],
      secretResolver,
      push: (msg) => pushes.push(msg),
    });
    expect(pushes).toContainEqual({
      type: 'session/name-updated',
      sessionId: 's1',
      name: 'Fix login bug',
      nameSource: 'auto',
    });
  });

  it('does NOT push or write when nameSource is user', async () => {
    const root = await makeRoot();
    await seedSession(root, { id: 's1', name: 'my name', nameSource: 'user' });
    mockFetchTitle('auto attempt');
    const pushes: HostPush[] = [];
    await maybeAutoNameSession({
      piwinRoot: root,
      sessionId: 's1',
      firstMessage: 'hello',
      modelRef: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4o-mini' },
      providers: [provider],
      secretResolver,
      push: (msg) => pushes.push(msg),
    });
    expect(pushes).toEqual([]);
  });

  it('falls back to text-derived name when LLM fetch fails', async () => {
    const root = await makeRoot();
    await seedSession(root, { id: 's1', messageCount: 2 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const pushes: HostPush[] = [];
    await maybeAutoNameSession({
      piwinRoot: root,
      sessionId: 's1',
      firstMessage: 'Refactor the auth module',
      modelRef: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4o-mini' },
      providers: [provider],
      secretResolver,
      push: (msg) => pushes.push(msg),
    });
    expect(pushes).toContainEqual({
      type: 'session/name-updated',
      sessionId: 's1',
      name: 'Refactor the auth module',
      nameSource: 'auto',
    });
  });

  it('skips when autoName config is false', async () => {
    const root = await makeRoot();
    await seedSession(root, { id: 's1', messageCount: 2 });
    await writeFile(join(root, 'config.json'), JSON.stringify({ session: { autoName: false } }));
    mockFetchTitle('should not be called');
    const pushes: HostPush[] = [];
    await maybeAutoNameSession({
      piwinRoot: root,
      sessionId: 's1',
      firstMessage: 'hello',
      modelRef: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4o-mini' },
      providers: [provider],
      secretResolver,
      push: (msg) => pushes.push(msg),
    });
    expect(pushes).toEqual([]);
  });

  it('falls back to text-derived name when no modelRef provided', async () => {
    const root = await makeRoot();
    await seedSession(root, { id: 's1', messageCount: 2 });
    const pushes: HostPush[] = [];
    await maybeAutoNameSession({
      piwinRoot: root,
      sessionId: 's1',
      firstMessage: 'Debug the parser issue',
      providers: [provider],
      secretResolver,
      push: (msg) => pushes.push(msg),
    });
    expect(pushes).toContainEqual({
      type: 'session/name-updated',
      sessionId: 's1',
      name: 'Debug the parser issue',
      nameSource: 'auto',
    });
  });
});
