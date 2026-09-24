import { expect, test, type Page } from '@playwright/test';

/**
 * Live call chain (?e2eLiveChain=1): one turn, 55 steps, tail still streaming.
 * Records how many rows re-render per token append and per run/updated, plus
 * the turn-level render cost. Row counts are the acceptance gate; durations
 * are printed only — a dev-build number that flakes in CI must not fail it.
 */
const TITLE = '运行中 · 55 步调用链';
const STREAMING_ROW = 'live-a055';
const APPENDS = 60;

type ProbeSample = {
  id: string;
  phase: 'mount' | 'update' | 'nested-update';
  actualDuration: number;
};

type ProbeReading = {
  cursor: number;
  rows: string[];
  turnMs: number;
};

async function openLiveChain(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?e2eLiveChain=1');
  await page.getByRole('button', { name: '使用本机', exact: true }).click();
  await page.getByTestId('sidebar-mode-code').click();
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill('/mock/piwin');
  await page.getByTestId('open-project-btn').click();
  await page.getByTestId('empty-stage-landing-row').filter({ hasText: TITLE }).click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
  await expect(page.locator(`#msg-${STREAMING_ROW}`)).toBeAttached();
  const trigger = page.getByTestId('turn-work-disclosure-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  await expect(page.locator('[id^="msg-live-a"]').first()).toBeAttached();
  // The fixture starts streaming on its own. Freeze it so each push below is
  // exactly one event.
  await page.evaluate(() => {
    (
      window as unknown as { __piwinLiveChain?: { driver: { stop: () => void } } }
    ).__piwinLiveChain?.driver.stop();
  });
}

function readProbe(page: Page, cursor: number): Promise<ProbeReading> {
  return page.evaluate((from) => {
    const probe = (
      window as unknown as {
        __piwinRenderProbe?: { samples: ProbeSample[]; mark: () => number };
      }
    ).__piwinRenderProbe;
    if (!probe) throw new Error('render probe was not installed');
    const fresh = probe.samples.slice(from);
    const rows = [
      ...new Set(
        fresh
          .filter((sample) => sample.id.startsWith('row:') && sample.phase !== 'mount')
          .map((sample) => sample.id.slice('row:'.length)),
      ),
    ];
    const turnMs = fresh
      .filter((sample) => sample.id.startsWith('turn:') && sample.phase !== 'mount')
      .reduce((sum, sample) => sum + sample.actualDuration, 0);
    return { cursor: probe.mark(), rows, turnMs };
  }, cursor);
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

/** One token, or one token plus the run/updated a phase switch rides on. */
function pushOnce(page: Page, phaseSwitch: boolean): Promise<void> {
  return page.evaluate((withPhase) => {
    const live = (
      window as unknown as {
        __piwinLiveChain?: {
          driver: { pushToken: () => void; pushPhase: () => void };
        };
      }
    ).__piwinLiveChain;
    if (!live) throw new Error('live chain driver was not installed');
    if (withPhase) live.driver.pushPhase();
    else live.driver.pushToken();
  }, phaseSwitch);
}

test('a live 55-step chain re-renders only the rows a push actually changes', async ({ page }) => {
  test.setTimeout(180_000);
  await openLiveChain(page);

  const tokenRows: number[] = [];
  const phaseRows: number[] = [];
  const tokenTurnMs: number[] = [];
  let cursor = await readProbe(page, 0).then((reading) => reading.cursor);

  for (let append = 1; append <= APPENDS; append += 1) {
    const phaseSwitch = append % 20 === 0;
    await pushOnce(page, phaseSwitch);
    await page.waitForTimeout(40);
    const reading = await readProbe(page, cursor);
    cursor = reading.cursor;
    (phaseSwitch ? phaseRows : tokenRows).push(reading.rows.length);
    if (!phaseSwitch) tokenTurnMs.push(reading.turnMs);
  }

  const summary = {
    tokenAppends: tokenRows.length,
    tokenRowsMax: Math.max(...tokenRows),
    phaseSwitches: phaseRows.length,
    phaseRowsMax: Math.max(...phaseRows),
    turnMsP50: Math.round(percentile(tokenTurnMs, 0.5) * 10) / 10,
    turnMsP90: Math.round(percentile(tokenTurnMs, 0.9) * 10) / 10,
  };
  console.log(`[live-chain-render] ${JSON.stringify(summary)}`);

  expect(Math.max(...tokenRows)).toBeLessThanOrEqual(2);
  expect(Math.max(...phaseRows)).toBeLessThanOrEqual(3);
});
