/**
 * Per-session Sources/Outputs projection (Summary P2).
 *
 * Identities come from owning domains already on the transcript — attachments,
 * explicit skill selection, structured search/knowledge tool results, and
 * workspace-write records. Never inferred from message prose or a filesystem
 * crawl. A path may appear twice (input and output) with distinct provenance.
 */

import type { PromptContextRef } from './side-chat.js';
import type { SessionToolCardView, SessionTranscriptMessage } from './session-transcript.js';

export type SessionResourceRole = 'input' | 'output';

export type SessionResourceKind =
  | 'attachment'
  | 'skill'
  | 'search-hit'
  | 'knowledge'
  | 'file'
  | 'media';

export type SessionResourceAvailability = 'available' | 'missing' | 'unknown';

export type SessionResourceProvenance =
  | 'prompt-attachment'
  | 'prompt-skill'
  | 'prompt-context'
  | 'web-search-hit'
  | 'legacy-search-citation'
  | 'knowledge-citation'
  | 'workspace-write'
  | 'generated-media';

export type SessionResource = {
  id: string;
  sessionId: string;
  /** Absent for session-scoped vault identities that never landed on a row. */
  messageId?: string;
  role: SessionResourceRole;
  kind: SessionResourceKind;
  title: string;
  /** Display-safe target: sanitized URL, relative path, skill id, or media id. */
  target?: string;
  availability: SessionResourceAvailability;
  provenance: SessionResourceProvenance;
};

export type SessionGeneratedMediaRef = {
  assetId: string;
  title?: string;
};

export type SessionResourcesData = {
  sessionId: string;
  resources: SessionResource[];
};

/** One transcript-store tail page (store cap). Host may walk older pages. */
export const SESSION_RESOURCE_MESSAGE_WINDOW = 100;

/** Safety cap on tail pages so a huge session cannot stream the whole path. */
export const SESSION_RESOURCE_MAX_PAGES = 20;

/** Hard cap on the projected list so Summary never dumps a whole transcript. */
export const SESSION_RESOURCES_MAX = 40;

const SEARCH_HITS_PER_CALL = 8;
const WRITES_PER_MESSAGE = 12;

/**
 * Strip query/hash from http(s) URLs so chrome never shows tokens. Other
 * values pass through trimmed.
 */
export function displayResourceTarget(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const cut = trimmed.search(/[?#]/);
    return cut < 0 ? trimmed : trimmed.slice(0, cut);
  }
  return trimmed;
}

function lastPathSegment(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? normalized : normalized.slice(slash + 1);
}

function fileTitle(path: string): string {
  const segment = lastPathSegment(path);
  return segment.length > 0 ? segment : path;
}

function fileTarget(path: string): string | undefined {
  const trimmed = path.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function readWebSearchHits(output: string): ReadonlyArray<{ title: string; url: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || !('hits' in parsed)) return [];
  const hits = (parsed as { hits: unknown }).hits;
  if (!Array.isArray(hits)) return [];
  const collected: Array<{ title: string; url: string }> = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object') continue;
    const record = hit as { title?: unknown; url?: unknown };
    const url = typeof record.url === 'string' ? displayResourceTarget(record.url) : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const title =
      typeof record.title === 'string' && record.title.trim().length > 0
        ? record.title.trim()
        : url;
    collected.push({ title, url });
    if (collected.length >= SEARCH_HITS_PER_CALL) break;
  }
  return collected;
}

function pushResource(resources: SessionResource[], resource: SessionResource): void {
  resources.push(resource);
}

function projectAttachments(
  sessionId: string,
  message: SessionTranscriptMessage,
  resources: SessionResource[],
): void {
  const attachments = message.attachments;
  if (!attachments) return;
  for (const attachment of attachments) {
    const generated = attachment.source === 'generated';
    pushResource(resources, {
      id: generated ? `gen:${message.id}:${attachment.id}` : `att:${message.id}:${attachment.id}`,
      sessionId,
      messageId: message.id,
      role: generated ? 'output' : 'input',
      kind: generated ? 'media' : 'attachment',
      title: attachment.name?.trim() || attachment.id,
      target: `media:${attachment.id}`,
      availability: 'available',
      provenance: generated ? 'generated-media' : 'prompt-attachment',
    });
  }
}

function projectContextRefs(
  sessionId: string,
  message: SessionTranscriptMessage,
  resources: SessionResource[],
): void {
  const refs = message.contextRefs;
  if (!refs) return;
  refs.forEach((ref, index) => {
    const projected = contextRefResource(sessionId, message.id, ref, index);
    if (projected) pushResource(resources, projected);
  });
}

function contextRefResource(
  sessionId: string,
  messageId: string,
  ref: PromptContextRef,
  index: number,
): SessionResource | null {
  if (ref.kind !== 'file' && ref.kind !== 'folder' && ref.kind !== 'selection') {
    return null;
  }
  const relativePath = ref.relativePath?.trim();
  if (!relativePath) return null;
  const target = fileTarget(relativePath);
  return {
    id: `ctx:${messageId}:${String(index)}`,
    sessionId,
    messageId,
    role: 'input',
    kind: 'file',
    title: ref.label.trim() || fileTitle(relativePath),
    ...(target === undefined ? {} : { target }),
    availability: 'unknown',
    provenance: 'prompt-context',
  };
}

