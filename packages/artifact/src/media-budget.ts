import { MAX_ARTIFACT_DOCUMENT_BYTES } from '@piwin/contracts';
import {
  bindArtifactSessionMedia,
  countArtifactSessionMediaReferences,
} from './bind-session-media.js';
import { getUtf8ByteSize } from './security.js';
import type { ArtifactRenderPlan } from './types.js';

type RenderPlan = Extract<ArtifactRenderPlan, { kind: 'render' }>;

export type ArtifactMediaBudget = {
  /** ASCII data-URL characters; attributes and non-image document bytes are reserved. */
  maxCharacters: number;
  references: ReadonlyMap<string, number>;
};

/** Bind against the actual template so runtime, theme and repeated images all count. */
export function createArtifactMediaBinding(
  plan: RenderPlan,
  maxDocumentBytes = MAX_ARTIFACT_DOCUMENT_BYTES,
): {
  budget: ArtifactMediaBudget;
  bind: (urls: ReadonlyMap<string, string>) => RenderPlan;
} {
  const unboundSource = bindArtifactSessionMedia(plan.renderSource);
  const document = plan.document;
  const template = bindArtifactSessionMedia(
    document.kind === 'sandbox' ? document.srcdoc : document.source,
  );
  const references = countArtifactSessionMediaReferences(template);
  let attributeBytes = 0;
  for (const count of references.values()) attributeBytes += ' src=""'.length * count;
  return {
    budget: {
      maxCharacters: Math.max(
        0,
        Math.min(MAX_ARTIFACT_DOCUMENT_BYTES, maxDocumentBytes) -
          getUtf8ByteSize(template) -
          attributeBytes,
      ),
      references,
    },
    bind: (urls) => ({
      ...plan,
      renderSource: bindArtifactSessionMedia(unboundSource, urls),
      document:
        document.kind === 'sandbox'
          ? { ...document, srcdoc: bindArtifactSessionMedia(template, urls) }
          : { ...document, source: bindArtifactSessionMedia(template, urls) },
    }),
  };
}
