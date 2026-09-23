import { expect, test, type Page } from '@playwright/test';

/**
 * Long-session history scrolling (?e2eLongSession=1): 13 turns, one a
 * 200-step agent run folded into a single row, several 25k-character replies.
 * Wheeling from the live tail to the first message must move the content the
 * reader is looking at by exactly the wheel delta — no cascade to the session
 * start, no page shoving the view — and must reach the beginning.
 */
const TITLE = '长会话 · 13 轮 / 1 轮 200 步';
const STEP = 500;

async function openLongSession(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?e2eLongSession=1');
  await page.getByRole('button', { name: '使用本机', exact: true }).click();
  await page.getByTestId('sidebar-mode-code').click();
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill('/mock/piwin');
  await page.getByTestId('open-project-btn').click();
  await page.getByTestId('empty-stage-landing-row').filter({ hasText: TITLE }).click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
}

type Reading = { id: string; y: number; scrollTop: number } | null;

function readReading(page: Page): Promise<Reading> {
  return page.getByRole('log', { name: 'Conversation' }).evaluate((stream) => {
    const top = stream.getBoundingClientRect().top;
    let best: { id: string; y: number } | null = null;
    for (const element of stream.querySelectorAll('[id^="msg-"]')) {
      const rect = element.getBoundingClientRect();
      if (rect.height > 0 && rect.bottom > top + 4 && (!best || rect.top - top < best.y)) {
        best = { id: element.id, y: rect.top - top };
      }
    }
    return best ? { ...best, scrollTop: stream.scrollTop } : null;
  });
}

function positionOf(page: Page, id: string): Promise<number | null> {
  return page.getByRole('log', { name: 'Conversation' }).evaluate((stream, anchorId) => {
    const element = document.getElementById(anchorId);
    return element ? element.getBoundingClientRect().top - stream.getBoundingClientRect().top : null;
  }, id);
}

test('wheels a long session to its first message without the view jumping', async ({ page }) => {
  test.setTimeout(180_000);
  await openLongSession(page);
  const stream = page.getByRole('log', { name: 'Conversation' });
  const box = await stream.boundingBox();
  if (!box) throw new Error('Expected the transcript scroll element');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const jumps: string[] = [];
  let previous = await readReading(page);
  let reachedStart = false;
  for (let step = 0; step < 400 && previous; step += 1) {
    await page.mouse.wheel(0, -STEP);
    await page.waitForTimeout(160);
    const moved = await positionOf(page, previous.id);
    const current = await readReading(page);
    // A full wheel step is only possible when the reader was not at the top
    // edge; near the edge the wheel clamps and paging takes over.
    if (previous.scrollTop >= STEP) {
      if (moved === null) {
        jumps.push(`step ${step}: ${previous.id} left the window`);
      } else if (Math.abs(moved - previous.y - STEP) > 160) {
        jumps.push(`step ${step}: ${previous.id} moved ${Math.round(moved - previous.y)}px`);
      }
    }
    if (current?.id === 'msg-long-u01' && current.scrollTop <= 2) {
      reachedStart = true;
      break;
    }
    previous = current;
  }

  expect(jumps).toEqual([]);
  expect(reachedStart).toBe(true);
});
