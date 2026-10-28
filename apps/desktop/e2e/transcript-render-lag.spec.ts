import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * Render-lag probe on the long-session fixture (?e2eLongSession=1, synthetic
 * content only). Samples every frame — opening cover, visible message
 * anchors, the last reply's text — plus layout-shift and long-task entries,
 * and times four flows: cold open, send + stream, warm switch back, and a
 * switch back to a history position. Measurements are attached to the test
 * report; the gates are the budgets in `RENDER_BUDGET`.
 */
const TITLE = '长会话 · 13 轮 / 1 轮 200 步';
// "fairly long reply" makes the mock stream ~80 chunks at its slower 35ms cadence.
const PROMPT = 'Render lag probe: please give a fairly long reply.';

type Frame = {
  at: number;
  cover: boolean;
  session: string | null;
  anchors: Array<{ id: string; top: number }>;
  chunks: number;
  userBubbles: number;
};
type Sampled = {
  frames: Frame[];
  shifts: Array<{ at: number; value: number; input: boolean }>;
  longTasks: Array<{ at: number; duration: number }>;
  inputs: Array<{ at: number; type: string }>;
  pushes: Array<{ messageId: string; text: string; at: number }>;
};

async function installSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as { __lag?: Sampled; __piwinStreamProbe?: Sampled['pushes'] };
    const pushes: Sampled['pushes'] = [];
    target.__piwinStreamProbe = pushes;
    const lag: Sampled = { frames: [], shifts: [], longTasks: [], inputs: [], pushes };
    target.__lag = lag;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        lag.shifts.push({ at: entry.startTime, value: entry.value, input: entry.hadRecentInput });
      }
    }).observe({ type: 'layout-shift' });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) lag.longTasks.push({ at: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask' });
    for (const type of ['pointerdown', 'wheel', 'keydown']) {
      document.addEventListener(type, (event) => lag.inputs.push({ at: event.timeStamp, type }), {
        capture: true,
        passive: true,
      });
    }
    const sample = (): void => {
      const stream = document.querySelector<HTMLElement>('[data-testid="chat-stream"]');
      const anchors: Frame['anchors'] = [];
      let chunks = 0;
      let userBubbles = 0;
      if (stream) {
        const box = stream.getBoundingClientRect();
        for (const element of stream.querySelectorAll('[id^="msg-"]')) {
          const rect = element.getBoundingClientRect();
          if (rect.height > 0 && rect.bottom > box.top && rect.top < box.bottom && anchors.length < 8) {
            anchors.push({ id: element.id, top: Math.round(rect.top - box.top) });
          }
        }
        const replies = stream.querySelectorAll('[data-testid="message-bubble"][data-role="assistant"]');
        chunks = (replies[replies.length - 1]?.textContent?.match(/chunk/g) ?? []).length;
        userBubbles = stream.querySelectorAll('[data-testid="message-bubble"][data-role="user"]').length;
      }
      lag.frames.push({
        at: performance.now(),
        cover: document.querySelector('[data-testid="transcript-opening-state"]') !== null,
        session: stream?.getAttribute('data-artifact-layout-session') ?? null,
        anchors,
        chunks,
        userBubbles,
      });
      requestAnimationFrame(afterPaint);
    };
    // rAF runs before this frame's layout and ResizeObserver callbacks; a
    // task posted from it runs after the frame is painted, so the sample is
    // what the reader saw, not an intermediate state the observers fixed.
    const channel = new MessageChannel();
    channel.port1.onmessage = sample;
    const afterPaint = (): void => channel.port2.postMessage(null);
    requestAnimationFrame(afterPaint);
  });
}

function readSampled(page: Page): Promise<Sampled> {
  return page.evaluate(() => (window as unknown as { __lag: Sampled }).__lag);
}

function lastInputBefore(sampled: Sampled, at: number): number | null {
  const inputs = sampled.inputs.filter((input) => input.at <= at);
  return inputs.at(-1)?.at ?? null;
}

