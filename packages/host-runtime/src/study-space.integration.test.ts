import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStudySpaceFixture } from './study-space.test-fixture.js';

function systemOf(request: Record<string, unknown> | undefined): string {
  if (!request) throw new Error('No real provider request');
  const messages = request.messages as Array<{ role: string; content: unknown }>;
  return messages.filter(message => message.role === 'system' || message.role === 'developer').map(message => String(message.content)).join('\n');
}

describe('Study Space with real Pi transports and native Host tools', () => {
  it.each(['sdk', 'rpc'] as const)('%s: learn -> progress -> sourced native cards -> review stays native -> replacement -> resume by name -> off', async mode => {
    const f = await openStudySpaceFixture(mode);
    try {
      await f.prompt('Ordinary coding before any study command.');
      expect(systemOf(f.requests.at(-1))).not.toContain('<study-space');
      await f.prompt('/unregistered-command is ordinary text');
      expect(JSON.stringify(f.requests.at(-1))).toContain('Host instructions and history.');

      const requestsBefore = f.requests.length;
      await f.prompt('/learn file lifecycle');
      expect(f.requests).toHaveLength(requestsBefore);
      let topic = await f.topic();
      expect(topic).toMatchObject({ topic: 'file lifecycle', deck: 'file lifecycle', concepts: [] });
      await f.prompt('开始');
      const learning = systemOf(f.requests.at(-1));
      expect(learning).toContain('<study-space mode="learn">');
      expect(learning).toContain('"topic":"file lifecycle"');

      await f.tool('study_space', { action: 'plan', concepts: [{ name: 'descriptors' }, { name: 'finally cleanup' }] });
      await f.tool('study_space', { action: 'concept', name: 'descriptors', status: 'done', wiki: 'File descriptors', weak: ['thought close was optional'] }, 'My answer: closing is optional.');
      topic = await f.topic();
      expect(topic.concepts).toEqual([
        { name: 'descriptors', status: 'done', wiki: 'File descriptors', weak: ['thought close was optional'] },
        { name: 'finally cleanup', status: 'planned', wiki: null, weak: [] },
      ]);

      const source = { deck: topic.deck, tags: ['file lifecycle'], sourceExcerpt: 'Closing releases the descriptor.', sourceFolder: join(f.root, 'wiki'), sourceFile: 'concepts/file-descriptors.md' };
      await f.native('flashcard_batch_create', { cards: [
        { model: 'basic', front: 'Why close a file?', back: 'Release descriptors.', ...source },
        { model: 'basic', front: 'Why use finally?', back: 'Release even after errors.', ...source },
      ] });
      const cards = await f.services.cardStore.list({ deck: 'file lifecycle' });
      expect(cards).toHaveLength(2);
      expect(cards[0]).toMatchObject({ sourceExcerpt: 'Closing releases the descriptor.', sourceFile: 'concepts/file-descriptors.md' });
      // Consent is the Host's approval prompt; the extension adds no dialog of its own.
      expect(f.dialogs).toEqual([]);

      await f.prompt('/review');
      await f.native('flashcard_study_write', { action: 'start', mode: 'scheduled', scope: { kind: 'deck', deck: topic.deck }, resumeExisting: true, idempotencyKey: 'review-start' });
      expect(JSON.stringify(f.requests.at(-1))).toContain('闪卡面板');
      expect(() => f.snapshot()).toThrow('No native snapshot');
      expect(systemOf(f.requests.at(-1))).toContain('<study-space mode="review">');

      // The Host rebuilds Pi with a new session identity: study mode starts off and is resumed by name.
      await f.replace();
      await f.prompt('Ordinary coding after runtime replacement.');
      expect(systemOf(f.requests.at(-1))).not.toContain('<study-space');
      await f.prompt('/learn File Lifecycle');
      await f.prompt('继续');
      const resumed = systemOf(f.requests.at(-1));
      expect(resumed).toContain('<study-space mode="learn">');
      expect(resumed).toContain('thought close was optional');
      expect((await f.topic()).topicId).toBe(topic.topicId);
      expect(await f.services.cardStore.list({ deck: 'file lifecycle' })).toHaveLength(2);

      await f.prompt('/study off');
      await f.prompt('Return to ordinary coding.');
      expect(systemOf(f.requests.at(-1))).not.toContain('<study-space');
    } finally { await f.close(); }
  }, 90000);
});
