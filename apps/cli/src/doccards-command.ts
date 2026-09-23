import { CliHostHandle, openCliHost } from './cli-host.js';
import { getPiwinRoot, loadPiwinConfig } from '@piwin/host-runtime';
import { basename } from 'node:path';
import { hasFlag, parseMock, parseMode, readOption } from './cli-args.js';

/**
 * `piwin doccards` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandDocCards(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'help';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);
  if (config.flashcards?.enabled === false) {
    console.error('Flashcards disabled (config.flashcards.enabled=false).');
    process.exitCode = 1;
    return;
  }

  const { createFolderRag, canonicalizeFolderPath } = await import('@piwin/doc-rag');
  const { createEmbeddingProvider } = await import('@piwin/notes');
  const { createCardStore, itemPreviewText } = await import('@piwin/flashcards');
  const { resolveNotesEmbeddingApiKey } = await import('@piwin/host-runtime');

  let embeddingProvider: import('@piwin/contracts').EmbeddingProvider | undefined;
  if (config.notes?.embedding) {
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
  const store = createCardStore({ piwinRoot: root });
  let host: CliHostHandle | undefined;

  try {
    if (sub === 'scan') {
      const folderPath = argv[2];
      if (!folderPath) {
        console.error('Usage: piwin doccards scan <folder>');
        process.exitCode = 1;
        return;
      }
      const result = await rag.scanFolder(folderPath);
      console.log(
        `${result.files.length} supported file(s), ${result.supportedExtensions.length} extension(s):`,
      );
      for (const file of result.files.slice(0, 50)) {
        console.log(`  ${file.relativePath}\t${file.sizeBytes}B\t${file.language}`);
      }
      if (result.files.length > 50) console.log(`  … and ${result.files.length - 50} more`);
      return;
    }

    if (sub === 'index') {
      const folderPath = argv[2];
      if (!folderPath) {
        console.error('Usage: piwin doccards index <folder> [--files a,b]');
        process.exitCode = 1;
        return;
      }
      const includeFiles = readOption(argv, '--files')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // CLI index stays on FolderRag (same process). Desktop HostCommand is async.
      const result = await rag.indexFolder(
        folderPath,
        includeFiles?.length ? { includeFiles } : undefined,
      );
      console.log(
        `indexed ${result.indexed} file(s), ${result.chunks} chunk(s)${result.degraded ? ' (FTS-only)' : ''}, skipped ${result.skipped}`,
      );
      for (const warning of result.warnings) console.log(`  ! ${warning}`);
      return;
    }

    if (sub === 'retrieve') {
      const folderPath = argv[2];
      const query = argv[3];
      if (!folderPath || !query) {
        console.error('Usage: piwin doccards retrieve <folder> <query> [--limit n] [--files a,b]');
        process.exitCode = 1;
        return;
      }
      const limit = readOption(argv, '--limit') ? Number(readOption(argv, '--limit')) : undefined;
      const fileAllowlist = readOption(argv, '--files')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const chunks = await rag.retrieve(folderPath, query, {
        ...(limit ? { limit } : {}),
        ...(fileAllowlist?.length ? { fileAllowlist } : {}),
      });
      console.log(`${chunks.length} passage(s):`);
      for (const chunk of chunks) {
        console.log(
          `\n--- ${chunk.filePath}:${chunk.startLine}-${chunk.endLine} (score ${chunk.score.toFixed(3)}) ---`,
        );
        console.log(chunk.content);
      }
      return;
    }

    if (sub === 'list') {
      const folderPath = argv[2];
      if (!folderPath) {
        console.error('Usage: piwin doccards list <folder>');
        process.exitCode = 1;
        return;
      }
      const canonical = await canonicalizeFolderPath(folderPath);
      const cards = await store.list(
        canonical ? { sourceFolder: canonical } : { sourceFolder: folderPath },
      );
      console.log(`${cards.length} card(s) from ${canonical ?? folderPath}:`);
      for (const card of cards) {
        const source = card.sourceFile
          ? ` [${card.sourceFile}${typeof card.sourceLine === 'number' ? `:${card.sourceLine}` : ''}]`
          : '';
        console.log(`  ${card.id}\t${itemPreviewText(card).slice(0, 70)}${source}`);
      }
      return;
    }

    if (sub === 'generate') {
      const folderPath = argv[2];
      if (!folderPath) {
        console.error(
          'Usage: piwin doccards generate <folder> [--topic t] [--files a,b] [--dry-run] [--show-context] [--legacy-print-prompt]',
        );
        process.exitCode = 1;
        return;
      }
      const mode = parseMode(argv);
      const mock = parseMock(argv);
      if (mode === 'rpc' && !mock) {
        console.error(
          'piwin doccards generate --mode rpc: use --mock for an offline smoke, or omit --mode to use sdk.',
        );
        process.exitCode = 1;
        return;
      }
      const topic = readOption(argv, '--topic') ?? '';
      const limit = readOption(argv, '--limit') ? Number(readOption(argv, '--limit')) : 10;
      const fileAllowlist = readOption(argv, '--files')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const difficulty = readOption(argv, '--difficulty') as 'easy' | 'medium' | 'hard' | undefined;
      const count = readOption(argv, '--count') as 'fewer' | 'standard' | 'more' | undefined;
      const canonical = await canonicalizeFolderPath(folderPath);
      if (!canonical) {
        console.error(`Folder not found: ${folderPath}`);
        process.exitCode = 1;
        return;
      }

      if (hasFlag(argv, '--legacy-print-prompt')) {
        const { assembleDoccardsGeneratePrompt } = await import('./doccards-generate.js');
        try {
          const prompt = await assembleDoccardsGeneratePrompt({
            rag,
            folderPath: canonical,
            ...(topic ? { topic } : {}),
            limit,
            ...(fileAllowlist?.length ? { fileAllowlist } : {}),
            ...(difficulty ? { difficulty } : {}),
            ...(count ? { count } : {}),
          });
          process.stdout.write(`${prompt}\n`);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
        return;
      }

      if (hasFlag(argv, '--dry-run') || hasFlag(argv, '--show-context')) {
        const query = topic.trim() || basename(canonical);
        try {
          const chunks = await rag.retrieve(canonical, query, {
            limit,
            ...(fileAllowlist?.length ? { fileAllowlist } : {}),
          });
          console.log(`query: ${query}`);
          console.log(`passages: ${chunks.length}`);
          if (hasFlag(argv, '--show-context')) {
            for (const chunk of chunks) {
              console.log(`--- ${chunk.filePath}:${chunk.startLine}`);
              console.log(chunk.content);
            }
          }
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
        return;
      }

      if (hasFlag(argv, '--show-kp')) {
        console.error('--show-kp requires the two-stage pipeline (P5).');
        process.exitCode = 1;
        return;
      }

      host = await openCliHost({
        mode,
        mock,
        piwinRoot: root,
      });
      const started = await host.handleCommand({
        type: 'doccards/generate',
        folderPath: canonical,
        ...(fileAllowlist?.length ? { includeFiles: fileAllowlist } : {}),
        ...(topic ? { topic } : {}),
      });
      if (!started.success) {
        console.error(started.error);
        process.exitCode = 1;
        return;
      }
      for (;;) {
        const status = await host.handleCommand({
          type: 'doccards/generation-status',
          folderPath: canonical,
        });
        if (!status.success) {
          console.error(status.error);
          process.exitCode = 1;
          return;
        }
        const job = (
          status.data as {
            job?: {
              status: string;
              created?: number;
              skipped?: number;
              createdCardIds?: string[];
              sessionId?: string;
              error?: string;
            } | null;
          }
        ).job;
        if (job && ['COMPLETED', 'COMPLETED_DEGRADED', 'FAILED', 'CANCELED'].includes(job.status)) {
          if (job.status === 'FAILED' || job.status === 'CANCELED') {
            console.error(job.error ? `${job.status}: ${job.error}` : job.status);
            process.exitCode = 1;
            return;
          }
          console.log(
            `created ${job.created ?? job.createdCardIds?.length ?? 0}, skipped ${job.skipped ?? 0}${
              job.sessionId ? `, session ${job.sessionId}` : ''
            }`,
          );
          if (hasFlag(argv, '--json')) {
            process.stdout.write(`${JSON.stringify(job)}\n`);
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }

    if (sub === 'rebind') {
      const oldPath = argv[2];
      const newPath = argv[3];
      if (!oldPath || !newPath) {
        console.error('Usage: piwin doccards rebind <oldPath> <newPath>');
        process.exitCode = 1;
        return;
      }
      const oldCanonical = await canonicalizeFolderPath(oldPath);
      const newCanonical = await canonicalizeFolderPath(newPath);
      const result = await store.rebindSourceFolder(
        oldCanonical ?? oldPath,
        newCanonical ?? newPath,
      );
      console.log(`rebound ${result.updated} card(s)`);
      return;
    }

    if (sub === 'forget') {
      const folderPath = argv[2];
      if (!folderPath) {
        console.error('Usage: piwin doccards forget <folder> [--yes]');
        process.exitCode = 1;
        return;
      }
      const canonical = await canonicalizeFolderPath(folderPath);
      const cardCount = canonical ? (await store.list({ sourceFolder: canonical })).length : 0;
      if (cardCount > 0 && !hasFlag(argv, '--yes')) {
        console.error(`Folder has ${cardCount} card(s). Add --yes to forget them.`);
        process.exitCode = 1;
        return;
      }
      const result = await store.deleteBySourceFolder(canonical ?? folderPath);
      console.log(`forgot ${result.deleted} card(s)`);
      return;
    }

    console.error('Usage: piwin doccards scan|index|retrieve|list|generate|rebind|forget');
    process.exitCode = 1;
  } finally {
    if (host) await host.dispose();
    rag.close();
  }
}
