import { expect, test } from '@playwright/test';

const BACKUP_PATH = '/opt/n3/admin/recadm.bak-pre-tgorig-20261114';
const DEPLOY_PATH = '/opt/n3/c2-panel/deploy/admin-go/recadm.go';
const SOURCE = [
  '## N2 与 N3 部署及验证',
  '',
  '| 环境 | 目标机 / 容器 | 备份与同步路径 | 线上 sha256 & 冒烟 |',
  '| --- | --- | --- | --- |',
  '| N2 后端 | `n2-main` / `n2-admin` | `recadm.bak-20261114-tgorig2`（停→覆盖→启） | `cb5d18ef…f214e` 一致；`ip2region 已加载：/data/ip2region_v4.xdb`；`GET / -> 200` |',
  '| N3 后端 | `153.75.83.190` / `n3-admin` | `' +
    BACKUP_PATH +
    '`，已同步 [' +
    DEPLOY_PATH +
    '](' +
    DEPLOY_PATH +
    ') 并 `docker cp` + `restart` | `cb5d18ef…f214e` 一致；`ip2region 已加载：/data/ip2region_v4.xdb`；`GET / -> 200`、`POST /api/v1/login -> 401` |',
  '| N3 投放 | `153.75.83.197` | 仅运行 `n3-dlv` + `n3-caddy`，无 `recadm` 进程 | 未改动 |',
  '',
  '完整备份：`' + BACKUP_PATH + '`。',
].join('\n');

test.use({ browserName: process.env.PIWIN_E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium' });

for (const face of ['paper', 'ink'] as const) {
  for (const width of [360, 900]) {
    test(`${face} at ${width}px keeps file paths inside their cells`, async ({ page }) => {
      await page.addInitScript((source) => {
        (window as unknown as { __piwinE2eMarkdownSource: string }).__piwinE2eMarkdownSource =
          source;
      }, SOURCE);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/#/e2e/artifacts?id=markdown-stream&chunk=0&from=${SOURCE.length}`);
      const body = page.getByTestId('markdown-stream-body');
      await expect(body.locator('a.pc')).toHaveCount(3);
      await page.evaluate((themeFace) => {
        document.documentElement.dataset.themeId = `piwin-inkstone-${themeFace}`;
        document.documentElement.dataset.themeMode = themeFace === 'paper' ? 'light' : 'dark';
      }, face);

      // Text fragments must stay inside the cell, including every segment
      // of PathChip's nested directory/filename spans. No clipping shortcut.
      const overflow = await body.locator('.md-table').evaluate((table) => {
        const failures: string[] = [];
        for (const cell of table.querySelectorAll('th, td')) {
          const bounds = cell.getBoundingClientRect();
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          let textNode = walker.nextNode();
          while (textNode) {
            if (textNode.textContent?.trim()) {
              const range = document.createRange();
              range.selectNodeContents(textNode);
              if (
                [...range.getClientRects()].some(
                  (rect) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1,
                )
              )
                failures.push(textNode.textContent);
            }
            textNode = walker.nextNode();
          }
        }
        return failures;
      });
      expect(overflow).toEqual([]);
      const backup = body.locator('a.pc').filter({ hasText: BACKUP_PATH }).first();
      await backup.click();
      await expect(body).toHaveAttribute('data-opened-path', BACKUP_PATH);
      await expect(backup).toHaveText(BACKUP_PATH);
      await expect(body.locator('.md-table-wrapper')).toHaveCSS('overflow-x', 'auto');
    });
  }
}
