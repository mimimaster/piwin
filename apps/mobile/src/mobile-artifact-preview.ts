import {
  createDefaultArtifactIframePolicy,
  evaluateCodeFence,
  indexArtifactFences,
  type ArtifactPreviewDecision,
} from '@piwin/artifact';

const MOBILE_ARTIFACT_IFRAME_POLICY = createDefaultArtifactIframePolicy('disabled');

export type MobileArtifactPreview = {
  id: string;
  title: string;
  language: string;
  decision: Extract<ArtifactPreviewDecision, { kind: 'render' } | { kind: 'blocked' }>;
};

/** Fence → card data. External resources stay blocked (iframe policy disabled). */
export function collectMobileArtifacts(text: string): MobileArtifactPreview[] {
  const previews: MobileArtifactPreview[] = [];
  for (const fence of indexArtifactFences(text)) {
    const decision = evaluateCodeFence({
      language: fence.info,
      source: fence.source,
      htmlUiModeEnabled: true,
      iframePolicy: MOBILE_ARTIFACT_IFRAME_POLICY,
    });
    if (decision.kind !== 'render' && decision.kind !== 'blocked') {
      continue;
    }
    previews.push({
      id: decision.descriptor.id,
      title: decision.descriptor.title,
      language: decision.descriptor.alias || fence.language,
      decision,
    });
  }
  return previews;
}

export function mobileArtifactBlockedCopy(reason: string): string {
  if (reason === 'blocked-external-resource') {
    return '已拦截外部资源，默认不允许外连。';
  }
  if (reason === 'blocked-too-large') {
    return '产物过大，无法预览。';
  }
  return '无法预览该产物。';
}
