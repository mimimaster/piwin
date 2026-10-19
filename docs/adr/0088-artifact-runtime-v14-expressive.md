# ADR 0088: Artifact runtime v14 — extended tokens, style modes, artifact kit

- **Status**: Accepted
- **Date**: 2026-10-12
- **Scope**: `@piwin/contracts`, `@piwin/artifact`, `@piwin/host-runtime`, `apps/desktop`
- **Consults**: ADR 0005, ADR 0029
- **Design**: `~/piwin-artifact-design/design.md` (product owner approved, 2026-10-11)

## Context

Artifacts under runtime contract v13 had seven theme variables and a strict
"flat, quiet" tone. Results looked uniform and grey, and the model had no
sanctioned way to draw status, charts or depth. Fences carry no marker of
which rules they were written for, so any rendering change would repaint old
sessions.

## Decision

1. **Rules marker.** Runtime v14 requires `style="host" | "expressive"` on
   every fence. A fence with `style` renders under v14 rules; a fence without
   it is `legacy` and keeps v13 rendering (`resolveArtifactRules`). Old
   sessions never repaint.
2. **Vocabulary.** v14 adds `surface-2 subtle border-strong ok warn risk info
   accent-2 series-1…6 shadow-1/2 radius-sm/lg font-mono`. Desktop maps them
   from the active theme's Deck ramp (`artifact-theme-map.ts`); a theme may
   override each under `ThemeManifest.artifact`. Any caller that supplies only
   the base seven gets derived fallbacks (`theme-tokens.ts`), so a token is
   never undefined. No serif/display font token.
3. **on-accent.** v14 artifacts get the theme-authored ink
   (`artifact.onAccent ?? deck.onIris`); legacy keeps the luminance-derived
   ink. The host-only input `--piwin-artifact-on-accent-themed` is never
   emitted as CSS.
4. **Report kit v2.** For v14 fences only: tones read the status tokens,
   `info` tone, stat tiles take `shadow-1`, titles gain weight.
5. **Prompts.** Runtime prompt v14, decision prompt v11. The resident contract
   retains the rendering constraints and a short kit pointer; chart specs and
   icon names are loaded through `artifact_instructions`. Conversation static
   overhead passes the existing 2500-token CHT-803 limit.
6. **Capability gate.** The resident prompt is compiled once per runtime
   generation and shared by every shell, so it cannot be versioned per
   client. Instead the shell advertises `PromptInput.artifactKit`
   (`ARTIFACT_KIT_VERSION = 1`). When a turn carries an artifact rendering
   hint (width or host theme) but no `artifactKit >= 1`, Host prefixes a
   `[piwin-artifact-legacy-client]` turn block telling the model to keep to
   the v13 vocabulary, omit `style`, and draw charts as inline SVG. CLI/TUI
   turns carry no hint and get nothing. The flag is stripped before the
   input is persisted.

## Consequences

- Expressive fences use the stage guard described in P4; report-kit documents
  and the internal host-only switch keep the host guard.
- The inherited CHT-803 failure was resolved by shortening redundant runtime
  prose and keeping kit examples in the on-demand reference. Its limit remains
  2500; no tests were relaxed.
- Theme packages need no change; overrides are optional.

## Viewer (P2)

7. **Fullscreen, no pop-out.** Inline and Canvas artifacts open in a fixed
   overlay portaled into the main window (`ArtifactFullscreenOverlay`). The
   frame remounts in Canvas mode on its own bridge channel
   (`<id>:fullscreen`); Esc always exits and focus returns to the opener.
8. **Inline → Canvas.** “Open in Canvas” promotes the same fence (same target
   id) to the Canvas surface; the Inline copy stays, so the Canvas frame uses
   channel `<id>:canvas`.
9. **32px Canvas toolbar**, always visible: title + `Canvas · <style>`, width
   presets (fit/760/390, fullscreen adds 1200), preview theme
   (follow/paper/ink; repaints only that frame, never persisted), fullscreen,
   code, download (moved from the floating button). Keys: F, Esc, 1–4, T;
   ⌘⇧O on an Inline artifact's actions. The mobile shell shows fullscreen only.

## Kit v1 (P3)

10. **Primitives.** `<i data-piwin-icon>` (59 line icons generated from
    `@piwin/ui-kit` plus a few drawn on the same grid) and
    `<figure data-piwin-chart="bar|line|donut|spark">` with a JSON spec, plus
    `piwin.chart/icon/hydrate/version`. Labels are text nodes; colors accept
    only `var(--piwin-artifact-*)`; no eval, fetch or `parent`. `window.piwin`
    is frozen. Charts redraw on container resize; streamed markup hydrates via
    a MutationObserver. 21.5 KB raw / 6.6 KB gzip.
