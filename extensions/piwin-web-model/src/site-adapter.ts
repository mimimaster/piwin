/**
 * Site-agnostic page probing.
 *
 * The adapter contract is intentionally data-only: a site is a set of ordered
 * selector candidates plus its URLs, and the shared probe script turns that into
 * one JSON snapshot. Two consequences we want:
 *
 * - The fragile part (third-party DOM) is isolated in `sites/*.ts` and can be
 *   fixed by editing a selector list, not the driver.
 * - Everything on this side is a pure function of a recorded snapshot, so the
 *   driver logic is unit-testable without a browser.
 *
 * Selector order is most-specific-and-stable first, legacy last. The snapshot
 * reports which candidate actually matched, so a broken site shows up as
 * `assistantSelector: null` instead of an empty transcript.
 */

export interface SiteSelectors {
  /** Where a prompt is typed. First match wins. */
  readonly composer: readonly string[];
  /** One node per assistant turn (outermost container). */
  readonly assistant: readonly string[];
  /** One node per user turn (outermost container). */
  readonly user: readonly string[];
  /** Present only while the page is streaming a reply. */
  readonly generating: readonly string[];
}

export interface SiteDefinition {
  readonly id: string;
  readonly label: string;
  /** Page opened when a conversation tab must be created. */
  readonly homeUrl: string;
  /** Hosts this adapter claims; used to pick an adapter for an existing tab. */
  readonly hosts: readonly string[];
  readonly selectors: SiteSelectors;
}

export interface TranscriptTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface ReplySnapshot {
  readonly url: string;
  readonly title: string;
  readonly generating: boolean;
  /** Which selector reported `generating`, for diagnostics. */
  readonly generatingSelector: string | null;
  readonly composerSelector: string | null;
  readonly assistantSelector: string | null;
  readonly composerEmpty: boolean;
  /** The site refuses input (anonymous chat blocked, verification pending, …). */
  readonly composerDisabled: boolean;
  readonly challengeFrames: readonly string[];
  readonly signedOut: boolean;
  readonly turns: readonly TranscriptTurn[];
}

/**
 * Build the expression evaluated in the page.
 *
 * Returns a plain IIFE string because it is shipped through `Runtime.evaluate`;
 * it must not close over anything from Node.
 */
