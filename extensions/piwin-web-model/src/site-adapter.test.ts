/**
 * Driver-side golden cases.
 *
 * The probe script itself cannot be executed here (no page), so it is checked
 * two ways instead: it must parse as JavaScript, and it must carry every
 * selector the adapter declares. The rest of the driver is tested against
 * recorded snapshots, which is what makes the settle logic reviewable.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildProbeScript,
  describeBlocker,
  isSettled,
  latestAssistantText,
  normalizeSnapshot,
  hasNewReply,
  signedOutHint,
  type ReplySnapshot,
} from './site-adapter.ts';
import { chatgptSite, claudeSite, findSiteById, findSiteForUrl, SITES } from './sites/index.ts';

/** Recorded-shaped snapshot: a signed-in chat with one finished exchange. */
function settledSnapshot(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    url: 'https://chatgpt.com/c/abc',
    title: 'ChatGPT',
    generating: false,
    generatingSelector: null,
    composerSelector: 'div#prompt-textarea[contenteditable="true"]',
    assistantSelector: '[data-message-author-role="assistant"]',
    composerEmpty: true,
    challengeFrames: [],
    signedOut: false,
    turns: [
      { role: 'user', text: 'say hi' },
      { role: 'assistant', text: 'hi' },
    ],
    ...overrides,
  };
}

test('probe script parses as JavaScript for every registered site', () => {
  for (const site of SITES) {
    const script = buildProbeScript(site);
    assert.doesNotThrow(() => new Function(`return ${script}`), `${site.id} probe script is not valid JS`);
  }
});

test('probe script carries every declared selector', () => {
  for (const site of SITES) {
    const script = buildProbeScript(site);
    const all = [
      ...site.selectors.composer,
      ...site.selectors.assistant,
      ...site.selectors.user,
      ...site.selectors.generating,
    ];
    for (const selector of all) {
      assert.ok(script.includes(JSON.stringify(selector).slice(1, -1)), `${site.id} lost selector ${selector}`);
    }
  }
});

test('normalizeSnapshot keeps a well-formed turn list in page order', () => {
  const snapshot = normalizeSnapshot(settledSnapshot());
  assert.deepEqual(
    snapshot.turns.map((turn) => `${turn.role}:${turn.text}`),
    ['user:say hi', 'assistant:hi'],
  );
  assert.equal(snapshot.generating, false);
  assert.equal(snapshot.composerEmpty, true);
});

test('normalizeSnapshot drops malformed turns and defaults the rest', () => {
  const snapshot = normalizeSnapshot({
    turns: [{ role: 'system', text: 'nope' }, { role: 'assistant' }, { role: 'assistant', text: 'ok' }, null],
    generating: 'yes',
    challengeFrames: ['https://x', 42],
  });
  assert.deepEqual(snapshot.turns, [{ role: 'assistant', text: 'ok' }]);
  assert.equal(snapshot.generating, false, 'a truthy-but-not-true flag must not count as streaming');
  assert.deepEqual(snapshot.challengeFrames, ['https://x']);
  assert.equal(snapshot.url, '');
  assert.equal(snapshot.composerSelector, null);
});

test('normalizeSnapshot survives a completely wrong payload', () => {
  for (const junk of [undefined, null, 0, 'text', []]) {
    const snapshot = normalizeSnapshot(junk);
    assert.deepEqual(snapshot.turns, []);
    assert.equal(snapshot.generating, false);
  }
});

test('latestAssistantText ignores trailing user turns', () => {
  const snapshot = normalizeSnapshot(
    settledSnapshot({
      turns: [
        { role: 'assistant', text: 'first' },
        { role: 'user', text: 'again' },
        { role: 'assistant', text: 'second' },
      ],
    }),
  );
  assert.equal(latestAssistantText(snapshot), 'second');
  assert.equal(latestAssistantText(normalizeSnapshot({ turns: [] })), undefined);
});

