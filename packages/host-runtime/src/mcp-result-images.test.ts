import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMcpLifecycleManager, saveMcpConfig } from '@piwin/mcp';
import { buildCachedMcpToolDefinitions } from './mcp-cached-tool-definitions.js';
import { createToolCatalogService } from './tool-catalog/catalog-service.js';
import { buildHostToolboxRegistration } from './tool-catalog/catalog-tool.js';
import { createSessionHostToolExecutionPort } from './tools/session-host-tool-port.js';
import { createPermissiveToolAdmission } from './tools/tool-admission.js';

const IMAGE_DATA = 'c2NyZWVuc2hvdA==';

describe('MCP native screenshot results', () => {
  for (const route of ['toolbox', 'pinned'] as const) {
    for (const text of ['Calculator state', undefined]) {
      it(`preserves ${text ? 'mixed' : 'image-only'} content through ${route}`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'piwin-mcp-images-'));
        const manager = createMcpLifecycleManager(root);
        const config = { command: process.execPath };
        const document = {
          mcpServers: { computer: config },
          pinnedSelectors: ['computer.get_app_state'],
        };
        try {
          await saveMcpConfig(root, document);
          await manager.getMetadataCatalog().replaceServerMetadata('computer', config, [{
            name: 'get_app_state',
            description: 'Inspect app state and screenshot',
            inputSchema: { type: 'object' },
          }]);
          vi.spyOn(manager, 'callTool').mockResolvedValue({
            content: [
              ...(text ? [{ type: 'text', text }] : []),
              { type: 'image', mimeType: 'image/png', data: IMAGE_DATA },
            ],
          });
          const signal = new AbortController().signal;
          const result = route === 'toolbox'
            ? await (async () => {
              const catalog = createToolCatalogService({ lifecycleManager: manager });
              const port = createSessionHostToolExecutionPort({
                isSessionKnown: () => true,
                getRuntimeGenerationId: () => 'generation',
                isRunAdmitted: () => true,
              });
              port.registerActiveGeneration('session', 'generation', [
                buildHostToolboxRegistration([], { catalog }),
              ], createPermissiveToolAdmission());
              port.restrictGeneration('session', 'generation', ['piwin_toolbox'], [], true);
              return port.execute({
                sessionId: 'session', runtimeGenerationId: 'generation', runId: 'run',
                toolCallId: 'screenshot', toolName: 'piwin_toolbox',
                arguments: { action: 'call', target: 'computer.get_app_state', arguments: {} },
              }, signal);
            })()
            : await (async () => {
              const { tools } = await buildCachedMcpToolDefinitions({
                lifecycleManager: manager,
                mcpConfig: document,
              });
              const tool = tools[0];
              if (!tool) throw new Error('Expected pinned screenshot tool');
              return tool.execute({}, signal, {
                sessionId: 'session', runtimeGenerationId: 'generation', runId: 'run',
                toolName: tool.descriptor.name,
              });
            })();

          expect(result.ok).toBe(true);
          if (!result.ok) throw new Error(result.message);
          expect(result.images).toEqual([{ mimeType: 'image/png', dataBase64: IMAGE_DATA }]);
          expect(result.output).not.toContain(IMAGE_DATA);
          if (text) expect(result.output).toBe(text);
          expect(result.details).toEqual({ selector: 'computer.get_app_state' });
        } finally {
          await manager.dispose();
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
});