11. **Delivery.** Packaged shells: `piwin-artifact://localhost/lib/v1/kit.js`
    (Windows `http://piwin-artifact.localhost/...`), compiled into the binary
    with `include_bytes!`, fixed allowlist, GET only, main webview only,
    `immutable` cache. The document CSP gains only
    `script-src … <origin>/lib/v1/`; `connect-src 'none'` is unchanged.
    Browser/e2e builds inline the same bytes. Injected only when the source
    uses the kit (and for v14 stream previews). Kit CSS is always inline.
    Kit artifacts always take the sandbox renderer.
12. **Prompt.** The resident contract carries one short pointer line. The
    full reference (icon names, chart options, API) is returned by
    `artifact_instructions`, whose description now says to call it only for
    that reference.
13. **Deviations from the design.** Icons are embedded in `kit.js` (a separate
    `icons.json` would need `connect-src`); kit CSS is inline (no `style-src`
    change); the kit major version follows the rules version (v14 → kit v1)
    rather than a separate descriptor field. WebKit verification that
    subresource loads from the scheme grant the frame no IPC is still owed on
    a packaged build.

## Style modes (P4)

14. **Resolution.** Report kit (`class="piwin-report"`) is always host; then
    the internal `artifact.styleModes: host-only` switch or the user's
    "view with theme"; then the fence `style`; legacy fences without `style`
    keep the Canvas cover-scene heuristic (`own`); otherwise host.
15. **Expressive = `stage`.** Sandbox only (Shadow DOM cannot scope its
    colors), `html[data-piwin-style="expressive"]`, theme guard limited to a
    transparent page shell + host color-scheme, soft repair limited to
    html/body/:root/root selectors (cards keep their colors), invented theme
    names still mapped.
16. **Contrast probe.** Final stage/own documents sample up to 200 text
    elements (colors normalized by painting one canvas pixel) against WCAG AA
    and look for a page-size fill on the wrong side of the host scheme. A hit
    posts `piwin-artifact:contrast` (also whitelisted on the WebKit native
    bridge). Desktop shows a badge 「对比度偏低」/「与当前主题不一致」 with
    「用主题样式查看」; the theme view shows 「已用主题样式显示 · 恢复原样」.
    Never an automatic rewrite.
17. **Internal switch.** `artifact.styleModes` (`model` default /
    `host-only`) lives in Host config only, not Settings. `host-only` adds a
    prompt hint (every fence uses `style="host"`) and Desktop downgrades any
    expressive fence to host. Per-session-type forcing (voice, automation,
    subagents) from design §6.3 is not implemented.

## Follow-up corrections (2026-10-12)

18. **Chart semantics.** Series can declare `tone`, donut slices can declare
    `tones` in label order, and exact status names in Chinese/English infer a
    tone when one is absent. Success/pass is green, failures/blockers red,
    warnings/suggestions amber. Explicit theme-variable colors take precedence.
    Neutral series start blue; success/risk palette entries come last. Legends
    use the same resolved colors as the marks.
19. **Theme-side checks.** Expressive cards still follow the host's light/dark
    side. The probe includes opaque gradients when detecting a large fill on
    the opposite side; it shows a badge and never rewrites automatically.
20. **Fullscreen focus.** Pointer activation focuses the Inline/Canvas opener
    before mounting the overlay, because WebKit does not focus clicked buttons
    by default. Escape on viewer chrome restores that opener in both engines.

## Form freedom and diagram kit (2026-10-13)

