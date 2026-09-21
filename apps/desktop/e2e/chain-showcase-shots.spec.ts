import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Docs screenshots: two fabricated conversations (?e2eChainShowcase=1) captured
 * from the shipping shell. The fixture only fabricates data; every card here is
 * rendered by the real transcript components in the bundled ink face.
 *
 *   pnpm --dir apps/desktop exec playwright test chain-showcase-shots
 */
const OUT_DIR = resolve(process.cwd(), '../../docs/design/inkstone/shots');

// 2x captures; must be set before page.goto() (see e2e/README.md contract).
test.use({ deviceScaleFactor: 2 });

async function openShowcase(page: Page, selector: string, sessionName: string): Promise<void> {
  // One session per run: the landing list only offers the 4 most recent.
  await page.goto(`/?e2eChainShowcase=${selector}`);
  // Same gate affordance the parity suite uses (the standalone-web wall is a
  // different component than the Tauri `host-gate-use-local` button).
  await page.getByRole('button', { name: '使用本机', exact: true }).click();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await page.getByTestId('sidebar-mode-code').click();
  await expect(page.getByTestId('open-workspace-btn')).toBeVisible();
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill('/mock/piwin');
  await page.getByTestId('open-project-btn').click();
  await page
    .getByTestId('empty-stage-landing-row')
    .filter({ hasText: sessionName })
    .click();
  // Transcript rows: the seeded turns render as the real conversation log.
  await expect(page.getByRole('log', { name: 'Conversation' })).toBeVisible();
  await expandWorkFold(page);
  await expandBatchCapsules(page);
  // Fixture markdown/streamdown settles after fonts; keep the shot deterministic.
  await page.evaluate(() => document.fonts?.ready);
  await fitTurn(page);
}

/**
 * Historical turns open with the work fold closed; a docs shot needs the chain
 * itself, so open it the way a reader would (no-op when rows are already inline).
 */
async function expandWorkFold(page: Page): Promise<void> {
  // Collapsed folds keep their children in the DOM but display:none, so probe
  // visibility rather than count. Turns render either the WorkFoldHeader
  // (`已工作 …`) or the newer turn-work-details trigger; try both.
  const rows = page.locator(
    '[data-testid="tool-call-card"], [data-testid="subagent-invocation-block"]',
  );
  if (await rows.first().isVisible().catch(() => false)) return;
  const candidates = [
    page.getByRole('button', { name: /已工作/ }).first(),
    page.getByTestId('turn-work-details-summary').first(),
  ];
  for (const trigger of candidates) {
    if ((await trigger.count()) === 0) continue;
    if (!(await trigger.isVisible().catch(() => false))) continue;
    await trigger.click();
    await page.waitForTimeout(500);
    if (await rows.first().isVisible().catch(() => false)) return;
  }
}

/** Open read-only batch capsules (探索 flow) so their child rows are in frame. */
async function expandBatchCapsules(page: Page): Promise<void> {
  const headers = page.getByTestId('tool-batch-header');
  for (let index = 0; index < (await headers.count()); index += 1) {
    const body = page.getByTestId('tool-batch-body').nth(index);
    if (await body.isVisible().catch(() => false)) continue;
    await headers.nth(index).click();
    await page.waitForTimeout(250);
  }
}

/**
 * Grow the window until the whole turn is on screen: a docs shot must show the
 * entire chain, not whatever fits a default window. Pure viewport resize (no
 * post-navigation media emulation), so the 2x capture contract stays intact.
 */
async function fitTurn(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const overflow = await page.locator('.chat-stream').evaluate((element) => ({
      overflow: element.scrollHeight - element.clientHeight,
    }));
    if (overflow.overflow <= 0) break;
    const size = page.viewportSize();
    if (!size) throw new Error('Missing viewport size');
    await page.setViewportSize({ width: size.width, height: size.height + overflow.overflow + 16 });
  }
  await page.locator('.chat-stream').evaluate((element) => {
    element.scrollTop = 0;
  });
}