function projectSkill(
  sessionId: string,
  message: SessionTranscriptMessage,
  resources: SessionResource[],
): void {
  const skillId = message.skillId?.trim();
  if (!skillId) return;
  pushResource(resources, {
    id: `skill:${message.id}:${skillId}`,
    sessionId,
    messageId: message.id,
    role: 'input',
    kind: 'skill',
    title: skillId,
    target: skillId,
    availability: 'available',
    provenance: 'prompt-skill',
  });
}

function projectLegacyCitations(
  sessionId: string,
  message: SessionTranscriptMessage,
  resources: SessionResource[],
): void {
  const citations = message.searchEvidence?.citations;
  if (!citations) return;
  citations.forEach((citation, index) => {
    if (index >= SEARCH_HITS_PER_CALL) return;
    const url = displayResourceTarget(citation.url);
    if (!/^https?:\/\//i.test(url)) return;
    pushResource(resources, {
      id: `cite:${message.id}:${String(index)}`,
      sessionId,
      messageId: message.id,
      role: 'input',
      kind: 'search-hit',
      title: citation.title.trim() || url,
      target: url,
      availability: 'available',
      provenance: 'legacy-search-citation',
    });
  });
}

function projectToolCard(
  sessionId: string,
  message: SessionTranscriptMessage,
  tool: SessionToolCardView,
  resources: SessionResource[],
): void {
  if (tool.toolName === 'web_search') {
    readWebSearchHits(tool.output).forEach((hit, index) => {
      pushResource(resources, {
        id: `search:${message.id}:${tool.toolCallId}:${String(index)}`,
        sessionId,
        messageId: message.id,
        role: 'input',
        kind: 'search-hit',
        title: hit.title,
        target: hit.url,
        availability: 'available',
        provenance: 'web-search-hit',
      });
    });
  }
  const citations = tool.presentation?.knowledge?.citations;
  if (!citations) return;
  for (const citation of citations) {
    const target = citation.noteId ?? citation.relativePath;
    pushResource(resources, {
      id: `knowledge:${message.id}:${tool.toolCallId}:${String(citation.ref)}`,
      sessionId,
      messageId: message.id,
      role: 'input',
      kind: 'knowledge',
      title: citation.title.trim() || citation.baseName,
      ...(target === undefined ? {} : { target }),
      availability: 'available',
      provenance: 'knowledge-citation',
    });
  }
}

function projectWorkspaceWrites(
  sessionId: string,
  message: SessionTranscriptMessage,
  resources: SessionResource[],
): void {
  const files = message.workspaceWrites?.files;
  if (!files) return;
  files.slice(0, WRITES_PER_MESSAGE).forEach((path, index) => {
    const trimmed = path.trim();
    if (trimmed.length === 0) return;
    const target = fileTarget(trimmed);
    pushResource(resources, {
      id: `write:${message.id}:${String(index)}`,
      sessionId,
      messageId: message.id,
      role: 'output',
      kind: 'file',
      title: fileTitle(trimmed),
      ...(target === undefined ? {} : { target }),
      availability: 'unknown',
      provenance: 'workspace-write',
    });
  });
}

/**
 * Project Sources/Outputs from a chronological active-path window.
 * Does not invent identities from message text.
 */
export function projectSessionResources(
  sessionId: string,
  messages: readonly SessionTranscriptMessage[],
): SessionResource[] {
  const resources: SessionResource[] = [];
  for (const message of messages) {
    projectAttachments(sessionId, message, resources);
    projectSkill(sessionId, message, resources);
    projectContextRefs(sessionId, message, resources);
    projectLegacyCitations(sessionId, message, resources);
    if (message.tools) {
      for (const tool of message.tools) {
        projectToolCard(sessionId, message, tool, resources);
      }
    }
    projectWorkspaceWrites(sessionId, message, resources);
  }
  return capSessionResources(resources);
}

function mediaAssetId(resource: SessionResource): string | undefined {
  if (resource.target?.startsWith('media:')) return resource.target.slice('media:'.length);
  return undefined;
}

function capSessionResources(resources: SessionResource[]): SessionResource[] {
  if (resources.length <= SESSION_RESOURCES_MAX) return resources;
  return resources.slice(resources.length - SESSION_RESOURCES_MAX);
}

/**
 * Fold session-scoped generated vault assets into the projection. Assets
 * already present as transcript attachments are not duplicated.
 */
export function mergeGeneratedMediaResources(
  sessionId: string,
  resources: readonly SessionResource[],
  generated: readonly SessionGeneratedMediaRef[],
): SessionResource[] {
  const seen = new Set(
    resources
      .map(mediaAssetId)
      .filter((assetId): assetId is string => assetId !== undefined),
  );
  const extra: SessionResource[] = [];
  for (const item of generated) {
    const assetId = item.assetId.trim();
    if (assetId.length === 0 || seen.has(assetId)) continue;
    seen.add(assetId);
    extra.push({
      id: `gen:${assetId}`,
      sessionId,
      role: 'output',
      kind: 'media',
      title: item.title?.trim() || assetId,
      target: `media:${assetId}`,
      availability: 'available',
      provenance: 'generated-media',
    });
  }
  return capSessionResources([...resources, ...extra]);
}
