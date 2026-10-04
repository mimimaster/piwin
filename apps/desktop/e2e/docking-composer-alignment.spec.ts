import { expect, test } from '@playwright/test';

// CSS geometry fixture: component semantics are covered by composer-stats-line.test.tsx.
// Load the real shell styles without connecting to or modifying the user's Host.
for (const [paneWidth, themeId] of [
  [420, 'piwin-inkstone-ink'],
  [560, 'piwin-inkstone-ink'],
  [420, 'piwin-inkstone-paper'],
  [560, 'piwin-inkstone-paper'],
] as const) {
  test(`split composers keep a stable baseline at ${paneWidth}px (${themeId})`, async ({ page }) => {
    await page.setViewportSize({ width: paneWidth * 2 + 40, height: 800 });
    await page.goto('/');
    await page.waitForFunction(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--s-2').trim() !== '',
    );
    await page.evaluate(({ width, theme }) => {
      document.documentElement.dataset.themeId = theme;
      const pane = (active: boolean, empty: boolean): string => `
        <section class="conversation-pane${active ? ' is-active' : ''}"
          style="position:relative;width:${width}px;height:600px">
          <div class="conversation-pane-frame">
            <header class="conversation-pane-header">Session</header>
            <div class="conversation-pane-body" style="justify-content:flex-end">
              <footer class="${active ? 'composer-dock layout-docked' : 'conversation-pane-composer'}">
                <div class="composer-card-v2" style="height:96px"></div>
                <div class="composer-stats-line${empty ? ' is-empty' : ''}"
                  ${empty ? 'aria-hidden="true"' : 'role="status"'}>
                  ${empty ? '' : `<div class="composer-stats-metrics">
                    <span class="composer-stats-item">2 turns · 5 steps · 168 tok/s</span>
                    <span class="composer-stats-separator">·</span>
                    <span class="composer-stats-item">12K tok · cache 75%</span>
                  </div>`}
                </div>
              </footer>
            </div>
          </div>
        </section>`;
      document.body.innerHTML = `<main class="docking-workspace" style="display:flex">
        ${pane(false, true)}${pane(true, false)}
      </main>`;
    }, { width: paneWidth, theme: themeId });
    const cards = page.locator('.composer-card-v2');
    const emptySlot = page.locator('.composer-stats-line.is-empty');
    const populatedSlot = page.locator('.composer-stats-line:not(.is-empty)');
    await expect(emptySlot).toBeVisible();
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    if (!first || !second) throw new Error('Missing composer geometry');
    expect(Math.abs(first.y - second.y)).toBeLessThan(1);
    const baseline = second.y;

    // A verbose extension must not wrap the stats row and move the input upward.
    await populatedSlot.evaluate((element) => {
      const extension = document.createElement('div');
      extension.className = 'composer-stats-extensions';
      const status = document.createElement('span');
      status.className = 'composer-stats-item is-extension';
      status.textContent = 'Very long extension status '.repeat(8);
      extension.append(status);
      element.prepend(extension);
    });
    const withExtension = await cards.nth(1).boundingBox();
    expect(withExtension?.y).toBeCloseTo(baseline, 1);
    const slotHeights = await page.locator('.composer-stats-line').evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
    expect(slotHeights[0]).toBeCloseTo(slotHeights[1] ?? 0, 1);
    expect(slotHeights[0]).toBeGreaterThan(0);

    // Both active and inactive headers use a neutral seam, not an accent underline.
    const headers = page.locator('.conversation-pane-header');
    const backgrounds = await headers.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    );
    expect(backgrounds[0]).not.toBe(backgrounds[1]);
    const shadows = await headers.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).boxShadow),
    );
    expect(shadows[0]).toBe(shadows[1]);

    // Removing stats data keeps the same baseline; single-pane hides the empty slot.
    await populatedSlot.evaluate((element) => {
      element.replaceChildren();
      element.classList.add('is-empty');
      element.removeAttribute('role');
      element.setAttribute('aria-hidden', 'true');
    });
    expect((await cards.nth(1).boundingBox())?.y).toBeCloseTo(baseline, 1);
    await page.locator('.docking-workspace').evaluate((element) =>
      element.classList.add('is-single-pane'),
    );
    await expect(emptySlot.first()).toBeHidden();
  });
}