/** Visible anchors that moved between consecutive frames with no input in between. */
type Jump = { afterMs: number; px: number; id: string };

function findJumps(frames: Frame[], sampled: Sampled, fromAt: number): Jump[] {
  const jumps: Jump[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    if (!previous || !current || current.at < fromAt) continue;
    if (current.cover || previous.cover || current.session !== previous.session) continue;
    const input = lastInputBefore(sampled, current.at);
    if (input !== null && input > previous.at - 50) continue;
    let moved = 0;
    let movedId = '';
    for (const anchor of current.anchors) {
      const before = previous.anchors.find((candidate) => candidate.id === anchor.id);
      if (before && Math.abs(anchor.top - before.top) > Math.abs(moved)) {
        moved = anchor.top - before.top;
        movedId = anchor.id;
      }
    }
    if (Math.abs(moved) > 1) jumps.push({ afterMs: Math.round(current.at - fromAt), px: moved, id: movedId });
  }
  return jumps;
}

type OpenReport = {
  /** Input → the next painted frame: how long the click got no visible answer. */
  toNextFrameMs: number | null;
  /** Input → first frame whose transcript belongs to the target session. */
  toSessionSwapMs: number | null;
  toFirstContentMs: number | null;
  coveredMs: number;
  /** Longest frame-to-frame gap: the main thread did not paint for this long. */
  longestFrameMs: number;
  jumps: Jump[];
  shiftScore: number;
  longTaskMs: number;
};

/** The user's click (first pointerdown after `startAt`), not when the test asked for it. */
function inputAfter(sampled: Sampled, startAt: number): number {
  return sampled.inputs.find((input) => input.at >= startAt && input.type !== 'wheel')?.at ?? startAt;
}

/** Frames from the last one painted before the input, so a block that starts at the click counts. */
function framesFrom(sampled: Sampled, startAt: number, endAt: number): Frame[] {
  const firstAfter = sampled.frames.findIndex((frame) => frame.at >= startAt);
  if (firstAfter < 0) return [];
  return sampled.frames.slice(Math.max(0, firstAfter - 1)).filter((frame) => frame.at <= endAt);
}

function longestFrame(frames: Frame[]): number {
  let longest = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const previous = frames[index - 1];
    if (frame && previous) longest = Math.max(longest, frame.at - previous.at);
  }
  return Math.round(longest);
}

function analyzeOpen(sampled: Sampled, requestedAt: number, endAt: number, sessionId: string): OpenReport {
  const startAt = inputAfter(sampled, requestedAt);
  const withBefore = framesFrom(sampled, startAt, endAt);
  const frames = withBefore.filter((frame) => frame.at >= startAt);
  const swap = frames.find((frame) => frame.session === sessionId);
  const first = frames.find(
    (frame) => !frame.cover && frame.session === sessionId && frame.anchors.length > 0,
  );
  let coveredMs = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const previous = frames[index - 1];
    if (frame && previous && previous.cover) coveredMs += frame.at - previous.at;
  }
  return {
    toNextFrameMs: frames[0] ? Math.round(frames[0].at - startAt) : null,
    toSessionSwapMs: swap ? Math.round(swap.at - startAt) : null,
    toFirstContentMs: first ? Math.round(first.at - startAt) : null,
    coveredMs: Math.round(coveredMs),
    longestFrameMs: longestFrame(withBefore),
    jumps: first ? findJumps(frames, sampled, first.at) : [],
    shiftScore: Number(
      sampled.shifts
        .filter((shift) => !shift.input && shift.at >= (first?.at ?? startAt) && shift.at <= endAt)
        .reduce((sum, shift) => sum + shift.value, 0)
        .toFixed(4),
    ),
    longTaskMs: Math.round(
      sampled.longTasks
        .filter((task) => task.at + task.duration >= startAt && task.at <= endAt)
        .reduce((sum, task) => sum + task.duration, 0),
    ),
  };
}

