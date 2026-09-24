/**
 * Local planning fallback for a raw path (ADR 0052 §6).
 *
 * The Host is the interpreter now (`preview/resolve-path`). This module is what
 * runs when it is not available — an older Host that answers "Unhandled
 * command", or a shell that is offline and can only recover from the
 * transcript. It keeps the pre-resolution routing so nothing regresses for
 * those cases, and it never invents a project root from `dirname()`.
 */
import { localPreviewPathForPlan, planDocumentOpenPath } from '../document-open-path.js';
import { projectRelativeAliasForPath } from '../resolve-project-file.js';
import type { DocumentLoaderContext } from './document-loader-context.js';
import { beginLoading, settleUnavailable } from './document-loader-context.js';
import { loadLocalFileDocument } from './local-file-document-loader.js';
import { loadProjectDocument } from './project-document-loader.js';
import { loadSkillDocument } from './skill-document-loader.js';
import { loadTrustedConfigDocument } from './trusted-config-document-loader.js';
import { vaultMediaDocument, unresolvableRemoteAssetDocument } from './media-document-loader.js';

export type LegacyOpenInput = {
  context: DocumentLoaderContext;
  /** Raw clicked text (scheme already stripped by the caller). */
  cleanPath: string;
  /** Host config root, used only to classify trusted-config text locally. */
  piwinRoot?: string | null | undefined;
  /** True for `.svg` / `.html` chips: their miss is a not-found, not outside. */
  markupChip: boolean;
};

export function openViaLegacyPlanner(input: LegacyOpenInput): void {
  const { context, cleanPath } = input;
  const plan = planDocumentOpenPath({
    path: cleanPath,
    projectPath: context.projectPath,
    ...(input.piwinRoot ? { configRoot: input.piwinRoot } : {}),
  });

  if (plan.kind === 'media') {
    // A bare `remote-asset:<id>` carries no session identity, so it cannot be
    // fetched — structured media targets are the correct remote path.
    context.apply(
      plan.assetId !== null
        ? unresolvableRemoteAssetDocument({ ...context, displayRef: cleanPath })
        : vaultMediaDocument({ ...context, displayRef: cleanPath }, plan.absolutePath),
    );
    return;
  }

  if (plan.kind === 'trusted-config') {
    const scoped = { ...context, displayRef: plan.displayPath };
    beginLoading(scoped);
    void loadTrustedConfigDocument(scoped, { relativePath: plan.relativePath });
    return;
  }

  if (plan.kind === 'project' && plan.relativePath) {
    const scoped = { ...context, displayRef: cleanPath };
    beginLoading(scoped);
    void loadProjectDocument(scoped, {
      relativePath: plan.relativePath,
      absolutePath: localPreviewPathForPlan(plan),
    });
    return;
  }

  if (plan.kind === 'skill-legacy') {
    const scoped = { ...context, displayRef: cleanPath };
    beginLoading(scoped);
    void loadSkillDocument(scoped, {
      ...(plan.skillIdHint ? { skillId: plan.skillIdHint } : {}),
      absolutePath: plan.absolutePath,
      ...(plan.skillIdHint ? { titleHint: plan.skillIdHint } : {}),
    });
    return;
  }

  if (plan.kind === 'legacy-absolute' && context.activeSessionId) {
    const scoped = { ...context, displayRef: cleanPath };
    beginLoading(scoped);
    void openAbsolutePath(scoped, plan.absolutePath);
    return;
  }

  settleUnavailable(context, {
    reason: input.markupChip || plan.kind === 'empty' ? 'not-found' : 'outside-project',
    ...(input.markupChip || plan.kind === 'empty'
      ? {}
      : {
          suggestion:
            '该位置不在当前工作区内。会话媒体会直接预览；受信配置请通过工具卡中的文档目标打开。其余路径可在访达中显示。',
        }),
    warning: '展示来自对话记录的恢复内容。',
  });
}

/**
 * An absolute path outside the workspace: try it on the local Host first, then
 * retry inside the project when the chip names *this* workspace through another
 * form (`/tmp/proj/a.md` for a root of `/private/tmp/proj`).
 */
async function openAbsolutePath(
  context: DocumentLoaderContext,
  absolutePath: string,
): Promise<void> {
  const outcome = await loadLocalFileDocument(context, {
    absolutePath,
    transcriptFallback: false,
  });
  if (outcome === 'ready') {
    return;
  }
  const aliasRelative = projectRelativeAliasForPath(absolutePath, context.projectPath);
  if (!context.projectPath || !aliasRelative) {
    return;
  }
  // Nothing settles here: if the project has no answer either, the reason from
  // the local ingest is the honest one.
  await loadProjectDocument(context, {
    relativePath: aliasRelative,
    allowLocalFileFallback: false,
    settle: false,
  });
}
