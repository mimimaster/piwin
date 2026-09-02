import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildSettingsDomainMutations, type PiwinConfig } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';

describe('settings to runtime hot apply', () => {
  it('automatically replaces an idle runtime after a Web source switch', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-hot-apply-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot });
    try {
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { scope: { kind: 'general' } },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;

      const readMessages = async (): Promise<Array<{ role: string; text: string }>> => {
        const response = await runtime.handleCommand({ type: 'session/messages', sessionId });
        expect(response.success).toBe(true);
        if (!response.success) throw new Error(response.error);
        return (response.data as { messages: Array<{ role: string; text: string }> }).messages;
      };
      const firstPrompt = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'first question before settings update' },
      });
      expect(firstPrompt.success).toBe(true);
      await vi.waitFor(async () => {
        expect(
          (await readMessages()).filter((message) => message.role === 'assistant'),
        ).toHaveLength(1);
      });

      const beforeResponse = await runtime.handleCommand({ type: 'settings/get' });
      expect(beforeResponse.success).toBe(true);
      if (!beforeResponse.success) throw new Error(beforeResponse.error);
      const before = (
        beforeResponse.data as {
          snapshot: { revision: string; runtimeRevision: string; config: PiwinConfig };
        }
      ).snapshot;
      if (!before.config.web) throw new Error('default Web config missing');
      const nextConfig: PiwinConfig = {
        ...before.config,
        web: {
          ...before.config.web,
          searchProvider: 'cli',
          searchSources: [{ id: 'cli', kind: 'cli', enabled: true }],
        },
      };

      const beforeStatusResponse = await runtime.handleCommand({
        type: 'session/runtime-status',
        sessionId,
      });
      expect(beforeStatusResponse.success).toBe(true);
      if (!beforeStatusResponse.success) throw new Error(beforeStatusResponse.error);
      const beforeStatus = (beforeStatusResponse.data as { status: { generationId?: string } })
        .status;
      expect(beforeStatus.generationId).toBeDefined();

      const applied = await runtime.handleCommand({
        type: 'settings/apply',
        input: {
          expectedRevision: before.revision,
          mutations: buildSettingsDomainMutations(before.config, nextConfig),
        },
      });
      expect(applied.success).toBe(true);
      if (!applied.success) throw new Error(applied.error);
      const targetRevision = (applied.data as { snapshot: { runtimeRevision: string } }).snapshot
        .runtimeRevision;

      await vi.waitFor(async () => {
        const statusResponse = await runtime.handleCommand({
          type: 'session/runtime-status',
          sessionId,
        });
        expect(statusResponse.success).toBe(true);
        if (!statusResponse.success) throw new Error(statusResponse.error);
        const status = (
          statusResponse.data as {
            status: {
              state: string;
              generationId?: string;
              settingsRevision?: string;
              desiredSettingsRevision?: string;
            };
          }
        ).status;
        expect(status.state).toBe('live');
        expect(status.settingsRevision).toBe(targetRevision);
        expect(status.desiredSettingsRevision).toBeUndefined();
        expect(status.generationId).not.toBe(beforeStatus.generationId);
      });

      const assistantCountBeforeReplacementPrompt = (await readMessages()).filter(
        (message) => message.role === 'assistant',
      ).length;
      const replacementPrompt = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'second question after settings update' },
      });
      expect(replacementPrompt.success).toBe(true);
      await vi.waitFor(async () => {
        const assistants = (await readMessages()).filter((message) => message.role === 'assistant');
        expect(assistants.length).toBeGreaterThan(assistantCountBeforeReplacementPrompt);
        expect(assistants.at(-1)?.text).toContain('[piwin-product-history]');
      });
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });

  it('does not reject a cross-provider switch after Desktop composer persistence', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-desktop-revision-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot });
    try {
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { scope: { kind: 'general' } },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;
      const readMessages = async (): Promise<Array<{ role: string; text: string }>> => {
        const response = await runtime.handleCommand({ type: 'session/messages', sessionId });
        expect(response.success).toBe(true);
        if (!response.success) throw new Error(response.error);
        return (response.data as { messages: Array<{ role: string; text: string }> }).messages;
      };

      const firstPrompt = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: {
          text: 'first provider turn',
          model: {
            protocol: 'openai-compatible',
            providerId: 'provider-a',
            modelId: 'model-a',
          },
        },
      });
      expect(firstPrompt.success).toBe(true);
      await vi.waitFor(async () => {
        expect(
          (await readMessages()).filter((message) => message.role === 'assistant'),
        ).toHaveLength(1);
      });

      const beforeResponse = await runtime.handleCommand({ type: 'settings/get' });
      expect(beforeResponse.success).toBe(true);
      if (!beforeResponse.success) throw new Error(beforeResponse.error);
      const before = (
        beforeResponse.data as {
          snapshot: { revision: string; runtimeRevision: string; config: PiwinConfig };
        }
      ).snapshot;
      const applied = await runtime.handleCommand({
        type: 'settings/apply',
        input: {
          expectedRevision: before.revision,
          mutations: [
            {
              kind: 'replace-domain',
              domain: 'desktop',
              value: {
                ...before.config.desktop,
                composerProfile: {
                  model: {
                    protocol: 'openai-compatible',
                    providerId: 'provider-b',
                    modelId: 'model-b',
                  },
                  thinkingLevel: 'high',
                },
              },
            },
          ],
        },
      });
      expect(applied.success).toBe(true);
      if (!applied.success) throw new Error(applied.error);
      const after = (applied.data as { snapshot: { revision: string; runtimeRevision: string } })
        .snapshot;
      expect(after.revision).not.toBe(before.revision);
      expect(after.runtimeRevision).toBe(before.runtimeRevision);

      const secondPrompt = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: {
          text: 'switch to the second provider',
          model: {
            protocol: 'anthropic-compatible',
            providerId: 'provider-b',
            modelId: 'model-b',
          },
        },
      });
      expect(secondPrompt.success, JSON.stringify(secondPrompt)).toBe(true);
      await vi.waitFor(async () => {
        expect(
          (await readMessages()).filter((message) => message.role === 'assistant'),
        ).toHaveLength(2);
      });
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });
});