type StreamReport = {
  toUserBubbleMs: number | null;
  longestFrameMs: number;
  deltas: number;
  latencyMs: { p50: number; p95: number; max: number };
  jumpsAfterEnd: Jump[];
  longTaskMs: number;
};

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0);
}

function analyzeStream(sampled: Sampled, requestedAt: number, endAt: number, userBubblesBefore: number): StreamReport {
  const startAt = inputAfter(sampled, requestedAt);
  const withBefore = framesFrom(sampled, startAt, endAt);
  const frames = withBefore.filter((frame) => frame.at >= startAt);
  const bubble = frames.find((frame) => frame.userBubbles > userBubblesBefore);
  const pushes = sampled.pushes.filter((push) => push.at >= startAt && push.at <= endAt);
  const latencies: number[] = [];
  for (const push of pushes) {
    const wanted = (push.text.match(/chunk/g) ?? []).length;
    if (wanted === 0) continue;
    const painted = frames.find((frame) => frame.at >= push.at && frame.chunks >= wanted);
    if (painted) latencies.push(painted.at - push.at);
  }
  const lastPush = pushes.at(-1)?.at ?? startAt;
  return {
    toUserBubbleMs: bubble ? Math.round(bubble.at - startAt) : null,
    longestFrameMs: longestFrame(withBefore),
    deltas: latencies.length,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: Math.round(Math.max(0, ...latencies)),
    },
    // After the last delta the reply settles (streaming → completed render).
    jumpsAfterEnd: findJumps(frames, sampled, lastPush + 1),
    longTaskMs: Math.round(
      sampled.longTasks
        .filter((task) => task.at + task.duration >= startAt && task.at <= endAt)
        .reduce((sum, task) => sum + task.duration, 0),
    ),
  };
}