export function buildProbeScript(site: SiteDefinition): string {
  const selectors = JSON.stringify(site.selectors);
  return `(() => {
  const S = ${selectors};
  const first = (list) => {
    for (const selector of list) {
      try {
        const nodes = [...document.querySelectorAll(selector)];
        if (nodes.length > 0) return { selector, nodes };
      } catch (error) {
        // An invalid selector is a bug in the adapter, not a reason to stop probing.
      }
    }
    return { selector: null, nodes: [] };
  };
  const composerHit = first(S.composer);
  const generatingHit = first(S.generating);
  const assistantHit = first(S.assistant);
  const userHit = first(S.user);
  const tagged = [
    ...assistantHit.nodes.map((node) => ({ role: 'assistant', node })),
    ...userHit.nodes.map((node) => ({ role: 'user', node })),
  ];
  // A turn container often nests another match (article > div[role]); keep the outermost.
  const outermost = tagged.filter((item) => !tagged.some((other) => other !== item && other.node.contains(item.node)));
  outermost.sort((a, b) => {
    if (a.node === b.node) return 0;
    return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  const readText = (node) => {
    const value = node.tagName === 'TEXTAREA' ? node.value : node.innerText;
    return String(value ?? '').trim();
  };
  const bodyText = String(document.body?.innerText ?? '').slice(0, 2000);
  return {
    url: location.href,
    title: document.title,
    generating: generatingHit.nodes.length > 0,
    generatingSelector: generatingHit.selector,
    composerSelector: composerHit.selector,
    assistantSelector: assistantHit.selector,
    composerEmpty: composerHit.nodes.length === 0 || readText(composerHit.nodes[0]) === '',
    composerDisabled:
      composerHit.nodes.length > 0 &&
      (composerHit.nodes[0].disabled === true ||
        composerHit.nodes[0].getAttribute('aria-disabled') === 'true' ||
        composerHit.nodes[0].getAttribute('contenteditable') === 'false'),
    challengeFrames: [...document.querySelectorAll('iframe')]
      .map((frame) => frame.src)
      .filter((src) => /challenges\\.cloudflare\\.com|turnstile|\\/cdn-cgi\\//.test(src)),
    signedOut: /log in|sign in|登录/i.test(bodyText),
    turns: outermost.map((item) => ({ role: item.role, text: readText(item.node) })).filter((turn) => turn.text.length > 0),
  };
})()`;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Defensive reader for whatever the page actually returned. */
export function normalizeSnapshot(value: unknown): ReplySnapshot {
  const record = (value ?? {}) as Record<string, unknown>;
  const turns: TranscriptTurn[] = [];
  for (const item of Array.isArray(record['turns']) ? record['turns'] : []) {
    const turn = (item ?? {}) as Record<string, unknown>;
    const role = turn['role'] === 'assistant' ? 'assistant' : turn['role'] === 'user' ? 'user' : undefined;
    const text = asString(turn['text']);
    if (role !== undefined && text.length > 0) turns.push({ role, text });
  }
  return {
    url: asString(record['url']),
    title: asString(record['title']),
    generating: record['generating'] === true,
    generatingSelector: typeof record['generatingSelector'] === 'string' ? record['generatingSelector'] : null,
    composerSelector: typeof record['composerSelector'] === 'string' ? record['composerSelector'] : null,
    assistantSelector: typeof record['assistantSelector'] === 'string' ? record['assistantSelector'] : null,
    composerEmpty: record['composerEmpty'] !== false,
    composerDisabled: record['composerDisabled'] === true,
    challengeFrames: asStringArray(record['challengeFrames']),
    signedOut: record['signedOut'] === true,
    turns,
  };
}

/** Text of the last assistant turn, or undefined before any reply exists. */
export function latestAssistantText(snapshot: ReplySnapshot): string | undefined {
  for (let index = snapshot.turns.length - 1; index >= 0; index -= 1) {
    const turn = snapshot.turns[index];
    if (turn?.role === 'assistant') return turn.text;
  }
  return undefined;
}

/**
 * A reply is settled when the page stopped streaming and the text stopped
 * growing. Both halves matter: `generating` alone flaps on pages that render the
 * stop button late, and text-stability alone would fire between deltas.
 */
export function isSettled(previous: ReplySnapshot | undefined, current: ReplySnapshot): boolean {
  if (current.generating) return false;
  const currentText = latestAssistantText(current);
  if (currentText === undefined) return false;
  const previousText = previous === undefined ? undefined : latestAssistantText(previous);
  return previousText === currentText;
}

/**
 * Has the page produced anything since `baseline`?
 *
 * Without this guard a reused tab settles on the previous turn's text: the
 * reply is already on screen and unchanged, which `isSettled` alone would read
 * as "this turn finished". A new conversation URL counts as new, because the
 * site may replace the whole transcript per message.
 */
export function hasNewReply(baseline: ReplySnapshot, current: ReplySnapshot): boolean {
  if (current.url !== baseline.url) return true;
  if (current.turns.length > baseline.turns.length) return true;
  return latestAssistantText(current) !== latestAssistantText(baseline);
}

/** Human-readable reason a snapshot is not usable yet, or undefined when it is. */
export function describeBlocker(snapshot: ReplySnapshot): string | undefined {
  if (snapshot.challengeFrames.length > 0) {
    return `the page is showing a verification challenge (${snapshot.challengeFrames[0]}); finish it in the Chrome window`;
  }
  if (snapshot.composerSelector === null) {
    return `no prompt box found at ${snapshot.url}; the site layout may have changed`;
  }
  if (snapshot.composerDisabled) {
    return (
      `the prompt box at ${snapshot.url} is disabled — the site is refusing further input ` +
      `(anonymous quota or verification). Sign in once in the Chrome window.`
    );
  }
  // Deliberately not a blocker: chatgpt.com answers guests, and Claude's login
  // wall already shows up as a missing prompt box. `signedOut` is diagnostics.
  return undefined;
}

/** Hint for error text when a signed-out page never produced a reply. */
export function signedOutHint(snapshot: ReplySnapshot): string | undefined {
  return snapshot.signedOut ? 'the page looks signed out; sign in once in the Chrome window for subscription access' : undefined;
}
