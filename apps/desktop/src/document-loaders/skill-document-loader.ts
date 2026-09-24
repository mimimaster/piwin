/**
 * `skill` target loader (ADR 0052 §6 split).
 *
 * Two shapes reach here: a logical `skill:<id>` target from a tool card, and a
 * legacy host path (`/…/skills/<id>/SKILL.md`) the Host resolver could not turn
 * into a logical ref. Both prefer the snapshot the agent actually read, then
 * the currently installed resource.
 */
import type { DocumentLoaderContext } from './document-loader-context.js';
import { settleUnavailable, unavailableDocument } from './document-loader-context.js';

export type SkillDocumentLoadInput = {
  skillId?: string | undefined;
  /** Host path for the legacy route (`skills/read` re-resolves it Host-side). */
  absolutePath?: string | undefined;
  /** Title hint (the id parsed out of a legacy path). */
  titleHint?: string | undefined;
};

type SkillReadPayload = {
  status?: string;
  content?: string;
  name?: string;
  skillId?: string;
  displayRef?: string;
  effectiveSource?: string;
  reason?: string;
  suggestion?: string;
};

export async function loadSkillDocument(
  context: DocumentLoaderContext,
  input: SkillDocumentLoadInput,
): Promise<void> {
  const titleHint = input.titleHint?.trim();
  const loaderContext: DocumentLoaderContext =
    titleHint && titleHint.length > 0 ? { ...context, title: titleHint } : context;
  const displayRef = (): string => loaderContext.displayRef;

  const snapshot = await loaderContext.requestToolSnapshot(loaderContext.snapshotRequest);
  if (snapshot) {
    loaderContext.apply({
      status: 'ready',
      requestId: loaderContext.requestId,
      title: loaderContext.title,
      content: snapshot.content,
      displayRef: displayRef() || `skill:${input.skillId ?? ''}`,
      provenance: 'tool-snapshot',
      ...(snapshot.truncated ? { warning: '该次工具输出被截断，只展示部分内容。' } : {}),
    });
    return;
  }

  const skillData = await readSkill(loaderContext, input);
  if (skillData?.status === 'ready' && typeof skillData.content === 'string') {
    loaderContext.apply({
      status: 'ready',
      requestId: loaderContext.requestId,
      title: skillData.name?.trim() || skillData.skillId?.trim() || loaderContext.title,
      content: skillData.content,
      displayRef: skillData.displayRef || displayRef() || `skill:${input.skillId ?? ''}`,
      provenance: 'current-resource',
      ...(skillData.skillId ? { skillId: skillData.skillId } : {}),
      ...(skillData.effectiveSource ? { skillSource: skillData.effectiveSource } : {}),
      warning: '当前安装版本，可能不同于历史读取内容。',
    });
    return;
  }

  if (skillData?.status === 'unavailable') {
    settleUnavailable(
      {
        ...loaderContext,
        title: skillData.skillId || loaderContext.title,
        displayRef: skillData.displayRef || displayRef() || `skill:${input.skillId ?? ''}`,
      },
      {
        reason: skillData.reason || 'unavailable',
        ...(skillData.suggestion ? { suggestion: skillData.suggestion } : {}),
        warning: '展示来自对话记录的恢复内容，非当前 Skill 版本。',
      },
    );
    return;
  }

  loaderContext.apply(
    unavailableDocument(
      { ...loaderContext, displayRef: displayRef() || `skill:${input.skillId ?? ''}` },
      { reason: 'skill-unresolved', suggestion: '打开 Skills 面板或重新同步内置 Skill。' },
    ),
  );
}

async function readSkill(
  context: DocumentLoaderContext,
  input: SkillDocumentLoadInput,
): Promise<SkillReadPayload | null> {
  const response = await context.hostClient.request({
    type: 'skills/read',
    ...(input.skillId ? { skillId: input.skillId } : {}),
    ...(input.absolutePath ? { legacyPath: input.absolutePath } : {}),
    ...(context.projectPath ? { projectPath: context.projectPath } : {}),
  });
  if (!response.success || !response.data) {
    return null;
  }
  return response.data as SkillReadPayload;
}
