import { runKbCommand } from './kb-command.js';
import { getPiwinRoot, loadPiwinConfig } from '@piwin/host-runtime';
import { collectPositionals, hasFlag, readOption } from './cli-args.js';

/**
 * `piwin notes` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandNotes(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);
  if (config.notes?.enabled === false) {
    console.error('Notes disabled (config.notes.enabled=false).');
    process.exitCode = 1;
    return;
  }

  const { createNoteStore, createEmbeddingProvider } = await import('@piwin/notes');
  const store = createNoteStore({ piwinRoot: root });

  if (sub === 'add') {
    const content = collectPositionals(argv.slice(2), ['--title', '--collection', '--tags'])
      .join(' ')
      .trim();
    const title = readOption(argv, '--title');
    if (!content || !title) {
      console.error('Usage: piwin notes add <content> --title <t> [--collection c] [--tags a,b]');
      process.exitCode = 1;
      return;
    }
    const input: {
      title: string;
      content: string;
      collection?: string;
      tags?: string[];
    } = { title, content };
    const collection = readOption(argv, '--collection');
    if (collection) input.collection = collection;
    const tags = readOption(argv, '--tags');
    if (tags)
      input.tags = tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    const record = await store.write(input);
    console.log(`wrote ${record.id} (${record.relativePath})`);
    return;
  }

  if (sub === 'list') {
    const filter: { collection?: string } = {};
    const collection = readOption(argv, '--collection');
    if (collection) filter.collection = collection;
    const records = await store.list(filter);
    for (const record of records) {
      console.log(
        `${record.id}\t${record.collection}\t${record.title}\t${(record.tags ?? []).join(',')}`,
      );
    }
    return;
  }

  if (sub === 'show') {
    const noteId = argv[2];
    if (!noteId) {
      console.error('Usage: piwin notes show <id>');
      process.exitCode = 1;
      return;
    }
    const record = await store.read(noteId);
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (sub === 'delete') {
    const noteId = argv[2];
    if (!noteId) {
      console.error('Usage: piwin notes delete <id>');
      process.exitCode = 1;
      return;
    }
    const { createFolderRag } = await import('@piwin/doc-rag');
    const { deleteNoteAndReindex } = await import('@piwin/host-runtime');
    const rag = createFolderRag({ piwinRoot: root });
    try {
      await deleteNoteAndReindex({ store, rag, piwinRoot: root }, noteId);
      console.log(`deleted ${noteId}`);
    } finally {
      rag.close();
    }
    return;
  }

  if (sub === 'reindex') {
    const { createFolderRag } = await import('@piwin/doc-rag');
    const { getNotesRoot } = await import('@piwin/notes');
    let embeddingProvider: import('@piwin/contracts').EmbeddingProvider | undefined;
    if (config.notes?.embedding) {
      const { resolveNotesEmbeddingApiKey } = await import('@piwin/host-runtime');
      const apiKey = await resolveNotesEmbeddingApiKey(config.notes.embedding);
      const provider = createEmbeddingProvider({
        config: config.notes.embedding,
        ...(apiKey ? { apiKey } : {}),
      });
      if (provider) embeddingProvider = provider;
    }
    const rag = createFolderRag({
      piwinRoot: root,
      ...(embeddingProvider ? { embeddingProvider } : {}),
    });
    try {
      const notesRoot = getNotesRoot(root);
      await rag.indexFolder(notesRoot);
      console.log('index rebuilt');
    } finally {
      rag.close();
    }
    return;
  }

  if (sub === 'search') {
    const query = collectPositionals(argv.slice(2), ['--collection', '--limit', '--tags', '--kb'])
      .join(' ')
      .trim();
    if (!query) {
      console.error('Usage: piwin notes search <query> [--limit n] [--tags t1,t2]');
      process.exitCode = 1;
      return;
    }
    const searchArgv = ['kb', 'search', ...query.split(/\s+/).filter(Boolean), '--kb', 'notes'];
    const limit = readOption(argv, '--limit');
    if (limit) searchArgv.push('--limit', limit);
    const tags = readOption(argv, '--tags');
    if (tags) searchArgv.push('--tags', tags);
    if (hasFlag(argv, '--mock')) searchArgv.push('--mock');
    await runKbCommand(searchArgv);
    return;
  }

  if (sub === 'pin') {
    const positionals = collectPositionals(argv.slice(2), []);
    const query = positionals[0];
    const noteIds = positionals.slice(1);
    if (!query || noteIds.length === 0) {
      console.error('Usage: piwin notes pin <query> <noteId...>');
      process.exitCode = 1;
      return;
    }
    const { appendGoldenCase } = await import('@piwin/notes');
    const path = await appendGoldenCase(store.getNotesRoot(), {
      query,
      expectedNoteIds: noteIds,
    });
    console.log(`pinned "${query}" -> ${noteIds.join(',')} (${path})`);
    return;
  }

  if (sub === 'eval') {
    console.error(
      'Notes recall eval against doc-rag is not ported yet. Pin cases with `piwin notes pin`; inspect retrieval with `piwin notes search` / `piwin kb search`.',
    );
    process.exitCode = 1;
    return;
  }

  console.error('Usage: piwin notes add|list|search|show|delete|reindex|pin|eval');
  process.exitCode = 1;
}
