import { getPiwinRoot, loadPiwinConfig } from '@piwin/host-runtime';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { collectPositionals, readOption } from './cli-args.js';
import { commandStudy } from './study-command.js';

/**
 * `piwin cards` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandCards(argv: string[]): Promise<void> {
  if (argv[1] === 'study') {
    await commandStudy(argv.slice(2));
    return;
  }
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);
  if (config.flashcards?.enabled === false) {
    console.error('Flashcards disabled (config.flashcards.enabled=false).');
    process.exitCode = 1;
    return;
  }

  const { createCardStore, buildReviewQueue, exportCardsToTsv, itemPreviewText } =
    await import('@piwin/flashcards');
  const store = createCardStore({ piwinRoot: root });
  const deck = readOption(argv, '--deck');

  if (sub === 'add') {
    const front = collectPositionals(argv.slice(2), ['--back', '--deck', '--tags'])
      .join(' ')
      .trim();
    const back = readOption(argv, '--back');
    if (!front || !back) {
      console.error('Usage: piwin cards add <front> --back <b> [--deck d] [--tags a,b]');
      process.exitCode = 1;
      return;
    }
    const input: {
      front: string;
      back: string;
      deck?: string;
      tags?: string[];
    } = { front, back };
    if (deck) input.deck = deck;
    const tags = readOption(argv, '--tags');
    if (tags)
      input.tags = tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    const card = await store.create(input);
    console.log(`created ${card.id} [${card.deck}]`);
    return;
  }

  if (sub === 'list') {
    const cards = await store.list(deck ? { deck } : undefined);
    for (const card of cards) {
      console.log(
        `${card.id}\t${card.deck}\t${itemPreviewText(card).replaceAll('\n', ' ').slice(0, 80)}`,
      );
    }
    return;
  }

  if (sub === 'decks') {
    for (const name of await store.listDecks()) {
      console.log(name);
    }
    return;
  }

  if (sub === 'show') {
    const cardId = argv[2];
    if (!cardId) {
      console.error('Usage: piwin cards show <id>');
      process.exitCode = 1;
      return;
    }
    const card = await store.read(cardId);
    const state = await store.getReviewState(cardId);
    console.log(JSON.stringify({ card, review: state }, null, 2));
    return;
  }

  if (sub === 'delete') {
    const cardId = argv[2];
    if (!cardId) {
      console.error('Usage: piwin cards delete <id>');
      process.exitCode = 1;
      return;
    }
    await store.delete(cardId);
    console.log(`deleted ${cardId}`);
    return;
  }

  if (sub === 'due' || sub === 'review') {
    const cards = await store.listReviewCards();
    const states = await store.loadReviewStates();
    const queue = buildReviewQueue({
      cards,
      states,
      ...(deck ? { deck } : {}),
      ...(typeof config.flashcards?.newPerDay === 'number'
        ? { newPerDay: config.flashcards.newPerDay }
        : {}),
      ...(typeof config.flashcards?.maxReviewsPerDay === 'number'
        ? { maxReviewsPerDay: config.flashcards.maxReviewsPerDay }
        : {}),
    });

    if (sub === 'due') {
      console.log(`${queue.length} card(s) to review`);
      for (const item of queue) {
        const label = item.isNew ? 'new' : `due ${item.state.due.slice(0, 10)}`;
        console.log(`${item.card.cardId}\t[${label}]\t${item.card.front.slice(0, 70)}`);
      }
      return;
    }

    // Interactive review loop.
    if (queue.length === 0) {
      console.log('No cards due. 🎉'.replace(' 🎉', ''));
      return;
    }
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (prompt: string): Promise<string> =>
      new Promise((resolvePrompt) => readline.question(prompt, resolvePrompt));
    try {
      let position = 0;
      for (const item of queue) {
        position += 1;
        console.log(
          `\n[${position}/${queue.length}] ${item.isNew ? '(new) ' : ''}${item.card.front}`,
        );
        await ask('  press Enter to reveal…');
        console.log(`  → ${item.card.back}`);
        // Only 1-4 commit a rating; anything else re-prompts (a typo must
        // never silently write FSRS state).
        const RATING_KEYS: Record<string, 'again' | 'hard' | 'good' | 'easy'> = {
          '1': 'again',
          '2': 'hard',
          '3': 'good',
          '4': 'easy',
        };
        let rating: 'again' | 'hard' | 'good' | 'easy' | undefined;
        let quit = false;
        while (!rating && !quit) {
          const answer = (await ask('  rate: 1=again 2=hard 3=good 4=easy (q=quit): ')).trim();
          if (answer === 'q') {
            quit = true;
          } else {
            rating = RATING_KEYS[answer];
            if (!rating) console.log('  invalid input — enter 1, 2, 3, 4, or q');
          }
        }
        if (quit || !rating) break;
        const next = await store.rate(item.card.cardId, rating);
        console.log(`  next due: ${next.due.slice(0, 16).replace('T', ' ')}`);
      }
      console.log('\nreview session done');
    } finally {
      readline.close();
    }
    return;
  }

  if (sub === 'export') {
    const cards = await store.listReviewCards(deck ? { deck } : undefined);
    const tsv = exportCardsToTsv(cards);
    const outPath = readOption(argv, '--out');
    if (outPath) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(resolve(outPath), tsv, 'utf8');
      console.log(`exported ${cards.length} card(s) to ${resolve(outPath)}`);
    } else {
      process.stdout.write(tsv);
    }
    return;
  }

  console.error('Usage: piwin cards add|list|decks|show|delete|due|review|export|study');
  process.exitCode = 1;
}
