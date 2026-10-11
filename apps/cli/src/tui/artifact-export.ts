import { analyzeArtifactFence, indexArtifactFences, materializeArtifact } from '@piwin/artifact';
import type { TranscriptState } from './transcript-model.js';

/**
 * Artifacts in the transcript, and a page a browser can show one in. A
 * terminal cannot render HTML, so the TUI exports instead — under the same
 * rule Desktop renders by: model output is untrusted, so it runs in a
 * script-only sandboxed frame behind the artifact package's own CSP, never
 * as a top-level document.
 */

export type TranscriptArtifact = {
  /** Stable within a transcript: message id plus the fence's position in it. */
  key: string;
  title: string;
  kind: 'html' | 'svg';
  /** Raw model source. */
  source: string;
  /** Self-contained sandbox document and the CSP it declares; absent when blocked. */
  document?: { srcdoc: string; csp: string };
  /** Why the artifact policy refuses to render it. Its source can still be read. */
  blocked?: string;
};

const BLOCK_REASON: Record<string, string> = {
  'blocked-empty': '内容为空',
  'blocked-too-large': '内容过大',
  'blocked-external-resource': '引用了外部资源',
};

/** Every finished artifact in assistant messages, newest first. */
export function listTranscriptArtifacts(transcript: TranscriptState): TranscriptArtifact[] {
  const artifacts: TranscriptArtifact[] = [];
  for (const entry of transcript.entries) {
    if (entry.kind !== 'message' || entry.role !== 'assistant') continue;
    for (const fence of indexArtifactFences(entry.text)) {
      // A fence still being streamed has no complete document to export.
      if (fence.open) continue;
      const analysis = analyzeArtifactFence(fence, { id: `${entry.id}-${fence.ordinal}` });
      // Plain code fences are not artifacts.
      if (analysis.kind === 'code') continue;
      const descriptor = analysis.kind === 'intent' ? analysis.intent.descriptor : analysis.descriptor;
      const artifact: TranscriptArtifact = {
        key: `${entry.id}:${fence.ordinal}`,
        title: descriptor.title.trim().length > 0 ? descriptor.title.trim() : `Artifact ${artifacts.length + 1}`,
        kind: descriptor.type,
        source: descriptor.source,
      };
      if (analysis.kind === 'blocked') {
        artifact.blocked = BLOCK_REASON[analysis.reason] ?? analysis.reason;
      } else {
        // The canvas presentation always yields a sandbox document, never raw source.
        const plan = materializeArtifact(analysis.intent, { mode: 'interactive', presentation: 'canvas' });
        if (plan.document.kind !== 'sandbox') continue;
        artifact.document = { srcdoc: plan.document.srcdoc, csp: plan.document.csp };
      }
      artifacts.push(artifact);
    }
  }
  return artifacts.reverse();
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The page written to disk, or undefined for a blocked artifact. The artifact
 * lives in a `sandbox="allow-scripts"` frame: an opaque origin with no access
 * to this page, its file:// siblings, storage, forms or navigation. The outer
 * page loads nothing and runs no script. It declares the artifact's own CSP,
 * which a srcdoc frame inherits on top of the one inside the document — so
 * the frame can do exactly what the artifact policy allows and nothing more.
 */
export function buildArtifactHostPage(artifact: TranscriptArtifact): string | undefined {
  const { document } = artifact;
  if (document === undefined) return undefined;
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(document.csp)}" />
<meta name="referrer" content="no-referrer" />
<title>${escapeAttribute(artifact.title)} · piwin</title>
<style>html,body{margin:0;height:100%;background:#111}iframe{border:0;width:100%;height:100%;display:block}</style>
</head>
<body>
<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="${escapeAttribute(artifact.title)}" srcdoc="${escapeAttribute(document.srcdoc)}"></iframe>
</body>
</html>
`;
}

/** A file name a shell and a file manager both handle; the title stays readable. */
export function artifactFileName(artifact: TranscriptArtifact): string {
  const base = artifact.title
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${base.length === 0 ? 'artifact' : base}.html`;
}