test('endpoint loop chain @ink', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1180 });
  await openShowcase(page, 'endpoint', '端上闭环');
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-inkstone-ink');
  await expect(page.locator('[data-testid="tool-call-card"]')).toHaveCount(8);
  await page.screenshot({ path: resolve(OUT_DIR, '01-endpoint-loop.png'), animations: 'disabled' });
});

test('research and persist chain @ink', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1560 });
  await openShowcase(page, 'research', 'artifact 沙箱 CSP');
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-inkstone-ink');
  // Chain surfaces that must be in frame: explore capsule, error row, plan gate,
  // inline diff, subagent wait row, goal delivery, files-changed bar.
  await expect(page.getByTestId('plan-todo-tray')).toBeVisible();
  await expect(page.getByTestId('files-changed-bar')).toBeVisible();
  await expect(page.locator('[data-testid="tool-card-context-menu"]')).toHaveCount(0);
  await expect(page.getByText('目标已达成')).toBeVisible();
  await expect(page.getByText('已等待', { exact: false }).first()).toBeVisible();
  await page.screenshot({
    path: resolve(OUT_DIR, '02-understand-and-persist.png'),
    animations: 'disabled',
  });
});

test('multiple subagent fan-out @ink', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1320 });
  await openShowcase(page, 'fanout', '三块并行');
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-inkstone-ink');
  // Three accepted child invocations + the aggregate wait row + live plan tray.
  // Three accepted child invocations + the aggregate wait row + live plan tray.
  await expect(page.getByTestId('subagent-invocation-block').first()).toBeVisible();
  expect(await page.getByTestId('subagent-invocation-block').count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('plan-todo-tray')).toBeVisible();
  // The wait row renders its own aggregate copy (`已收集 N · 失败 N …`).
  await expect(page.getByText('已收集 3')).toBeVisible();
  await page.screenshot({ path: resolve(OUT_DIR, '03-subagent-fanout.png'), animations: 'disabled' });
});

test('remaining tool families @ink', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1560 });
  await openShowcase(page, 'tooled', '工具家族一览');
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-inkstone-ink');
  // browser_* + web_fetch + image_gen + truncated read + flashcards + note_write +
  // knowledge_read + process start/logs + toolbox + goal_wait.
  // Exact count is not asserted: the real clusterer batches read-only runs.
  expect(await page.locator('[data-testid="tool-call-card"]').count()).toBeGreaterThanOrEqual(8);
  await expect(page.getByTestId('tool-call-output-truncated')).toBeVisible();
  // Toolbox rows are collapsible: the header carries the action + subject.
  await expect(page.getByText('查找可用工具')).toBeVisible();
  await expect(page.getByText('生成了 3 张知识卡片')).toBeVisible();
  await expect(page.getByText('图片生成完成')).toBeVisible();
  await expect(page.getByText('已等待')).toBeVisible();
  // video_gen renders a generation card instead of a plain row.
  await expect(page.getByText('视频生成完成')).toBeVisible();
  await page.screenshot({ path: resolve(OUT_DIR, '04-tool-families.png'), animations: 'disabled' });
});

test('plan approval and permission gates @ink', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1240 });
  await openShowcase(page, 'approval', '待批准');
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-inkstone-ink');
  // Both cards come from live pushes (run record + pending permission request),
  // not from the seeded transcript — so this is the real gate path.
  await expect(page.getByTestId('plan-execution-gate')).toBeVisible();
  await expect(page.getByTestId('permission-bar')).toBeVisible();
  await expect(page.getByTestId('goal-blocked-card')).toBeVisible();
  // The gate lands after the first layout pass; re-fit before capturing.
  await fitTurn(page);
  await page.screenshot({ path: resolve(OUT_DIR, '05-approval-gates.png'), animations: 'disabled' });
});
