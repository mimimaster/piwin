# ADR 0058: Headless render as a `web_fetch` fallback

## Status

Accepted (2026-08-20)

Does **not** amend [ADR 0020](./0020-browser-session.md) (interactive agent
browser) or [ADR 0057](./0057-browser-takeover-workbench.md) (takeover
workbench). Those own a long-lived Chromium the user can see and drive.

## Context

`web_fetch` defaults to a static GET + Readability (`supermarkdown`). SPA /
anti-bot pages often yield `thinContent`. Phase C already retries once with
Jina when `fetchFallback: 'jina'`. A local, key-free option is still missing
for private Hosts that cannot send the URL to r.jina.ai.

`@piwin/browser` already has Playwright. Reusing that package as a **one-shot
HTML renderer** is the intended path. It is a new product use and must not
share or mutate the takeover session.

## Decision

### 1. New port, not a new provider card

```ts
type WebPageRenderer = {
  renderHtml: (input: {
    url: string;
    signal?: AbortSignal;
    timeoutMs: number;
  }) => Promise<{ finalUrl: string; html: string }>;
};
```

`@piwin/tools-web` stays pure: Host injects the port. After `renderHtml`, the
same Readability pipeline runs. The result `provider` is `'browser'` so the
model sees which backend actually produced the text.

`fetchFallback: 'browser'` is a Settings fallback, not a primary fetch
provider card. Host injects `renderPageHtml` from `@piwin/browser`.

### 2. Isolated from the workbench Chromium

The renderer starts a short-lived headless page (or a dedicated context),
navigates, waits for load, reads `page.content()`, and closes. It must not:

- reuse the ADR 0020/0057 interactive session;
- emit `browser/frame` / takeover pushes;
- leave a page the user can pick.

SSRF, redirect revalidation, and `fetchBlockedUrlPrefixes` still apply before
navigation. Timeout is `fetchTimeoutMs`.

### 3. One retry, labeled, never silent

Same rule as Jina fallback: only after a thin `supermarkdown` extract, once
per call. If render fails or the extract is not richer, keep the local result
and `thinContent: true`.

## Consequences

- Local JS-page coverage without a Jina/Firecrawl key.
- Extra Chromium cost and a second Host-owned browser role — keep the port
  small so tools-web does not import Playwright.
- Implemented 2026-08-20: tools-web retries through the port; Host launches a
  throwaway Chromium (`renderPageHtml`), never the workbench session.