Owner feedback: artifacts came back as grids of cards even when the content
was a process, a handoff between actors or a timeline. The prompts made the
Report Kit mandatory for reports ("no `<style>` block", "add CSS only for
what the kit lacks") and the kit only offered boxes. The owner wants the
model free to pick its rendering, with built-ins kept as the stable option.

21. **The model chooses the form.** Decision prompt v13: content decides the
    form (flow, swimlane, timeline, tree, matrix, chart, SVG diagram, or a
    layout of its own); cards are for a few parallel independent items. The
    Report Kit is "by default", and its section now says it is a fast
    default, not a limit: own `<style>`, layout or inline SVG are allowed.
22. **What stays fixed.** Only rules whose breach breaks rendering: theme-var
    colors, host light/dark side, Inline width and scrolling, fence format,
    `style="host"` by default, no external resources. Costs accepted with the
    freedom: less uniform reports, a later first paint when the model writes
    its own stylesheet, occasional layout slips in freehand SVG. The contrast
    probe and "view with theme" remain the safety net.
23. **Diagram built-ins (optional).** `ol.piwin-flow` (`data-dir="down"`,
    `data-kind="decision"`), `table.piwin-lanes` (phases in `thead`, numbered
    by the host; one row per actor; each step a `p` in its phase cell),
    `ol.piwin-timeline`, `ul.piwin-tree`. Vocabulary in `@piwin/contracts`
    `artifact-diagram-kit`, stylesheet in `@piwin/artifact`
    `srcdoc-diagram-kit`. CSS only: no kit script, no CSP change, streams as
    written, and the static (shadow) renderer ships the same sheet. Zero
    specificity, so author CSS restyles it. Not scoped to `.piwin-report`;
    emitted after the report kit so the lanes table wins over the report's
    `table` rules at equal weight.
24. **No capability bump.** Each shape sits on semantic markup, so a shell
    without the stylesheet shows a plain list or table. `ARTIFACT_KIT_VERSION`
    stays 1 and the runtime prompt stays v14.
25. **Prompt budget raised.** The owner raised the CHT-803 conversation
    limit from 2500 to 5000 tokens (2026-10-13). Artifact instructions are
    nearly all of that overhead (about 2.5k after the rewrite below), and the
    old limit forced wording to be cut for space rather than for clarity.
    Markup examples still live in the `artifact_instructions` reference.
26. **Not covered.** The kit draws no arrows between lanes and lays out no
    arbitrary graphs; the model uses inline SVG for those. A host-laid-out
    node/edge diagram (kit script) is the follow-up if freehand SVG proves
    unreliable.

27. **Positive phrasing.** At the owner's request every model-facing
    artifact prompt (decision policy, runtime contract, report/diagram kit
    lines, surface hints, the per-turn width / theme / legacy-client blocks)
    now states the wanted behavior instead of a prohibition, and gives the
    reason where the rule is not obvious. No rule was dropped; each "never X"
    became the positive form of the same constraint. Basis:
    - Anthropic, *Prompting best practices*: "Tell Claude what to do instead
      of what not to do"; "Providing context or motivation behind your
      instructions ... can help Claude better understand your goals"; newer
      models "may now overtrigger", so "dial back any aggressive language"
      ("CRITICAL: You MUST ..." → "Use this tool when ...").
      <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
    - OpenAI, *GPT-5 prompting guide*: "contradictory or vague instructions
      can be more damaging to GPT-5 than to other models"; Cursor's emphatic
      "Be THOROUGH" caused tool overuse until softened.
      <https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide>
    Applied: "MUST use Canvas" became a plain statement of where such
    deliverables belong; "CSS First" now applies only when a `<style>` block
    is written, which removes its conflict with the Report Kit's
    stylesheet-free path. Not verified: no A/B run against a live model was
    done, so the effect on output is expected from the cited guidance, not
    measured.

## Kit 1.1 and component kit (2026-10-13)

Owner request: improve the built-in charts and add more themed built-in UI
components, as the stable route beside free-form output.

28. **Charts (kit 1.1.0).** `bar` and `line` gain a value axis with gridlines
    and tick labels on a rounded maximum, bars are rounded on the value end
    and capped in width, few bars print their values, a single line gets a
    soft area fill and its latest value. `donut` separates its slices, sits
    beside a legend that lists shares, and takes `centerLabel`. `spark` gets
    a fill and an end dot. New kinds: `hbar` (ranked rows, label left, value
    right) and `stack` (one bar split into shares). New options: `unit`,
    `min`, `values`, `area`. An older shell draws an unknown kind as `bar`.
    Chart drawing moved to `kit/kit-v1-charts.ts`; the runtime keeps tones,
    icons and hydration.
29. **Kit size and URL.** `kit.js` is now about 29 KB raw (budget raised
    from 24 KB to 32 KB). The scheme answers with an immutable cache header,
    so the served path now names the version: `/lib/v1/kit-1.1.0.js`
    (TS `ARTIFACT_KIT_V1_PATH` and `protocol.rs` move together; the old path
    returns 404). The CSP source `…/lib/v1/` is unchanged.
30. **Component kit.** `header.piwin-hero`, `ol.piwin-steps`,
    `ul.piwin-checklist` (`data-state="done" | "current" | "blocked"`),
    `label.piwin-progress` on a native `progress`, `section.piwin-compare`
    (`data-pick`), `table.piwin-matrix` (toned cells), plus `data-trend` for
    deltas. Vocabulary in `@piwin/contracts` `artifact-component-kit`,
    stylesheet in `@piwin/artifact` `srcdoc-component-kit`. Same rules as the
    diagram kit: CSS only, zero specificity, theme tokens only, semantic
    markup that degrades to a plain list or table, shipped to the sandbox and
    the static renderer, emitted last.
31. **Prompt.** One resident line names the components; markup and chart
    options are in the `artifact_instructions` reference.
32. **Owed.** Rendering was checked in a browser for light and dark default
    themes. Not checked: a packaged build loading the kit from the new
    scheme path, WebKit rendering of the `progress` bar, mobile.

## Layout probe, chart placeholder, kit showcase (2026-10-13)

33. **Layout probe.** Free-form layout can squeeze text into a column one
    glyph wide (a sentence written straight into a flex/grid row puts each
    inline `code` in the marker track). `countShatteredText` in
    `@piwin/artifact` `layout-probe` counts elements whose own text (four or
    more characters) is about one glyph wide and four or more lines tall,
    skipping SVG, hidden and vertical-writing text. One function serves both
    renderers: the static renderer calls it on its shadow root; the sandbox
    embeds its source text (so it must stay self-contained — a test evaluates
    the embedded copy standalone) and posts `piwin-artifact:layout`
    `{ shatteredText }`, whitelisted on the WebKit native bridge. Final
    documents only, every palette.
34. **Badge, never a rewrite.** Desktop shows 「部分文字被挤成了窄列」. Where a
    composer is wired, 「让模型修复」 drafts a fix request that names the usual
    cause; it is a draft, not a send. An automatic DOM repair was rejected:
    it cannot tell this mistake from a deliberate two-cell row such as a
    label with a right-aligned value.
35. **Chart placeholder.** The stream preview withholds a chart's data script,
    so a streaming figure was empty and the page jumped when the final
    document drew it. Kit CSS now holds the place of a figure that has no
    script and is not ready, per chart kind. A final figure always has its
    script, so a chart with broken JSON gets no permanent placeholder.
36. **Kit showcase.** `#/e2e/artifacts?id=kit-showcase&theme=ink|paper` shows
    all six chart kinds, the diagram and component kits, and one squeezed row
    per renderer; `e2e/artifact-kit-showcase.spec.ts` asserts on it. The spec
    has not been run: Playwright's browser is not installed on this machine.
    The page itself was checked by hand in both themes, including both layout
    badges. Screenshot baselines are not included for the same reason.

Verification and remaining packaged/mobile checks:
[2026-10-12 continuation evidence](../evidence/2026-10-12-artifact-v14-continuation.md).

## Dense, flat reports and handoff lanes (2026-10-17)

Owner feedback on a Canvas attack-chain report: the swimlane was unreadable.
Seven phases split the width evenly, every step was a bordered, shadowed card
inside a bordered cell, CJK text broke into two-character lines, half the
cells were empty boxes, and nothing showed which actor handed what to whom.
The rest of the report repeated the pattern (gradient hero, a shadowed box per
number). Research basis: swimlanes exist to show ownership *and* handoffs, and
a cross-lane handoff should be labelled (Mermaid swimlane guide, Lucidchart);
non-data ink — borders, boxes, shadows — should be removed or lightened and
whitespace used instead of containers (Tufte; Few, *Information Dashboard
Design*); many steps read better top-down, as in a sequence diagram.

37. **Lanes are text on bands.** A lane step is a line of text with a status
    dot, not a card. Every other lane carries a faint wash; columns have a
    minimum width (7.5em, 10em running down) so short CJK phrases stay whole;
    the Inline column (sandbox `inline-flow` and the static renderer) keeps
    4.5em so the chat column never overflows. Toned steps are bold; `risk`
    also colors the text.
38. **Handoffs and order are drawn.** `data-to="<actor>"` on a step prints
    "→ actor" beneath it in the `info` tone (some host accents are red and
    would read as a fault). Phase headers carry ordinals joined by chevrons.
    `data-dir="down"` is the transposed table — actors in `thead`, one row
    per phase — with the ordinals on a vertical rail; the reference tells the
    model to use it past five phases or for longer steps. Still CSS only and
    zero specificity; a shell without the sheet shows the plain table, and
    `data-to` is only lost visually there. Item 26's "no arrows between lanes"
    is narrowed to: no drawn cross-lane connectors (they need layout the CSS
    kit cannot do); the labelled handoff carries the same fact.
39. **Flat by default.** Flow steps lose their drop shadow. v14 report stats
    become a metric strip (a hairline before each figure, toned figures
    color it) instead of shadowed tiles; v14 `h2` spacing tightens. The hero
    drops its gradient box for a masthead with one rule under it; the
    recommended `piwin-compare` option keeps an accent border and tint but no
    shadow or top bar. Legacy-rule report CSS is unchanged.
40. **Prompt.** Decision prompt v14 adds a density paragraph: conclusion and
    its explaining figure first, text on the page grouped by whitespace and
    rules, boxes only for what stands apart, short phrases per step/cell,
    color for status and handoffs. Runtime contract v17 replaces "quiet with
    depth / one hero may use a gradient" with "flat and quiet", shadows for
    floating layers only. The lanes reference documents `data-to` and
    `data-dir="down"`.
41. **Evidence.** Before/after at Canvas width, light and dark, plus the
    Inline showcase: `docs/evidence/2026-10-17-canvas-report-before.png`,
    `…-canvas-report-dense-light.png`, `…-canvas-report-dense-dark.png`,
    `…-lanes-inline-down.png`. Not verified: WebKit (packaged Tauri) and a
    live model run under the new prompts.

## Canvas toolbar trimmed (2026-10-13)

Owner direction: the Canvas toolbar carried too many controls. This
supersedes the control list in item 9 for the Canvas surface.

26. **Canvas toolbar.** Title + `Canvas · <style>`, a compact `760 | 390`
    width toggle, code (eye icon, pressed while source is shown) and download.
    The fit segment is gone: no width pressed means fit, and pressing the
    active width again returns to it. Preview theme and the fullscreen button
    are removed from Canvas; the pane's own maximize covers the latter.
27. **Keys.** Canvas keeps F and 1–3; T now works in fullscreen only, since
    Canvas shows no theme state. The fullscreen overlay keeps theme preview
    and its exit button and uses the same width toggle with 1200 added.
28. **Mobile shell.** Still fullscreen only; it keeps the button because it
    has no keyboard for F.

## Code stays beside the artifact (2026-10-19)

Owner direction: models were pasting whole listings into Report Kit `pre`
blocks, which have no highlighting and, on Canvas, scrolled sideways instead
of wrapping. An artifact is the wrong place to read or copy code; the
transcript's Markdown code block already is.

42. **Routing.** Decision prompt v16 adds one rule: an artifact cites code by
    `path:line` and quotes a few lines at most; full code, patches, diffs and
    commands go in an ordinary Markdown fence before or after the artifact
    fence. A reply mixes the two freely: the fence is one block of the
    Markdown message. The Report Kit section drops `pre` from its element
    list and repeats the rule. No second code viewer is built in the sandbox.
43. **Fallback.** The v14 kit wraps `pre` (`white-space: pre-wrap`,
    `overflow-wrap: anywhere`) on Canvas too, so a listing that still lands
    in a report shows its line ends. Legacy fences replay unchanged.
    Not verified: a live model run under the new prompt.

## Left accent bars stay straight (2026-10-19)

Owner direction: a status bar on the left edge of a card must be a straight
line. The 2026-10-14 fix only covered Diagram Kit steps (a gradient layer
instead of an inset shadow); its prompt rule was reverted the same day, so
model-authored cards with `border-left: 3px` plus `border-radius` kept
drawing the bar as a concave arc.

44. **Host squares the corners.** `straightenLeftAccents` in
    `@piwin/artifact` `left-accent-straighten` finds rounded elements whose
    left border is at least 2px and thicker than the other sides, or that
    carry an inset left shadow bar, and sets their two left corner radii to
    `0 !important` through CSSOM. Right corners, fill and colors stay as
    written; uniform frames, hairlines and SVG are untouched.
45. **Both renderers, every phase.** Same self-contained pattern as the
    layout probe (item 33): the static renderer calls it on its shadow root;
    the sandbox embeds its source and reruns it, debounced, on load and on
    every `childList` mutation, so stream previews straighten too.
46. **A narrow rewrite.** Item 34 keeps automatic layout repair out because
    it would guess at intent. This one does not guess: a thick left edge on a
    rounded box is always meant as a bar. No model-facing prompt change.
    Evidence: `docs/evidence/2026-10-19-left-accent-straight.png` (Chromium).
    Not verified: WebKit (packaged Tauri).
