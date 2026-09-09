import { createMockMediaAsset } from './host-client-mock-assembly.js';
import type { MockHostBackend } from './host-client-mock.js';
import type {
  HostCommand,
  HostResponse,
} from '@piwin/contracts';

export async function handleMockWorkspaceCommands(
  host: MockHostBackend,
  command: HostCommand,
  id: string,
): Promise<HostResponse | null> {
  switch (command.type) {
      case 'project/open': {
        const openedAt = new Date().toISOString();
        const existingProject = host.mockProjects.get(command.path);
        host.mockProjects.set(command.path, {
          path: command.path,
          trust: existingProject?.trust ?? 'untrusted',
          lastOpenedAt: openedAt,
          createdAt: existingProject?.createdAt ?? openedAt,
        });
        if (!host.mockRememberedPermissions.has(command.path)) {
          host.mockRememberedPermissions.set(command.path, [
            {
              key: 'network:web_search',
              action: 'network:web_search',
              detail: 'Web search allowed for this project',
            },
          ]);
        }
        // Report the persisted trust state: re-opening an already-trusted
        // project must not demote it to untrusted (mirrors host behavior).
        const trustState = host.mockProjects.get(command.path)?.trust ?? 'untrusted';
        return {
          id,
          type: 'response',
          command: 'project/open',
          success: true,
          data: {
            path: command.path,
            trusted: trustState === 'trusted',
            trust: trustState,
          },
        };
      }
      case 'project/list':
        return {
          id,
          type: 'response',
          command: 'project/list',
          success: true,
          data: {
            projects: [...host.mockProjects.values()].sort((left, right) =>
              right.lastOpenedAt.localeCompare(left.lastOpenedAt),
            ),
          },
        };
      case 'project/remove': {
        const removed = host.mockProjects.delete(command.path);
        host.mockRememberedPermissions.delete(command.path);
        if (removed) {
          return {
            id,
            type: 'response',
            command: 'project/remove',
            success: true,
            data: { path: command.path, removed: true },
          };
        }
        return {
          id,
          type: 'response',
          command: 'project/remove',
          success: false,
          error: `Project not found: ${command.path}`,
        };
      }
      case 'project/trust':
        {
          const existingProject = host.mockProjects.get(command.path);
          if (existingProject) {
            host.mockProjects.set(command.path, { ...existingProject, trust: 'trusted' });
          }
        }
        return {
          id,
          type: 'response',
          command: 'project/trust',
          success: true,
          data: { path: command.path, trusted: true, trust: 'trusted' },
        };
      case 'project/permissions-list': {
        const pathKey = command.path;
        const perms = host.mockRememberedPermissions.get(pathKey) ?? [];
        return {
          id,
          type: 'response',
          command: 'project/permissions-list',
          success: true,
          data: { projectPath: pathKey, permissions: [...perms] },
        };
      }
      case 'project/permissions-revoke': {
        const pathKey = command.path;
        const key = command.key;
        const current = host.mockRememberedPermissions.get(pathKey) ?? [];
        const next = current.filter((item) => item.key !== key);
        host.mockRememberedPermissions.set(pathKey, next);
        return {
          id,
          type: 'response',
          command: 'project/permissions-revoke',
          success: true,
          data: { projectPath: pathKey, key, ok: true, permissions: next },
        };
      }
      case 'project/list-dir': {
        const relativePath = (command.relativePath ?? '').replace(/^\/+|\/+$/g, '');
        const baseName = command.projectPath.split('/').filter(Boolean).pop() ?? 'project';
        const entries =
          relativePath === ''
            ? [
                {
                  name: 'README.md',
                  relativePath: 'README.md',
                  kind: 'file' as const,
                  sizeBytes: 1200,
                },
                { name: 'src', relativePath: 'src', kind: 'directory' as const },
                {
                  name: 'package.json',
                  relativePath: 'package.json',
                  kind: 'file' as const,
                  sizeBytes: 800,
                },
              ]
            : relativePath === 'src'
              ? [
                  {
                    name: 'index.ts',
                    relativePath: 'src/index.ts',
                    kind: 'file' as const,
                    sizeBytes: 240,
                  },
                ]
              : [];
        return {
          id,
          type: 'response',
          command: 'project/list-dir',
          success: true,
          data: {
            projectPath: command.projectPath,
            relativePath,
            entries,
            mockWorkspace: baseName,
          },
        };
      }
      case 'project/read-file': {
        const relativePath = (command.relativePath ?? '').replace(/^\/+|\/+$/g, '');
        const absolutePath = `${command.projectPath.replace(/\/+$/, '')}/${relativePath}`;
        const lowerName = relativePath.toLowerCase();
        if (/\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/.test(lowerName)) {
          const mimeHint = lowerName.endsWith('.svg')
            ? 'image/svg+xml'
            : lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
              ? 'image/jpeg'
              : lowerName.endsWith('.gif')
                ? 'image/gif'
                : lowerName.endsWith('.webp')
                  ? 'image/webp'
                  : 'image/png';
          // 1×1 transparent PNG — enough for the file-tree image stage to mount.
          const previewDataUrl =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
          return {
            id,
            type: 'response',
            command: 'project/read-file',
            success: true,
            data: {
              projectPath: command.projectPath,
              relativePath,
              absolutePath,
              content: '',
              byteSize: 68,
              truncated: false,
              isBinary: !lowerName.endsWith('.svg'),
              mimeHint,
              previewDataUrl,
            },
          };
        }
        const content = [
          `// mock preview of ${relativePath}`,
          'export function hello() {',
          "  return 'piwin';",
          '}',
          '',
        ].join('\n');
        return {
          id,
          type: 'response',
          command: 'project/read-file',
          success: true,
          data: {
            projectPath: command.projectPath,
            relativePath,
            absolutePath,
            content,
            byteSize: content.length,
            truncated: false,
            isBinary: false,
            mimeHint: 'text/plain',
          },
        };
      }
      case 'speech/transcribe': {
        const model = host.mockConfig.speech?.asr?.defaultModel;
        if (!model) {
          return {
            id,
            type: 'response',
            command: 'speech/transcribe',
            success: false,
            error: 'ASR model is not configured.',
          };
        }
        return {
          id,
          type: 'response',
          command: 'speech/transcribe',
          success: true,
          data: { text: 'Mock transcript', model, durationMs: 1 },
        };
      }
      case 'media/save': {
        return {
          id,
          type: 'response',
          command: 'media/save',
          success: true,
          data: { asset: createMockMediaAsset(command.input) },
        };
      }
      case 'media/save-begin': {
        const uploadId = crypto.randomUUID();
        host.mockMediaUploads.set(uploadId, {
          sessionId: command.input.sessionId,
          mimeType: command.input.mimeType,
          byteSize: command.input.byteSize,
          ...(command.input.name ? { name: command.input.name } : {}),
        });
        return {
          id,
          type: 'response',
          command: 'media/save-begin',
          success: true,
          data: { uploadId, chunkMaxBytes: 384 * 1024 },
        };
      }
      case 'media/save-chunk': {
        if (!host.mockMediaUploads.has(command.input.uploadId)) {
          return {
            id,
            type: 'response',
            command: 'media/save-chunk',
            success: false,
            error: 'media upload is not active',
          };
        }
        return {
          id,
          type: 'response',
          command: 'media/save-chunk',
          success: true,
          data: { uploadId: command.input.uploadId, receivedBytes: 1 },
        };
      }
      case 'media/save-finish': {
        const pending = host.mockMediaUploads.get(command.input.uploadId);
        if (!pending) {
          return {
            id,
            type: 'response',
            command: 'media/save-finish',
            success: false,
            error: 'media upload is not active',
          };
        }
        host.mockMediaUploads.delete(command.input.uploadId);
        return {
          id,
          type: 'response',
          command: 'media/save-finish',
          success: true,
          data: { asset: createMockMediaAsset(pending) },
        };
      }
      case 'media/save-abort': {
        host.mockMediaUploads.delete(command.input.uploadId);
        return {
          id,
          type: 'response',
          command: 'media/save-abort',
          success: true,
          data: { uploadId: command.input.uploadId },
        };
      }
      case 'media/read': {
        const assetId = command.input.assetId;
        const mimeType = assetId.endsWith('.png') ? 'image/png' : 'image/png';
        return {
          id,
          type: 'response',
          command: 'media/read',
          success: true,
          data: {
            status: 'ready',
            assetId,
            sessionId: command.input.sessionId,
            mimeType,
            byteSize: 8,
            base64Data: Buffer.from('mock-media-bytes').toString('base64'),
          },
        };
      }
      case 'media/list': {
        return {
          id,
          type: 'response',
          command: 'media/list',
          success: true,
          data: { items: [], total: 0 },
        };
      }
      case 'media/delete': {
        return {
          id,
          type: 'response',
          command: 'media/delete',
          success: true,
          data: {
            deleted: true,
            sessionId: command.input.sessionId,
            assetId: command.input.assetId,
          },
        };
      }
      case 'preview/read-trusted-text': {
        return {
          id,
          type: 'response',
          command: 'preview/read-trusted-text',
          success: true,
          data: {
            status: 'ready',
            relativePath: command.input.relativePath,
            displayRef: command.input.relativePath,
            content: `# mock trusted text\n\n${command.input.relativePath}\n`,
            byteSize: 32,
            truncated: false,
            readOnly: true,
          },
        };
      }
      case 'preview/export-local-file': {
        const fileName = command.input.absolutePath.split(/[\\/]/).pop() || 'download.bin';
        const mockBytes = new TextEncoder().encode(`mock-export:${command.input.absolutePath}`);
        let binary = '';
        for (const byte of mockBytes) {
          binary += String.fromCharCode(byte);
        }
        return {
          id,
          type: 'response',
          command: 'preview/export-local-file',
          success: true,
          data: {
            status: 'ready',
            fileName,
            mimeType: 'application/octet-stream',
            byteSize: mockBytes.byteLength,
            base64Data: btoa(binary),
          },
        };
      }
      case 'preview/read-local-file': {
        const fileName = command.input.absolutePath.split(/[\\/]/).pop() || 'preview';
        if (/\.(png|jpe?g|gif|webp)$/i.test(fileName)) {
          const extension = fileName.match(/\.[a-z0-9]{1,12}$/iu)?.[0] ?? '.png';
          const assetId = crypto.randomUUID();
          return {
            id,
            type: 'response',
            command: 'preview/read-local-file',
            success: true,
            data: {
              status: 'ready',
              kind: 'media',
              asset: {
                id: assetId,
                sessionId: command.input.sessionId,
                absolutePath: `/tmp/piwin-mock-media/${command.input.sessionId}/${assetId}${extension}`,
                mimeType: 'image/png',
                byteSize: 12,
                createdAt: new Date().toISOString(),
                name: fileName,
              },
            },
          };
        }
        return {
          id,
          type: 'response',
          command: 'preview/read-local-file',
          success: true,
          data: {
            status: 'ready',
            kind: 'text',
            content: `# mock local file\n\n${command.input.absolutePath}\n`,
            byteSize: 32,
            truncated: false,
            readOnly: true,
          },
        };
      }
      case 'git/stage':
      case 'git/unstage':
      case 'git/commit':
      case 'git/branch-create':
      case 'git/stash':
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: {
            result: {
              kind: command.type.replace('git/', ''),
              ok: true,
              message: `mock ${command.type}`,
            },
          },
        };
      case 'git/checkout':
        host.mockGitCurrentBranches.set(command.input.projectPath, command.input.ref);
        return {
          id,
          type: 'response',
          command: 'git/checkout',
          success: true,
          data: {
            result: {
              kind: 'checkout',
              ok: true,
              message: `mock ${command.type}`,
            },
          },
        };
      case 'git/status':
        return {
          id,
          type: 'response',
          command: 'git/status',
          success: true,
          data: {
            snapshot: {
              repository: { rootPath: command.projectPath, isRepository: true },
              branch: {
                currentBranch: host.mockGitCurrentBranches.get(command.projectPath) ?? 'main',
                isDetached: false,
                headCommit: 'abc1234',
                upstreamBranch: 'origin/main',
                ahead: 0,
                behind: 0,
                dirty: true,
              },
              changedFiles: [
                {
                  path: 'README.md',
                  status: 'modified',
                  staged: false,
                  unstaged: true,
                },
              ],
              truncated: false,
              totalChangedFiles: 1,
            },
          },
        };
      case 'git/branch-list':
        return {
          id,
          type: 'response',
          command: 'git/branch-list',
          success: true,
          data: {
            branches: {
              repository: { rootPath: command.projectPath, isRepository: true },
              branches: [
                {
                  name: 'main',
                  current:
                    (host.mockGitCurrentBranches.get(command.projectPath) ?? 'main') === 'main',
                  shortHash: 'abc1234',
                },
                {
                  name: 'feat/demo',
                  current:
                    (host.mockGitCurrentBranches.get(command.projectPath) ?? 'main') ===
                    'feat/demo',
                  shortHash: 'def5678',
                },
              ],
              truncated: false,
              totalBranches: 2,
            },
          },
        };
      case 'git/diff-summary':
        return {
          id,
          type: 'response',
          command: 'git/diff-summary',
          success: true,
          data: {
            summary: {
              repository: { rootPath: command.projectPath, isRepository: true },
              files: [{ path: 'README.md', status: 'modified', additions: 3, deletions: 1 }],
              totalAdditions: 3,
              totalDeletions: 1,
              truncated: false,
              totalFiles: 1,
            },
          },
        };
      case 'git/diff-file': {
        const path = command.path;
        const patch = [
          `diff --git a/${path} b/${path}`,
          `--- a/${path}`,
          `+++ b/${path}`,
          '@@ -1,3 +1,4 @@',
          ' keep',
          '-old line',
          '+new line',
          '+extra line',
          ' tail',
          '',
        ].join('\n');
        return {
          id,
          type: 'response',
          command: 'git/diff-file',
          success: true,
          data: {
            diff: {
              repository: { rootPath: command.projectPath, isRepository: true },
              path,
              scope: command.scope ?? 'combined',
              isBinary: false,
              patch,
              truncated: false,
              additions: 2,
              deletions: 1,
            },
          },
        };
      }
      case 'git/log-graph':
        return {
          id,
          type: 'response',
          command: 'git/log-graph',
          success: true,
          data: {
            graph: {
              repository: { rootPath: command.projectPath, isRepository: true },
              nodes: [
                {
                  hash: 'aaaaaaaaaaaaaaaa',
                  shortHash: 'aaaaaaa',
                  subject: 'Mock commit',
                  authorName: 'piwin',
                  authorDateIso: new Date().toISOString(),
                  parentHashes: [],
                },
              ],
              truncated: false,
            },
          },
        };
      case 'pty/open': {
        const ptyId = crypto.randomUUID();
        const projectPath = command.input.projectPath;
        host.mockPtys.set(ptyId, { projectPath });
        queueMicrotask(() => {
          host.emitPush({
            type: 'pty/output',
            ptyId,
            data: `mock shell @ ${projectPath}\n$ `,
            at: new Date().toISOString(),
          });
        });
        return {
          id,
          type: 'response',
          command: 'pty/open',
          success: true,
          data: {
            pty: {
              id: ptyId,
              projectPath,
              cwd: command.input.cwd ?? projectPath,
              createdAt: new Date().toISOString(),
              status: 'open',
            },
          },
        };
      }
      case 'pty/write': {
        if (!host.mockPtys.has(command.ptyId)) {
          return {
            id,
            type: 'response',
            command: 'pty/write',
            success: false,
            error: `unknown pty ${command.ptyId}`,
          };
        }
        const data = command.data;
        queueMicrotask(() => {
          host.emitPush({
            type: 'pty/output',
            ptyId: command.ptyId,
            data: data.startsWith('\n') ? data : data,
            at: new Date().toISOString(),
          });
          if (data.includes('\n')) {
            host.emitPush({
              type: 'pty/output',
              ptyId: command.ptyId,
              data: `ok\n$ `,
              at: new Date().toISOString(),
            });
          }
        });
        return {
          id,
          type: 'response',
          command: 'pty/write',
          success: true,
          data: { ptyId: command.ptyId },
        };
      }
      case 'pty/resize':
        return {
          id,
          type: 'response',
          command: 'pty/resize',
          success: true,
          data: { ptyId: command.ptyId },
        };
      case 'pty/close': {
        host.mockPtys.delete(command.ptyId);
        queueMicrotask(() => {
          host.emitPush({ type: 'pty/exit', ptyId: command.ptyId, exitCode: 0 });
        });
        return {
          id,
          type: 'response',
          command: 'pty/close',
          success: true,
          data: { ptyId: command.ptyId },
        };
      }
      case 'pty/list': {
        const sessions = [...host.mockPtys.entries()].map(([ptyId, value]) => ({
          id: ptyId,
          projectPath: value.projectPath,
          cwd: value.projectPath,
          createdAt: new Date().toISOString(),
          status: 'open' as const,
        }));
        return { id, type: 'response', command: 'pty/list', success: true, data: { sessions } };
      }
      case 'browser/start': {
        host.mockBrowserUrl = 'about:blank';
        return { id, type: 'response', command: 'browser/start', success: true, data: null };
      }
      case 'browser/navigate': {
        host.mockBrowserUrl = command.url;
        host.emitPush({
          type: 'browser/state',
          url: command.url,
          title: command.url,
          ts: Date.now(),
        });
        return { id, type: 'response', command: 'browser/navigate', success: true, data: null };
      }
      case 'browser/pick-at': {
        const result: import('@piwin/contracts').WebElementPickResult = {
          url: host.mockBrowserUrl ?? 'about:blank',
          selector: 'div.pick-target',
          text: 'Picked element text',
          boundingRect: {
            x: Math.max(0, command.x - 20),
            y: Math.max(0, command.y - 10),
            width: 40,
            height: 20,
          },
        };
        host.emitPush({ type: 'browser/picked', result });
        return {
          id,
          type: 'response',
          command: 'browser/pick-at',
          success: true,
          data: { result },
        };
      }
      case 'browser/screenshot':
        return { id, type: 'response', command: 'browser/screenshot', success: true, data: null };
      case 'browser/stop':
        host.mockBrowserUrl = null;
        return { id, type: 'response', command: 'browser/stop', success: true, data: null };
      case 'browser/restart': {
        const url = host.mockBrowserUrl ?? 'about:blank';
        host.emitPush({
          type: 'browser/state',
          url,
          title: url,
          lifecycle: 'ready',
          mirror: 'streaming',
          generation: 1,
          ts: Date.now(),
        });
        return {
          id,
          type: 'response',
          command: 'browser/restart',
          success: true,
          data: { pageStateLost: true, generation: 1 },
        };
      }
      case 'browser/input':
        return { id, type: 'response', command: 'browser/input', success: true, data: null };
      case 'browser/lock': {
        if (command.owner === 'agent') host.mockBrowserAgentWantsLock = true;
        const owner = command.owner === 'user' ? 'user' : 'agent';
        host.emitPush({
          type: 'browser/controller',
          owner,
          ts: Date.now(),
          ...(host.mockBrowserAgentWantsLock ? { agentWantsLock: true } : {}),
        });
        return { id, type: 'response', command: 'browser/lock', success: true, data: null };
      }
      case 'browser/unlock': {
        const owner =
          command.owner === 'user'
            ? host.mockBrowserAgentWantsLock
              ? 'agent'
              : 'idle'
            : 'idle';
        if (command.owner !== 'user' || !host.mockBrowserAgentWantsLock) {
          host.mockBrowserAgentWantsLock = false;
        }
        host.emitPush({
          type: 'browser/controller',
          owner,
          ts: Date.now(),
          ...(host.mockBrowserAgentWantsLock ? { agentWantsLock: true } : {}),
        });
        return { id, type: 'response', command: 'browser/unlock', success: true, data: null };
      }
      case 'browser/resize':
        return {
          id,
          type: 'response',
          command: 'browser/resize',
          success: true,
          data: { viewport: { width: command.width, height: command.height } },
        };
      case 'browser/back':
        return { id, type: 'response', command: 'browser/back', success: true, data: { ok: true } };
      case 'browser/forward':
        return {
          id,
          type: 'response',
          command: 'browser/forward',
          success: true,
          data: { ok: true },
        };
      case 'browser/new-tab':
        return {
          id,
          type: 'response',
          command: 'browser/new-tab',
          success: true,
          data: {
            tab: {
              pageId: 'p-mock-1',
              url: command.url ?? 'about:blank',
              title: '',
              kind: 'page',
              active: true,
            },
          },
        };
      case 'browser/select-tab':
        return {
          id,
          type: 'response',
          command: 'browser/select-tab',
          success: true,
          data: {
            tab: {
              pageId: command.pageId,
              url: 'about:blank',
              title: '',
              kind: 'page',
              active: true,
            },
          },
        };
      case 'browser/close-tab':
        return { id, type: 'response', command: 'browser/close-tab', success: true, data: { ok: true } };
      case 'browser/dialog':
        return {
          id,
          type: 'response',
          command: 'browser/dialog',
          success: true,
          data: {
            dialog: {
              pageId: 'p-mock-1',
              type: 'alert',
              message: '',
              timedOut: false,
            },
          },
        };

      // --- Walkthrough commands (spec §12) ---------------------------------
    default:
      return null;
  }
}