test('isSettled requires both stopped streaming and stable text', () => {
  const done = normalizeSnapshot(settledSnapshot());
  const streaming = normalizeSnapshot(settledSnapshot({ generating: true }));
  const longer = normalizeSnapshot(settledSnapshot({ turns: [{ role: 'assistant', text: 'hi there' }] }));

  assert.equal(isSettled(done, done), true, 'identical, not generating → settled');
  assert.equal(isSettled(done, streaming), false, 'still generating → not settled');
  assert.equal(isSettled(done, longer), false, 'text grew → not settled yet');
  assert.equal(isSettled(undefined, done), false, 'first sighting is never evidence of completion');
  assert.equal(isSettled(undefined, normalizeSnapshot(settledSnapshot({ turns: [] }))), false, 'no reply at all');
});

test('describeBlocker names the hard obstacles and does not treat signed-out as one', () => {
  const challenge = normalizeSnapshot(settledSnapshot({ challengeFrames: ['https://challenges.cloudflare.com/x'] }));
  const noComposer = normalizeSnapshot(settledSnapshot({ composerSelector: null }));
  const signedOut = normalizeSnapshot(settledSnapshot({ signedOut: true }));

  assert.match(describeBlocker(challenge) ?? '', /verification challenge/);
  assert.match(describeBlocker(noComposer) ?? '', /no prompt box/);
  assert.equal(describeBlocker(signedOut), undefined, 'chatgpt.com answers guests, so signed-out cannot block typing');

  const disabled = normalizeSnapshot(settledSnapshot({ composerDisabled: true }));
  assert.match(describeBlocker(disabled) ?? '', /disabled/);
  assert.match(describeBlocker(disabled) ?? '', /Sign in once/);
  assert.match(signedOutHint(signedOut) ?? '', /looks signed out/);
  assert.equal(signedOutHint(normalizeSnapshot(settledSnapshot())), undefined);
  assert.equal(describeBlocker(normalizeSnapshot(settledSnapshot())), undefined);
});

test('site registry resolves hosts and ids', () => {
  assert.equal(findSiteById('chatgpt-web')?.id, 'chatgpt-web');
  assert.equal(findSiteById('nope'), undefined);
  assert.equal(findSiteForUrl('https://chatgpt.com/uc/6ae99994-abc')?.id, 'chatgpt-web');
  assert.equal(findSiteForUrl('https://chat.openai.com/c/1')?.id, 'chatgpt-web');
  assert.equal(findSiteForUrl('https://claude.ai/new')?.id, 'claude-web');
  assert.equal(findSiteForUrl('https://example.com/'), undefined);
  assert.equal(findSiteForUrl('not a url'), undefined);
  assert.equal(chatgptSite.hosts.length > 0 && claudeSite.hosts.length > 0, true);
});

test('a snapshot before any reply is not mistaken for an empty answer', () => {
  const waiting: ReplySnapshot = normalizeSnapshot(
    settledSnapshot({ turns: [{ role: 'user', text: 'say hi' }], generating: true }),
  );
  assert.equal(latestAssistantText(waiting), undefined);
  assert.equal(isSettled(undefined, waiting), false);
});

test('hasNewReply rejects a reused tab that still shows the previous turn', () => {
  const baseline = normalizeSnapshot(settledSnapshot());
  const identical = normalizeSnapshot(settledSnapshot());
  const longer = normalizeSnapshot(
    settledSnapshot({
      turns: [
        { role: 'user', text: 'say hi' },
        { role: 'assistant', text: 'hi' },
        { role: 'user', text: 'again' },
        { role: 'assistant', text: 'hi' },
      ],
    }),
  );
  const differentText = normalizeSnapshot(settledSnapshot({ turns: [{ role: 'assistant', text: 'hello again' }] }));
  const newConversation = normalizeSnapshot(settledSnapshot({ url: 'https://chatgpt.com/c/def' }));

  assert.equal(hasNewReply(baseline, identical), false, 'unchanged page must not count as a new reply');
  assert.equal(hasNewReply(baseline, longer), true, 'a new turn is new');
  assert.equal(hasNewReply(baseline, differentText), true, 'changed assistant text is new');
  assert.equal(hasNewReply(baseline, newConversation), true, 'a new conversation URL is new');

  // The stale-read bug this guards: identical page is "settled" but not "new".
  assert.equal(isSettled(baseline, identical), true);
});
