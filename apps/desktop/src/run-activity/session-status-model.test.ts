import { describe, expect, it } from 'vitest';
import { deriveSessionStatusInsights, shortenPathMiddle } from './session-status-model';

describe('deriveSessionStatusInsights', () => {
  it('returns empty insights when no runtime metadata is supplied', () => {
    const empty = deriveSessionStatusInsights(undefined, true);
    expect(empty.hasTopGroup).toBe(false);
    expect(empty.hasAutoDockSignal).toBe(false);
    expect(empty.session).toBeNull();
    expect(empty.prompt).toBeNull();
    expect(empty.plugins).toEqual([]);
  });

  it('prefers human session title and hides machine session ids behind copyId', () => {
    const withTitle = deriveSessionStatusInsights(
      {
        agentId: 'pi',
        sessionId: 'session-mwho0d',
        sessionTitle: '重设计顶栏状态面板',
      },
      true,
    );
    expect(withTitle.session).toEqual({
      title: '重设计顶栏状态面板',
      copyId: 'session-mwho0d',
    });
    // Default prompt alone does not force auto-dock on empty conversations.
    expect(withTitle.prompt?.meta).toBe('默认');
    expect(withTitle.hasAutoDockSignal).toBe(false);

    const machineNameFallback = deriveSessionStatusInsights(
      {
        agentId: 'pi',
        sessionId: 'session-mwho0d',
        sessionTitle: 'session-mwho0d',
        sessionPreview: '<context_ref id="1">x</context_ref> 去掉“会话概述”标题',
      },
      true,
    );
    expect(machineNameFallback.session).toEqual({
      title: '去掉“会话概述”标题',
      copyId: 'session-mwho0d',
    });
  });

  it('derives flat active pi-purge prompt row and external plugin rows', () => {
    const promptPath = '/Users/dev/project/.pi/lean-system.md';
    const insights = deriveSessionStatusInsights(
      {
        agentId: 'pi',
        sessionId: 'sess-123',
        sessionTitle: '性能优化',
        extensionSurface: {
          sessionId: 'sess-123',
          statuses: [
            { key: 'pi-purge', text: 'PURGE · strict' },
            {
              key: 'meta:pi-purge',
              text: JSON.stringify({ on: true, mode: 'strict', source: 'custom', chars: 512 }),
            },
            { key: 'meta:pi-purge-path', text: promptPath },
            { key: 'piwin-surge', text: '规则生效' },
            { key: 'deepseek-cache', text: '命中 88%' },
          ],
          widgets: [],
        },
      },
      true,
    );

    expect(insights.hasAutoDockSignal).toBe(true);
    expect(insights.prompt).toMatchObject({
      engine: 'pi-purge',
      tone: 'override',
      activePath: promptPath,
      meta: shortenPathMiddle(promptPath),
      isMonoMeta: true,
    });
    expect(insights.plugins).toEqual([
      {
        id: 'piwin-surge',
        title: '网络代理 (Surge)',
        meta: '规则生效',
        tone: 'ready',
      },
      {
        id: 'deepseek-cache',
        title: 'DeepSeek 缓存',
        meta: '命中 88%',
        isMonoMeta: true,
        tone: 'ready',
      },
    ]);
  });

  it('summarizes ContextManifest SYSTEM.md and Antigravity plugin row cleanly', () => {
    const piInsights = deriveSessionStatusInsights(
      {
        agentId: 'pi',
        extensionSurface: {
          sessionId: 's2',
          statuses: [
            { key: 'meta:pi-purge', text: JSON.stringify({ on: false, mode: 'strict', source: 'none' }) },
            { key: 'meta:context-prompt', text: JSON.stringify({ sysSrc: 'pi-native', agents: 1 }) },
            { key: 'meta:context-sys-path', text: '/Users/dev/.pi/agent/SYSTEM.md' },
          ],
          widgets: [],
        },
      },
      true,
    );
    expect(piInsights.prompt).toMatchObject({
      engine: 'context-system',
      tone: 'override',
      activePath: '/Users/dev/.pi/agent/SYSTEM.md',
    });

    const agyInsights = deriveSessionStatusInsights(
      {
        agentId: 'antigravity',
        nativeSessionId: 'conv-abc',
        extensionSurface: {
          sessionId: 's3',
          statuses: [
            {
              key: 'meta:agy-purge',
              text: JSON.stringify({ on: true, mode: 'replace', source: 'custom', chars: 320 }),
            },
            {
              key: 'meta:agy-purge-path',
              text: '/Users/dev/.piwin/antigravity-acp/staged-homes/h1/GEMINI.md',
            },
            {
              key: 'meta:agy-account',
              text: JSON.stringify({ id: 'work', label: 'work', isSystem: false, proxy: 'socks5://127.0.0.1:7890' }),
            },
            { key: 'agy-route', text: 'normal' },
            {
              key: 'meta:agy-quota',
              text: JSON.stringify({
                accountId: 'work',
                buckets: [{ id: 'gemini-5h', label: 'Gem 5h', remainingPct: 72, reset: '2h' }],
              }),
            },
          ],
          widgets: [],
        },
      },
      true,
    );

    expect(agyInsights.prompt?.activePath).toBe(
      '/Users/dev/.piwin/antigravity-acp/staged-homes/h1/GEMINI.md',
    );
    expect(agyInsights.plugins).toEqual([
      expect.objectContaining({
        id: 'antigravity',
        title: 'Antigravity 通道',
        meta: 'work · 正常 · 余量 72%',
        tone: 'ready',
      }),
    ]);
  });

  it('displays active custom preset name and customized built-in prompt indicator', () => {
    const presetInsights = deriveSessionStatusInsights(
      {
        agentId: 'pi',
        sessionId: 's4',
        extensionSurface: {
          sessionId: 's4',
          statuses: [
            {
              key: 'meta:context-prompt',
              text: JSON.stringify({
                agents: 1,
                presetId: 'strict-reviewer',
                presetName: '严格代码审查',
                presetMode: 'append',
              }),
            },
          ],
          widgets: [],
        },
      },
      true,
    );
    expect(presetInsights.prompt).toMatchObject({
      engine: 'preset',
      tone: 'override',
      meta: '严格代码审查 · AGENTS ×1',
      isMonoMeta: false,
    });
    expect(presetInsights.hasAutoDockSignal).toBe(true);

    const modDefaultInsights = deriveSessionStatusInsights(
      {
        agentId: 'pi',
        sessionId: 's5',
        extensionSurface: {
          sessionId: 's5',
          statuses: [
            {
              key: 'meta:context-prompt',
              text: JSON.stringify({
                agents: 0,
                builtinMod: true,
              }),
            },
          ],
          widgets: [],
        },
      },
      true,
    );
    expect(modDefaultInsights.prompt).toMatchObject({
      engine: 'default',
      tone: 'override',
      meta: '默认（已修改）',
    });
  });
});
