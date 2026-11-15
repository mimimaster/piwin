import { useRef } from 'react';
import {
  createArtifactMediaBinding,
  type ArtifactDescriptor,
  type ArtifactFrameMode,
  type ArtifactRenderMode,
  type ArtifactRenderPlan,
} from '@piwin/artifact';
import { MAX_ARTIFACT_DOCUMENT_BYTES } from '@piwin/contracts';
import { hasTauriBridge } from '../tool-cards/shell-runtime.js';

const DOCUMENT_DATA_URL_PREFIX = 'data:text/html;charset=utf-8;base64,';
const MAX_BROWSER_DOCUMENT_URL_CHARACTERS = 2 * 1024 * 1024;

/** Native IDs carry no content; browser data URLs must also fit Chromium's URL limit. */
export function resolveArtifactDocumentByteLimit(): number {
  return hasTauriBridge()
    ? MAX_ARTIFACT_DOCUMENT_BYTES
    : Math.floor((MAX_BROWSER_DOCUMENT_URL_CHARACTERS - DOCUMENT_DATA_URL_PREFIX.length) / 4) * 3;
}

export function createArtifactDocumentMediaBinding(
  plan: Extract<ArtifactRenderPlan, { kind: 'render' }>,
): ReturnType<typeof createArtifactMediaBinding> {
  return createArtifactMediaBinding(plan, resolveArtifactDocumentByteLimit());
}

export type ArtifactSandboxView = {
  mode: ArtifactRenderMode;
  descriptor: ArtifactDescriptor;
  renderSource: string;
  srcdoc: string;
  frameMode: ArtifactFrameMode;
};

export type ArtifactDocumentPhase = 'empty-stream' | 'seeded-stream' | 'final';

export type ArtifactDocument = {
  documentKey: string;
  /** Store key for the Tauri piwin-artifact scheme. */
  documentId: string;
  /** Exactly what `documentUrl` loads (published over IPC under Tauri). */
  documentSource: string;
  documentUrl: string;
  streamLifecycle: boolean;
  streamSeeded: boolean;
};

export function initialArtifactDocumentPhase(
  mode: ArtifactRenderMode,
  renderSource: string,
): ArtifactDocumentPhase {
  if (mode !== 'stream-preview') {
    return 'final';
  }
  return renderSource.trim().length > 0 ? 'seeded-stream' : 'empty-stream';
}

export function advanceArtifactDocumentPhase(
  current: ArtifactDocumentPhase,
  mode: ArtifactRenderMode,
  renderSource: string,
): ArtifactDocumentPhase {
  if (mode === 'stream-preview') {
    if (current === 'final') {
      return initialArtifactDocumentPhase(mode, renderSource);
    }
    return renderSource.trim().length > 0 ? 'seeded-stream' : current;
  }
  return 'final';
}

export function artifactDocumentKey(
  phase: ArtifactDocumentPhase,
  id: string,
  srcdoc: string,
): string {
  if (phase === 'empty-stream') {
    return `stream:${id}`;
  }
  if (phase === 'seeded-stream') {
    return `stream:${id}:seeded`;
  }
  return `final:${id}:${srcdoc}`;
}

/**
 * Encode the CSP-protected Artifact document as an isolated iframe URL.
 * Browser/e2e keep this data: URL; packaged Tauri uses `buildArtifactDocumentUrl`.
 */
export function buildArtifactDocumentDataUrl(srcdoc: string): string {
  const bytes = new TextEncoder().encode(srcdoc);
  const chunks: string[] = [];
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return `${DOCUMENT_DATA_URL_PREFIX}${btoa(chunks.join(''))}`;
}

export const ARTIFACT_DOCUMENT_SCHEME = 'piwin-artifact';

/** Unguessable store key; the Rust store accepts 16–64 `[A-Za-z0-9_-]` chars. */
export function createArtifactDocumentId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function convertArtifactDocumentSrc(documentId: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        convertFileSrc?: (filePath: string, protocol?: string) => string;
      };
    }
  ).__TAURI_INTERNALS__;
  return typeof internals?.convertFileSrc === 'function'
    ? internals.convertFileSrc(documentId, ARTIFACT_DOCUMENT_SCHEME)
    : null;
}

/**
 * Tauri (Desktop and the iOS shell alike — both serve this page from
 * `tauri://`): load through the piwin-artifact scheme so the frame does not inherit
 * the app page CSP (Tauri appends script hashes, which disables 'unsafe-inline'
 * in inherited data: documents). The document itself is published over IPC —
 * wry rejects scheme URLs over 65 534 bytes, so it cannot ride in the URL.
 * Browser/e2e: data: URL.
 */
export function buildArtifactDocumentUrl(documentId: string, srcdoc: string): string {
  if (!hasTauriBridge()) {
    return buildArtifactDocumentDataUrl(srcdoc);
  }
  const converted = convertArtifactDocumentSrc(documentId);
  if (converted) {
    return converted;
  }
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')) {
    return `http://${ARTIFACT_DOCUMENT_SCHEME}.localhost/${documentId}`;
  }
  return `${ARTIFACT_DOCUMENT_SCHEME}://localhost/${documentId}`;
}

/**
 * Origin the artifact documents load from under Tauri, or null in a browser
 * build. The kit is served from the same origin (`/lib/v1/kit.js`).
 */
export function resolveArtifactSchemeOrigin(): string | null {
  if (!hasTauriBridge()) return null;
  const probe = 'piwin-kit-origin-probe';
  const url = buildArtifactDocumentUrl(probe, '');
  return url.endsWith(`/${probe}`) ? url.slice(0, -(probe.length + 1)) : null;
}

type ArtifactDocumentRecord = {
  key: string;
  documentId: string;
  documentSource: string;
  documentUrl: string;
};

function createArtifactDocumentRecord(key: string, srcdoc: string): ArtifactDocumentRecord {
  const documentId = createArtifactDocumentId();
  return {
    key,
    documentId,
    documentSource: srcdoc,
    documentUrl: buildArtifactDocumentUrl(documentId, srcdoc),
  };
}

/**
 * Empty stream shells stay mounted only until the first stable snapshot.
 * That snapshot is baked into a new document so the canvas is not an empty
 * iframe waiting on postMessage. Later tokens still reconcile in place.
 * Completion navigates to the final document — the same path history uses —
 * instead of freezing the stream shell and hoping a last snapshot lands.
 */
export function useArtifactDocument(decision: ArtifactSandboxView): ArtifactDocument {
  const phaseRef = useRef(initialArtifactDocumentPhase(decision.mode, decision.renderSource));
  phaseRef.current = advanceArtifactDocumentPhase(
    phaseRef.current,
    decision.mode,
    decision.renderSource,
  );
  const phase = phaseRef.current;
  const streamLifecycle = phase !== 'final';
  const streamSeeded = phase === 'seeded-stream';
  const documentKey = artifactDocumentKey(phase, decision.descriptor.id, decision.srcdoc);
  const documentRef = useRef<ArtifactDocumentRecord | null>(null);
  if (documentRef.current?.key !== documentKey) {
    documentRef.current = createArtifactDocumentRecord(documentKey, decision.srcdoc);
  }
  return {
    documentKey,
    documentId: documentRef.current.documentId,
    documentSource: documentRef.current.documentSource,
    documentUrl: documentRef.current.documentUrl,
    streamLifecycle,
    streamSeeded,
  };
}
