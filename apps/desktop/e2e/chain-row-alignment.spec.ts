import { expect, test, type Locator } from '@playwright/test';

/**
 * Chain rows share one label column whatever the tool. The fetch variant used
 * to override gap / padding / type inside a work fold, so outside
 * density-compact its label started 4px left of every other row.
 */

async function verbLeft(card: Locator): Promise<number> {
  const box = await card.locator('.tool-call-action-verb').boundingBox();
  if (!box) throw new Error('verb not rendered');
  return Math.round(box.x);
}

for (const block of ['gallery-web-rows', 'gallery-web-rows-balanced']) {
  test(`web_fetch and web_search labels share a column (${block})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/#/e2e/inkstone-chain');
    const scope = page.getByTestId(block);
    const fetchCard = scope.locator('.tool-call-card[data-tool-name="web_fetch"]').first();
    const searchCard = scope.locator('.tool-call-card[data-tool-name="web_search"]').first();
    await expect(fetchCard).toHaveAttribute('data-tool-visual', 'fetch');

    expect(await verbLeft(fetchCard)).toBe(await verbLeft(searchCard));
    const fetchSummary = fetchCard.locator('.tool-call-summary');
    const searchSummary = searchCard.locator('.tool-call-summary');
    for (const property of ['column-gap', 'padding-left', 'font-size']) {
      const expected = await searchSummary.evaluate(
        (element, name) => getComputedStyle(element).getPropertyValue(name),
        property,
      );
      await expect(fetchSummary).toHaveCSS(property, expected);
    }
  });
}
