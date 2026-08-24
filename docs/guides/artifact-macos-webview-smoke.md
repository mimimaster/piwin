# Artifact macOS WKWebView smoke checklist

| Field | Value |
| :--- | :--- |
| Status | Required before merge of Artifact rendering-convergence |
| Runtime | Packaged Desktop (`tauri dev` / local Mac bundle), not Playwright Chromium |
| Fixtures | Same catalog as `@piwin/artifact/fixtures` and `#/e2e/artifacts` |

Playwright Chromium coverage does **not** replace this pass. WKWebView is the
product iframe host: it owns `sandbox="allow-scripts"` (no `allow-same-origin`),
the native `piwin-artifact-bridge` return channel, and height/scroll behavior
that Chromium can hide.

This checklist must be executed at least once on macOS before merge.

## Prepare

1. Build or run the Desktop Mac shell (Tauri + WKWebView), not the Vite-only e2e server.
2. Open a trusted workspace and a session that can emit Artifact fences.
3. Keep DevTools / Host log nearby so native bridge failures are visible.
4. Have the fixture sources from `packages/artifact/fixtures/` ready to paste as assistant-style Markdown (each case already ends with `After artifact`).

Optional harness: a local build that compiles `VITE_PIWIN_E2E_FIXTURES=true` can open `#/e2e/artifacts` inside WKWebView. Prefer pasting fixtures through the real transcript if the hash route is not in the packaged binary.

## Per-fixture checks

For every row, confirm: preview vs source, iframe vs static vs Canvas launcher, whether `[data-artifact-end]` is reachable, whether `After artifact` sits immediately under the Artifact (no large blank gap), and whether the native height bridge reports (no permanent 80px strip / fallback-only viewport unless noted).

| Fixture id | Paste | Must verify in WKWebView |
| :--- | :--- | :--- |
| `inert-fragment` | `artifact-html` without script | Static / Shadow path. End marker visible. Trailing Markdown continuous. No iframe. |
| `script-fragment` | `artifact-html` with button + script | Sandbox iframe `sandbox="allow-scripts"` only. Click increments. End marker reachable. Trailing Markdown visible. |
| `native-svg` | ` ```svg ` | Source-first. Preview SVG does not need an iframe. Trailing Markdown visible. |
| `full-html-document` | native ` ```html ` full document | Not an Inline iframe. Canvas / source path. If opened in Canvas, end marker reachable by **iframe scroll**. Native bridge still delivers size/actions. |
| `viewport-100vh` | `100vh` + `innerHeight` | Inline must not invent a page viewport. Trailing Markdown still reachable. Canvas path if offered. |
| `local-fixed-toast` | `position:fixed` toast | Toast does not escape the Artifact. Trailing Markdown not covered by a host-level overlay. |
| `four-edge-fixed-shell` | `position:fixed; inset:0` shell | Page shell does not steal the conversation scrollport. End marker / trailing Markdown still reachable. |
| `flow-6000` | 6,000px column + script | **Iframe or transcript scroll** reaches `[data-artifact-end="flow-6000"]`. No blank hole under the Artifact. `After artifact` is spatially continuous. |
| `overflow-20000` | 20,000px column + script | End marker reachable (internal iframe scroll or equivalent). Content not silently truncated. Trailing Markdown visible with no large gap. |
| `explicit-canvas` | `surface="canvas"` | Launcher in transcript; Canvas stage iframe fills the panel. End marker reachable by iframe scroll. Native bridge live. |
| `blocked-external` | `https://example.com` image | Blocked / source, never a live network load. Trailing Markdown visible. |
| `flashcard-tool-result` | current `{ card, duplicate, artifactHtml }` JSON + html fence | Flip card / source per current projection. No second HTML-to-Canvas path. Trailing Markdown visible. |
| streaming deltas | `STREAMING_DELTA_STEPS` | Same iframe node / stable channel id while tokens stream. Renderer (`data-artifact-renderer`) and layout (`data-artifact-layout`) recorded. No lasting source flash. Final end marker reachable. |

## Iframe scrolling (required)

For every sandbox case (`script-fragment`, `flow-6000`, `overflow-20000`, Canvas stage):

1. Confirm the iframe attribute is exactly `sandbox="allow-scripts"` — do **not** add `allow-same-origin`.
2. Scroll inside the iframe (trackpad / scrollbar / keyboard) until `[data-artifact-end]` is visible.
3. If the iframe cannot scroll, confirm the stage grew with content and the **conversation** can still reach the end marker and `After artifact`.
4. Fail the smoke if the last marker is clipped and no scroll path exists.

## Native bridge (required)

1. Height: Inline sandbox must leave the 80px bootstrap. A timeout fallback (bounded ~640px) is a **fail** for `flow-6000` / `overflow-20000`.
2. Listen for `piwin-artifact-bridge` / `piwin-artifact:size` on the WKWebView return channel (`artifact-native-bridge`). Packaged WebKit often cannot use `parent.postMessage`; the native handler is the product path.
3. Canvas: open `explicit-canvas`, confirm the stage is live (`data-artifact-host="live"`, `data-artifact-layout="canvas"`), and a size/action message still arrives.
4. After a parent re-render (focus composer, switch inspector tab back), height must not jump back to bootstrap.

## Sign-off

- [ ] macOS WKWebView build used (not Playwright Chromium)
- [ ] Every fixture row exercised
- [ ] Iframe scrolling checked for sandbox + Canvas cases
- [ ] Native bridge height/actions confirmed
- [ ] Failures filed against the rendering-convergence work (do not “fix” height/scroll here if this is a Phase 0 sign-off)

Record OS version, app build, and date next to the checkboxes when this is executed.