async function now(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

async function settle(page: Page, ms: number): Promise<number> {
  await page.waitForTimeout(ms);
  return now(page);
}

async function activeSessionId(page: Page): Promise<string> {
  return (await page.getByTestId('chat-stream').getAttribute('data-artifact-layout-session')) ?? '';
}

async function attach(testInfo: TestInfo, name: string, report: unknown): Promise<void> {
  console.log(`[render-lag] ${name} ${JSON.stringify(report)}`);
  await testInfo.attach(name, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
}

async function openFixtureProject(page: Page): Promise<void> {
  await page.goto('/?e2eLongSession=1');
  await page.getByRole('button', { name: '使用本机', exact: true }).click();
  await page.getByTestId('sidebar-mode-code').click();
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill('/mock/piwin');
  await page.getByTestId('open-project-btn').click();
}

/**
 * Gates are structural (no cover where none belongs, nothing moves under the
 * reader, a delta paints within a few frames) plus loose time ceilings: this
 * runs on the dev server, where React's development build makes every render
 * several times slower than the shipped app. Production timings are recorded
 * in docs/specs/long-session-reading-position.md.
 */
const RENDER_BUDGET = {
  streamDeltaToPaintP95Ms: 50,
  /** Cold open after a restart, with row heights restored from storage. */
  cachedReopenCoverMs: 150,
};

test('render lag: cold open, stream, warm switch, history return, cached reopen', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openFixtureProject(page);
  await installSampler(page);

  // 1. Cold open: nothing cached for this session yet.
  let start = await now(page);
  await page.getByTestId('empty-stage-landing-row').filter({ hasText: TITLE }).click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
  const longSessionId = await activeSessionId(page);
  let end = await settle(page, 1_500);
  const coldOpen = analyzeOpen(await readSampled(page), start, end, longSessionId);
  await attach(testInfo, 'cold-open', coldOpen);

  // 2. New session: send, then watch every delta reach the screen.
  await page.getByTestId('new-session-btn-sb-top').click();
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  const bubblesBefore = await page.locator('[data-testid="message-bubble"][data-role="user"]').count();
  await page.getByTestId('composer-input').fill(PROMPT);
  start = await now(page);
  await page.getByTestId('send-btn').click();
  await expect(
    page.locator('[data-testid="message-bubble"][data-role="assistant"]', { hasText: 'chunk chunk' }),
  ).toBeVisible();
  await expect(page.getByTestId('send-btn')).toBeVisible({ timeout: 20_000 });
  end = await settle(page, 1_500);
  const stream = analyzeStream(await readSampled(page), start, end, bubblesBefore);
  await attach(testInfo, 'send-and-stream', stream);
  const newSessionId = await activeSessionId(page);

  // 3. Warm switch back to the long session (left for a New Agent draft).
  start = await now(page);
  await page.getByTestId('session-item').filter({ hasText: TITLE }).first().click();
  await expect.poll(() => activeSessionId(page)).toBe(longSessionId);
  end = await settle(page, 1_500);
  const warmBack = analyzeOpen(await readSampled(page), start, end, longSessionId);
  await attach(testInfo, 'warm-switch-back', warmBack);

  // 4. Read history, switch away, come back: the reading position restores.
  const log = page.getByRole('log', { name: 'Conversation' });
  const box = await log.boundingBox();
  if (!box) throw new Error('Expected the transcript scroll element');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(600);
  await page.getByTestId('session-item').filter({ hasNotText: TITLE }).first().click();
  await expect.poll(() => activeSessionId(page)).toBe(newSessionId);
  await page.waitForTimeout(600);
  start = await now(page);
  await page.getByTestId('session-item').filter({ hasText: TITLE }).first().click();
  await expect.poll(() => activeSessionId(page)).toBe(longSessionId);
  end = await settle(page, 2_000);
  const historyBack = analyzeOpen(await readSampled(page), start, end, longSessionId);
  await attach(testInfo, 'history-switch-back', historyBack);

  // 5. Back at the tail, restart, open again: heights come from storage.
  // Leave for a draft first so the restart does not resume the session itself.
  await page.getByTestId('jump-to-latest-btn').click();
  await page.waitForTimeout(1_500);
  await page.getByTestId('new-session-btn-sb-top').click();
  await page.reload();
  const chooseLocal = page.getByRole('button', { name: '使用本机', exact: true });
  if (await chooseLocal.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) {
    await chooseLocal.click();
  }
  const sessionRow = page.getByTestId('session-item').filter({ hasText: TITLE }).first();
  if (!(await sessionRow.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false))) {
    await page.getByTestId('sidebar-mode-code').click();
    await page.getByTestId('open-workspace-btn').click();
    await page.getByTestId('project-path-input').fill('/mock/piwin');
    await page.getByTestId('open-project-btn').click();
  }
  await page.waitForTimeout(500);
  await installSampler(page);
  start = await now(page);
  await sessionRow.click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
  end = await settle(page, 1_500);
  const cachedReopen = analyzeOpen(await readSampled(page), start, end, longSessionId);
  await attach(testInfo, 'cached-reopen', cachedReopen);

  for (const [name, report] of Object.entries({ coldOpen, warmBack, historyBack, cachedReopen })) {
    expect(report.toFirstContentMs, `${name} shows the session`).not.toBeNull();
    expect(report.jumps, `${name} moves nothing under the reader`).toEqual([]);
  }
  expect(stream.jumpsAfterEnd, 'a settled reply does not move').toEqual([]);
  expect(stream.latencyMs.p95).toBeLessThanOrEqual(RENDER_BUDGET.streamDeltaToPaintP95Ms);
  // A warm session paints at once: no cover, content in the first new frame.
  expect(warmBack.coveredMs).toBe(0);
  expect(warmBack.toFirstContentMs).toBe(warmBack.toSessionSwapMs);
  expect(historyBack.coveredMs).toBe(0);
  expect(cachedReopen.coveredMs).toBeLessThanOrEqual(RENDER_BUDGET.cachedReopenCoverMs);
});
