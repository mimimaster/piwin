import {
  analyzeArtifactFence,
  createDefaultArtifactIframePolicy,
  indexArtifactFences,
  materializeArtifact,
  type ArtifactFenceRecord,
  type ArtifactRenderPlan,
} from '@piwin/artifact';

const MOBILE_ARTIFACT_IFRAME_POLICY = createDefaultArtifactIframePolicy('disabled');

export type MobileArtifactPreview = {
  id: string;
  title: string;
  language: string;
  plan: Extract<ArtifactRenderPlan, { kind: 'render' } | { kind: 'blocked' }>;
};

export type MobileArtifactFenceDecision =
  | { kind: 'code' }
  | { kind: 'preparing'; title: string }
  | { kind: 'ready'; preview: MobileArtifactPreview };

/**
 * Analyze one fence with the same policy used by the mobile artifact catalog.
 * Streaming callers get a lightweight pending decision so they do not
 * materialize an iframe before the assistant turn has settled.
 */
export function evaluateMobileArtifactFence(
  fence: ArtifactFenceRecord,
  isStreaming: boolean,
): MobileArtifactFenceDecision {
  const analysis = analyzeArtifactFence(fence, {
    htmlUiModeEnabled: true,
    iframePolicy: MOBILE_ARTIFACT_IFRAME_POLICY,
    ...(isStreaming ? { mode: 'stream-preview' as const, allowIncompleteSource: true } : {}),
  });
  if (analysis.kind === 'code') {
    return { kind: 'code' };
  }

  const title =
    analysis.kind === 'blocked' ? analysis.descriptor.title : analysis.intent.descriptor.title;
  if (isStreaming) {
    return { kind: 'preparing', title };
  }

  if (analysis.kind === 'blocked') {
    return {
      kind: 'ready',
      preview: {
        id: analysis.descriptor.id,
        title: analysis.descriptor.title,
        language: analysis.descriptor.alias || fence.language,
        plan: analysis,
      },
    };
  }

  const intent =
    analysis.intent.renderer === 'static'
      ? { ...analysis.intent, renderer: 'sandbox' as const }
      : analysis.intent;
  const plan = materializeArtifact(intent, {
    mode: 'interactive',
    iframePolicy: MOBILE_ARTIFACT_IFRAME_POLICY,
  });
  return {
    kind: 'ready',
    preview: {
      id: plan.intent.descriptor.id,
      title: plan.intent.descriptor.title,
      language: plan.intent.descriptor.alias || fence.language,
      plan,
    },
  };
}

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
    const decision = evaluateMobileArtifactFence(fence, false);
    if (decision.kind === 'ready') {
      previews.push(decision.preview);
    }
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
