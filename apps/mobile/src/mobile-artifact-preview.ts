import {
  analyzeArtifactFence,
  createDefaultArtifactIframePolicy,
  indexArtifactFences,
  materializeArtifact,
  type ArtifactRenderPlan,
} from '@piwin/artifact';

const MOBILE_ARTIFACT_IFRAME_POLICY = createDefaultArtifactIframePolicy('disabled');

export type MobileArtifactPreview = {
  id: string;
  title: string;
  language: string;
  plan: Extract<ArtifactRenderPlan, { kind: 'render' } | { kind: 'blocked' }>;
};

/**
 * Fence → card data. `htmlUiModeEnabled` is `config.artifact.enabled`.
 * External resources stay blocked (iframe policy disabled).
 */
export function collectMobileArtifacts(
  text: string,
  htmlUiModeEnabled: boolean,
): MobileArtifactPreview[] {
  if (!htmlUiModeEnabled) {
    return [];
  }
  const previews: MobileArtifactPreview[] = [];
  for (const fence of indexArtifactFences(text)) {
    const analysis = analyzeArtifactFence(fence, {
      htmlUiModeEnabled,
      iframePolicy: MOBILE_ARTIFACT_IFRAME_POLICY,
    });
    if (analysis.kind === 'code') {
      continue;
    }
    if (analysis.kind === 'blocked') {
      previews.push({
        id: analysis.descriptor.id,
        title: analysis.descriptor.title,
        language: analysis.descriptor.alias || fence.language,
        plan: analysis,
      });
      continue;
    }
    const intent =
      analysis.intent.renderer === 'static'
        ? { ...analysis.intent, renderer: 'sandbox' as const }
        : analysis.intent;
    const plan = materializeArtifact(intent, {
      mode: 'interactive',
      iframePolicy: MOBILE_ARTIFACT_IFRAME_POLICY,
    });
    previews.push({
      id: plan.intent.descriptor.id,
      title: plan.intent.descriptor.title,
      language: plan.intent.descriptor.alias || fence.language,
      plan,
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

export function mobileArtifactSrcdoc(plan: MobileArtifactPreview['plan']): string | undefined {
  if (plan.kind !== 'render' || plan.document.kind !== 'sandbox') {
    return undefined;
  }
  return plan.document.srcdoc;
}
