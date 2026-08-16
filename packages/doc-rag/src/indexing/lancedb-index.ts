import * as lancedb from '@lancedb/lancedb';
import type {
  DocIndexStore,
  FtsQuery,
  HybridQuery,
  IndexedChunk,
  RetrievalHit,
} from './doc-index-store.js';

const TABLE = 'doc_chunks_v2';

type LanceRow = {
  chunk_id: string;
  document_id: string;
  folder_key: string;
  relative_path: string;
  content: string;
  heading_path: string;
  source_order: number;
  start_line: number;
  end_line: number;
  previous_chunk_id: string;
  next_chunk_id: string;
  content_hash: string;
  language: string;
  parser_id: string;
  chunker_id: string;
  vector?: number[];
};

function escapeLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function inList(ids: string[]): string {
  return ids.map((id) => `'${escapeLiteral(id)}'`).join(', ');
}

function whereClause(folderKey: string, documentIds?: string[]): string {
  const folder = `folder_key = '${escapeLiteral(folderKey)}'`;
  if (!documentIds || documentIds.length === 0) return folder;
  return `${folder} AND document_id IN (${inList(documentIds)})`;
}

function rowFromChunk(chunk: IndexedChunk): LanceRow {
  const row: LanceRow = {
    chunk_id: chunk.chunkId,
    document_id: chunk.documentId,
    folder_key: chunk.folderKey,
    relative_path: chunk.relativePath,
    content: chunk.content,
    heading_path: (chunk.headingPath ?? []).join('\u0001'),
    source_order: chunk.sourceOrder,
    start_line: chunk.startLine ?? 0,
    end_line: chunk.endLine ?? 0,
    previous_chunk_id: chunk.previousChunkId ?? '',
    next_chunk_id: chunk.nextChunkId ?? '',
    content_hash: chunk.contentHash,
    language: chunk.language ?? '',
    parser_id: chunk.parserId,
    chunker_id: chunk.chunkerId,
  };
  if (chunk.vector && chunk.vector.length > 0) {
    row.vector = chunk.vector;
  }
  return row;
}

function chunkFromRow(row: LanceRow): IndexedChunk {
  const headingPath = row.heading_path.length > 0 ? row.heading_path.split('\u0001') : undefined;
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    folderKey: row.folder_key,
    relativePath: row.relative_path,
    content: row.content,
    contentHash: row.content_hash,
    ...(headingPath ? { headingPath } : {}),
    sourceOrder: row.source_order,
    ...(row.start_line > 0 ? { startLine: row.start_line } : {}),
    ...(row.end_line > 0 ? { endLine: row.end_line } : {}),
    ...(row.previous_chunk_id ? { previousChunkId: row.previous_chunk_id } : {}),
    ...(row.next_chunk_id ? { nextChunkId: row.next_chunk_id } : {}),
    ...(row.language ? { language: row.language } : {}),
    tokenCount: 0,
    parserId: row.parser_id,
    parserVersion: '1',
    chunkerId: row.chunker_id,
    chunkerVersion: '1',
    ...(row.vector && row.vector.length > 0 ? { vector: row.vector } : {}),
  };
}

async function ensureFts(table: lancedb.Table): Promise<void> {
  const indices = await table.listIndices();
  if (indices.some((index) => index.columns.includes('content') && index.indexType === 'FTS')) {
    return;
  }
  await table.createIndex('content', {
    config: lancedb.Index.fts({
      baseTokenizer: 'icu',
      stem: false,
      removeStopWords: false,
    }),
  });
}

export async function openLanceDocIndex(uri: string): Promise<DocIndexStore> {
  const db = await lancedb.connect(uri);

  async function openTable(): Promise<lancedb.Table | undefined> {
    try {
      return await db.openTable(TABLE);
    } catch {
      return undefined;
    }
  }

  async function ftsSearch(query: FtsQuery): Promise<RetrievalHit[]> {
    const table = await openTable();
    if (!table) return [];
    await ensureFts(table);
    const limit = query.limit ?? 10;
    const rows = (await table
      .query()
      .fullTextSearch(query.text)
      .where(whereClause(query.folderKey, query.documentIds))
      .limit(limit)
      .toArray()) as Array<LanceRow & { _score?: number }>;
    return rows.map((row) => ({
      chunk: chunkFromRow(row),
      score: typeof row._score === 'number' ? row._score : 0,
      retrievedBy: 'fts' as const,
    }));
  }

  return {
    async upsertChunks(chunks) {
      if (chunks.length === 0) return;
      let table = await openTable();
      const rows = chunks.map(rowFromChunk);
      if (!table) {
        table = await db.createTable(TABLE, rows);
      } else {
        const documentIds = [...new Set(chunks.map((chunk) => chunk.documentId))];
        for (const documentId of documentIds) {
          await table.delete(`document_id = '${escapeLiteral(documentId)}'`);
        }
        await table.add(rows);
      }
      await ensureFts(table);
    },

    async deleteByDocumentId(documentId) {
      const table = await openTable();
      if (!table) return;
      await table.delete(`document_id = '${escapeLiteral(documentId)}'`);
    },

    ftsSearch,

    async hybridSearch(query: HybridQuery) {
      if (!query.vector || query.vector.length === 0) {
        return ftsSearch(query);
      }
      const table = await openTable();
      if (!table) return [];
      await ensureFts(table);
      const limit = query.limit ?? 10;
      const rows = (await table
        .query()
        .fullTextSearch(query.text)
        .nearestTo(query.vector)
        .where(whereClause(query.folderKey, query.documentIds))
        .limit(limit)
        .toArray()) as Array<LanceRow & { _score?: number }>;
      return rows.map((row) => ({
        chunk: chunkFromRow(row),
        score: typeof row._score === 'number' ? row._score : 0,
        retrievedBy: 'hybrid' as const,
      }));
    },

    async hasDocument(documentId) {
      const table = await openTable();
      if (!table) return false;
      const rows = (await table
        .query()
        .where(`document_id = '${escapeLiteral(documentId)}'`)
        .limit(1)
        .toArray()) as LanceRow[];
      return rows.length > 0;
    },

    async getChunksByIds(ids) {
      if (ids.length === 0) return [];
      const table = await openTable();
      if (!table) return [];
      const rows = (await table
        .query()
        .where(`chunk_id IN (${inList(ids)})`)
        .limit(ids.length)
        .toArray()) as LanceRow[];
      return rows.map(chunkFromRow);
    },

    async close() {
      // LanceDB Node connection has no required close; drop local refs.
    },
  };
}
