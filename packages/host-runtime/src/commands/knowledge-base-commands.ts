/**
 * Unified knowledge-base Host commands (registry, search, open-source, session mount).
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { HostCommand, HostResponse, KnowledgeCitation } from '@piwin/contracts';
import { formatError, parseKnowledgeBaseId } from '@piwin/contracts';
import { isPathConfined, isSafeRelativePath } from '@piwin/doc-rag';
import { getSessionRecord, upsertSessionRecord } from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import type { KnowledgeCommandContext } from './knowledge-commands.js';
import {
  addFolderKnowledgeBase,
  assertKnownKnowledgeBaseIds,
  KnowledgeBaseCommandError,
  listKnowledgeBaseSummaries,
  removeKnowledgeBase,
  renameKnowledgeBase,
  touchKnowledgeBases,
  type KnowledgeBaseRuntime,
} from '../knowledge-base-service.js';
import { searchKnowledgeBases } from '../knowledge-retriever.js';
import { KnowledgePathEscapeError, readConfinedLineWindow } from '../knowledge-tools.js';
import { getWikiOverview, readWikiConcept } from '../wiki-service.js';
import { distillWikiConcept, WikiDistillError } from '../wiki-distill.js';

const TYPES = new Set<HostCommand['type']>([
  'knowledge/bases/list',
  'knowledge/bases/add',
  'knowledge/bases/rename',
  'knowledge/bases/remove',
  'knowledge/search',
  'knowledge/open-source',
  'session/set-knowledge-bases',
  'knowledge/wiki/overview',
  'knowledge/wiki/concept',
  'knowledge/wiki/distill',
]);

export function isKnowledgeBaseCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export function knowledgeRuntimeFromContext(context: KnowledgeCommandContext): KnowledgeBaseRuntime {
  return {
    ...(context.piwinRoot !== undefined ? { piwinRoot: context.piwinRoot } : {}),
    getFolderRag: context.getFolderRag,
    getNotesServices: context.getNotesServices,
    loadConfig: context.loadConfig,
    ...(context.ingestionJobs
      ? { isIndexing: (key) => context.ingestionJobs?.isRunning(key) === true }
      : {}),
    getCardStore: context.getCardStore,
  };
}

export async function publishKnowledgeBasesChanged(
  context: KnowledgeCommandContext,
): Promise<void> {
  if (!context.push) return;
  try {
    const bases = await listKnowledgeBaseSummaries(knowledgeRuntimeFromContext(context));
    context.push({ type: 'knowledge/bases-changed', bases });
  } catch (error) {
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `knowledge/bases-changed failed: ${formatError(error)}`,
    });
  }
}

export async function handleKnowledgeBaseCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: KnowledgeCommandContext,
): Promise<HostResponse | null> {
  if (!isKnowledgeBaseCommand(command)) return null;
  const runtime = knowledgeRuntimeFromContext(context);
  try {
    switch (command.type) {
      case 'knowledge/bases/list': {
        const bases = await listKnowledgeBaseSummaries(runtime);
        return ok(requestId, command.type, { bases });
      }
      case 'knowledge/bases/add': {
        const base = await addFolderKnowledgeBase(runtime, command.folderPath, command.name);
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, command.type, { base });
      }
      case 'knowledge/bases/rename': {
        const base = await renameKnowledgeBase(runtime, command.baseId, command.name);
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, command.type, { base });
      }
      case 'knowledge/bases/remove': {
        await removeKnowledgeBase(runtime, command.baseId, command.deleteIndex);
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, command.type, { removed: true, baseId: command.baseId });
      }
      case 'knowledge/search': {
        const result = await searchKnowledgeBases(runtime, {
          query: command.query,
          ...(command.baseIds ? { baseIds: command.baseIds } : {}),
          ...(command.tags ? { tags: command.tags } : {}),
          ...(command.limit !== undefined ? { limit: command.limit } : {}),
        });
        return ok(requestId, command.type, result);
      }
      case 'knowledge/open-source': {
        const result = await openKnowledgeSource(runtime, command.citation, command.openFile === true);
        return ok(requestId, command.type, result);
      }
      case 'session/set-knowledge-bases': {
        const uniqueIds = uniqueBaseIds(command.baseIds);
        await assertKnownKnowledgeBaseIds(runtime, uniqueIds);
        const session = await persistSessionKnowledgeBases(
          context,
          command.sessionId,
          uniqueIds,
        );
        await touchKnowledgeBases(runtime, uniqueIds);
        context.push?.(
          sessionIndexUpdatedPush({
            op: 'updated',
            sessionId: command.sessionId,
            session,
          }),
        );
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, command.type, { sessionId: command.sessionId, baseIds: uniqueIds });
      }
      case 'knowledge/wiki/overview': {
        const overview = await getWikiOverview(runtime.piwinRoot);
        return ok(requestId, command.type, overview);
      }
      case 'knowledge/wiki/concept': {
        const concept = await readWikiConcept(runtime.piwinRoot, command.slug);
        if (!concept) {
          return fail(requestId, command.type, `Wiki concept not found: ${command.slug}`);
        }
        return ok(requestId, command.type, { concept });
      }
      case 'knowledge/wiki/distill': {
        if (!context.completeJson) {
          return fail(
            requestId,
            command.type,
            'No model is configured for distillation. Set one in Settings → Models.',
          );
        }
        const bases = await listKnowledgeBaseSummaries(runtime);
        const base = bases.find((entry) => entry.id === command.baseId);
        if (!base) {
          return fail(requestId, command.type, `Unknown knowledge base: ${command.baseId}`);
        }
        if (!base.folderPath) {
          return fail(requestId, command.type, `${base.name} has no indexed folder to distil.`);
        }
        const rag = await runtime.getFolderRag();
        // Retrieval, not a raw file dump: the pack is already deduped, ranked
        // and budgeted, which is exactly what the synthesis prompt wants.
        const pack = await rag.retrievePack(
          base.folderPath,
          command.topic?.trim() || base.name,
          { limit: 12 },
        );
        const result = await distillWikiConcept({
          piwinRoot: runtime.piwinRoot,
          base,
          sources: pack.sources.map((source) => ({
            relativePath: source.relativePath,
            text: source.text,
          })),
          ...(command.topic ? { topic: command.topic } : {}),
          completeJson: context.completeJson,
        });
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, command.type, result);
      }
      default:
        return null;
    }
  } catch (error) {
    if (
      error instanceof KnowledgeBaseCommandError ||
      error instanceof KnowledgePathEscapeError ||
      error instanceof WikiDistillError
    ) {
      return fail(requestId, command.type, error.message);
    }
    throw error;
  }
}

function uniqueBaseIds(baseIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of baseIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

async function persistSessionKnowledgeBases(
  context: KnowledgeCommandContext,
  sessionId: string,
  baseIds: string[],
): Promise<ReturnType<typeof indexRecordToSummary>> {
  const indexPath = getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot));
  const record = await getSessionRecord(indexPath, sessionId);
  if (!record) {
    throw new KnowledgeBaseCommandError(`Unknown session: ${sessionId}`);
  }
  if (baseIds.length > 0) {
    record.knowledgeBaseIds = baseIds;
  } else {
    delete record.knowledgeBaseIds;
  }
  record.updatedAt = new Date().toISOString();
  await upsertSessionRecord(indexPath, record);
  return indexRecordToSummary(record);
}

async function openKnowledgeSource(
  runtime: KnowledgeBaseRuntime,
  citation: KnowledgeCitation,
  openFile: boolean,
): Promise<
  | { kind: 'notes'; noteId: string }
  | {
      kind: 'folder';
      absolutePath: string;
      startLine?: number;
      pageStart?: number;
      opened: boolean;
    }
> {
  const parsed = parseKnowledgeBaseId(citation.baseId);
  if (parsed?.kind === 'notes' || citation.kind === 'notes') {
    const noteId = citation.noteId?.trim();
    if (!noteId) {
      throw new KnowledgeBaseCommandError('noteId is required');
    }
    if (!runtime.getNotesServices) {
      throw new KnowledgeBaseCommandError('Notes services are not available');
    }
    const services = await runtime.getNotesServices();
    await services.store.read(noteId);
    return { kind: 'notes', noteId };
  }
  const relativePath = citation.relativePath?.trim();
  if (!relativePath) {
    throw new KnowledgeBaseCommandError('relativePath is required');
  }
  const bases = await listKnowledgeBaseSummaries(runtime);
  const base = bases.find((item) => item.id === citation.baseId);
  const folderPath = base?.folderPath;
  if (!folderPath) {
    throw new KnowledgeBaseCommandError(`Unknown folder knowledge base: ${citation.baseId}`);
  }
  if (!isSafeRelativePath(relativePath) || !(await isPathConfined(folderPath, relativePath))) {
    throw new KnowledgePathEscapeError(relativePath);
  }
  await readConfinedLineWindow(folderPath, relativePath, citation.startLine, citation.endLine);
  const absolutePath = join(folderPath, relativePath);
  const opened = openFile ? openLocalPath(absolutePath) : false;
  const result: {
    kind: 'folder';
    absolutePath: string;
    startLine?: number;
    pageStart?: number;
    opened: boolean;
  } = { kind: 'folder', absolutePath, opened };
  if (citation.startLine !== undefined) result.startLine = citation.startLine;
  if (citation.pageStart !== undefined) result.pageStart = citation.pageStart;
  return result;
}

function openLocalPath(absolutePath: string): boolean {
  const [cmd, args] =
    process.platform === 'darwin'
      ? (['open', [absolutePath]] as const)
      : process.platform === 'win32'
        ? (['cmd', ['/c', 'start', '', absolutePath]] as const)
        : (['xdg-open', [absolutePath]] as const);
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => undefined)
    .unref();
  return true;
}


