/**
 * Render a `DocumentTargetRef` (ADR 0052 §6).
 *
 * Every click ends here: a tool card's logical target, or the target the Host
 * derived from a raw path. One place decides which loader runs, and each loader
 * owns one resource family.
 */
import type { DocumentTargetRef } from '@piwin/contracts';
import {
  beginLoading,
  unavailableDocument,
  type DocumentLoaderContext,
} from './document-loaders/document-loader-context.js';
import { loadLocalFileDocument } from './document-loaders/local-file-document-loader.js';
import { loadMediaTargetDocument } from './document-loaders/media-document-loader.js';
import { loadProjectDocument } from './document-loaders/project-document-loader.js';
import { loadSkillDocument } from './document-loaders/skill-document-loader.js';
import { loadTrustedConfigDocument } from './document-loaders/trusted-config-document-loader.js';

export function dispatchDocumentTarget(
  context: DocumentLoaderContext,
  target: DocumentTargetRef,
): void {
  switch (target.kind) {
    case 'media': {
      const displayRef = context.displayRef || `media:${target.assetId}`;
      const scoped = { ...context, displayRef };
      beginLoading(scoped, target);
      void loadMediaTargetDocument(scoped, {
        sessionId: target.sessionId,
        assetId: target.assetId,
        displayRef,
      });
      return;
    }
    case 'skill': {
      const scoped = { ...context, displayRef: context.displayRef || `skill:${target.skillId}` };
      beginLoading(scoped, target);
      void loadSkillDocument(scoped, { skillId: target.skillId });
      return;
    }
    case 'trusted-config': {
      const scoped = { ...context, displayRef: context.displayRef || target.relativePath };
      beginLoading(scoped, target);
      void loadTrustedConfigDocument(scoped, { relativePath: target.relativePath });
      return;
    }
    case 'project-file': {
      const scoped = { ...context, displayRef: context.displayRef || target.relativePath };
      beginLoading(scoped, target);
      void loadProjectDocument(scoped, { relativePath: target.relativePath });
      return;
    }
    case 'local-file': {
      const scoped = {
        ...context,
        displayRef: context.displayRef || target.displayRef || target.absolutePath,
      };
      beginLoading(scoped, target);
      if (!scoped.activeSessionId) {
        scoped.apply(
          unavailableDocument(scoped, {
            reason: 'not-found',
            suggestion: '该文件当前无法读取。',
          }),
        );
        return;
      }
      void loadLocalFileDocument(scoped, {
        absolutePath: target.absolutePath,
        transcriptFallback: true,
      });
      return;
    }
  }
}
