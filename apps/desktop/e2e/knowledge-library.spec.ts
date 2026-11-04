import { expect, test } from '@playwright/test';

/**
 * Materials library, in a real browser against the mock Host.
 *
 * What this proves that the component test cannot: the section is reachable
 * from the shipped sidebar, the list is the one the Host protocol produces,
 * and an unindexed file is readable in the actual app shell.
 */
test('knowledge library opens a document that has no index yet', async ({ page }) => {
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) await chooseSidecar.click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');

  await page.getByTestId('sidebar-knowledge-btn').click();
  await expect(page.getByTestId('knowledge-workspace')).toBeVisible();

  await page.getByTestId('knowledge-section-materials').click();
  const list = page.getByTestId('knowledge-document-list');
  await expect(list).toBeVisible();
  await expect(list.locator('li')).toHaveCount(3);

  // A document the index has never seen is still listed and still opens.
  await expect(page.getByTestId('knowledge-document-notes/sleep-debt.md')).toBeVisible();
  await expect(page.getByTestId('knowledge-document-papers/cortical-scan.pdf')).toBeVisible();

  await page.getByTestId('knowledge-document-notes/sleep-debt.md').click();
  const reader = page.getByTestId('knowledge-reader');
  await expect(reader).toBeVisible();
  await expect(reader).toContainText('Sleep debt');
  await expect(page.getByTestId('knowledge-reader-unindexed')).toBeVisible();
  await expect(page.getByTestId('knowledge-reader-progress')).toContainText('3');

  // Selecting text in the source is what every later stage hangs off.
  await page.evaluate(() => {
    const body = document.querySelector('[data-testid="knowledge-reader-body"]');
    if (!body) return;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    if (!text || !text.textContent) return;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(18, text.textContent.length));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const block = text.parentElement?.closest('[data-line-id]') ?? text.parentElement;
    block?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  const selectionToolbar = page.getByTestId('transcript-selection-toolbar');
  await expect(selectionToolbar).toBeVisible();
  await expect(page.getByTestId('selection-toolbar-copy')).toBeVisible();

  await page.getByTestId('knowledge-reader-cite-page').click();
  await page.getByTestId('wiki-back-btn').click();
  const chip = page.getByTestId('composer-context-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('sleep-debt');

  await page.getByTestId('composer-input').fill('explain this passage');
  await page.getByTestId('send-btn').click();
  await expect(
    page.locator('[data-testid="message-bubble"][data-role="user"]', {
      hasText: 'explain this passage',
    }),
  ).toBeVisible();

  await page.getByTestId('sidebar-knowledge-btn').click();
  await expect(page.getByTestId('knowledge-reader')).toBeVisible();
  await expect(page.getByTestId('knowledge-reader')).toContainText('Sleep debt');

  await page.getByTestId('knowledge-reader-back').click();
  await expect(page.getByTestId('knowledge-document-list')).toBeVisible();

  // A format with no text reader stays listed but must not open a fake reader.
  await page.getByTestId('knowledge-document-papers/cortical-scan.pdf').click();
  await expect(page.getByTestId('knowledge-reader')).toHaveCount(0);
  await expect(page.getByTestId('knowledge-document-list')).toBeVisible();
});
