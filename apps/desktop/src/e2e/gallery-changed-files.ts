/** Write tools and a canned git summary for the galleries that render FilesChangedBar. */
import type { HostResponse } from '@piwin/contracts';
import type { ToolCardUi } from '../chat-reducer.js';
import type { FilesChangedBarRequest } from '../files-changed-bar.js';

const GALLERY_FILES = [
  { path: 'apps/desktop/src/composer-run-actions.tsx', additions: 64, deletions: 12, status: 'modified' },
  { path: 'apps/desktop/src/styles/inkstone/composer.css', additions: 18, deletions: 23, status: 'modified' },
  { path: 'scripts/probe-computer-use.probe.ts', additions: 100, deletions: 0, status: 'untracked' },
  { path: 'docs/specs/2026-09-15-docking-stage-and-session-drag.md', additions: 6, deletions: 2, status: 'modified' },
  { path: 'apps/desktop/src/legacy-files-strip.tsx', additions: 0, deletions: 41, status: 'deleted' },
] as const;

export const galleryChangedFileTools: readonly ToolCardUi[] = GALLERY_FILES.map((file, index) => ({
  toolCallId: `fc-${index}`,
  toolName: 'edit',
  status: 'done',
  output: 'ok',
  presentation: {
    kind: 'filesystem',
    title: 'edit',
    actionVerb: 'edit',
    changedPaths: [`/workspace/piwin/${file.path}`],
  },
}));

export const galleryChangedFilesRequest: FilesChangedBarRequest = async () =>
  ({
    type: 'response',
    command: 'git/diff-summary',
    success: true,
    data: { summary: { files: GALLERY_FILES.map((file) => ({ ...file })) } },
  }) as unknown as HostResponse;
