/**
 * Live smoke: drive a real Chrome tab through the same code path a turn uses.
 *
 * Not a unit test — it needs a running Chrome and a page. Run it after the
 * spike profile is open (`spike/cdp-spike.mjs launch`):
 *
 *   node src/live-smoke.ts chatgpt-web
 *   node src/live-smoke.ts claude-web
 *
 * It prints each probe so a broken selector shows up as text, not a timeout.
 */

import { ensureChrome } from './chrome-launch.ts';
import { ModelPage } from './page-driver.ts';
import { listPageTargets } from './cdp.ts';
import { findSiteById } from './sites/index.ts';

const EXPECTED = 'DRIVER_OK';

async function main(): Promise<void> {
  const siteId = process.argv[2] ?? 'chatgpt-web';
  const site = findSiteById(siteId);
  if (!site) throw new Error(`unknown site ${siteId}; expected one of: chatgpt-web, claude-web`);

  const chrome = await ensureChrome({});
  console.log(`chrome ${chrome.browser} on :${chrome.port} (${chrome.reused ? 'reused' : 'started'})`);

  const pages = await listPageTargets(chrome.port);
  const usable = pages.find(
    (page) =>
      page.url.startsWith(site.homeUrl.slice(0, 22)) &&
      !/\/auth\/login|\/login|about:blank/.test(page.url),
  );
  let page: ModelPage;
  if (usable) {
    console.log(`reusing tab ${usable.url}`);
    page = await ModelPage.attach(site, chrome.port, usable.id);
  } else {
    console.log(`no usable tab for ${site.id}; opening ${site.homeUrl}`);
    page = await ModelPage.open(site, chrome.port);
  }
  try {
    const before = await page.probe();
    console.log('probe:', JSON.stringify(before, null, 2));
    if (before.turns.length > 0 && before.generating) {
      console.log('page is still streaming from a previous run; waiting for it to settle first');
    }

    console.log(
      `selectors matched — composer=${before.composerSelector} assistant=${before.assistantSelector}`,
    );
    const started = Date.now();
    const reply = await page.ask(`Reply with exactly: ${EXPECTED}`, {
      timeoutMs: 120_000,
      onProgress: (snapshot) => {
        const last = snapshot.turns.at(-1);
        console.log(
          `  +${Math.round((Date.now() - started) / 100) / 10}s generating=${snapshot.generating}` +
            `(${snapshot.generatingSelector ?? '-'}) turns=${snapshot.turns.length}` +
            ` last=${JSON.stringify((last?.text ?? '').slice(-40))}`,
        );
      },
    });

    console.log(`\nreply: ${JSON.stringify(reply)}`);
    const ok = reply.includes(EXPECTED);
    console.log(ok ? 'SMOKE PASS' : `SMOKE FAIL: reply did not contain ${EXPECTED}`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await page.close();
  }
}

main().catch((error) => {
  console.error(`smoke failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
