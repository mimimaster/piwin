# Provider settings: list + detail workspace

Status: shipped 2026-09-23 (owner request).

## Problem

Settings → Models split one provider across two surfaces: the connection
(key, address, headers) lived in a modal opened from a small pencil, while the
model list lived in an expandable row opened from a small chevron. "Test
connection" sat in the modal, "Fetch models" in the row, so the everyday flow
(paste key → test → fetch models) meant closing one surface to open the other.
The modal also hid the list, a third navigation column (capabilities) squeezed
the list to half the page, and model rows carried four unlabeled icon buttons.

## Shape

```
[对话与接口] [视觉委派] [输出委托] [图片] [视频] [语音]   ← capability tabs, one row
┌ rail ─────────────┬ detail ─────────────────────────────────────┐
│ search        [+] │ icon  name              [连接设置 ⌄] on  ⋯   │
│ 自定义            │       [protocol] host/path · 密钥已保存      │
│   provider …      │ (connection panel opens here, on demand)     │
│ 套餐 · OAuth      │ Models  [fetch] [add]                        │
│   provider …      │  [logo] name / id · ctx · out  caps  on ⋯ (⌄)│
└───────────────────┴──────────────────────────────────────────────┘
```

- **One editing surface per provider; models are the body.** Selecting a
  rail item shows its models. No modal. People come here to fetch and tune
  models; a configured connection is only looked for when it needs changing,
  so it is not a section: the header shows its state (address, key saved /
  missing) and a "连接设置" button opens the form as a recessed panel under
  the header. A new provider shows the form open (models come after the first
  save); unsaved edits keep it open.
- **Model rows announce that they open.** Each model is its own raised card
  with the vendor's mark (from the model id) and a round disclosure button at
  the end; the card lifts on hover, the button flips when open, and the
  parameter editor grows inside the same card. Configured context / output
  sizes show on the folded row. No instruction text.
- **"N 项待处理" is actionable.** Each workspace issue names the capability tab
  that fixes it: that tab carries an amber dot, and the health pill is a
  button (tooltip lists the issues, click jumps to the first tab).
- **Selection survives tab switches.** The page owns the selected provider, so
  visiting another capability tab and coming back keeps it.
- **Pinned chrome, scrolling panes.** The Models page is a settings hub page
  (`.settings-hub-page`): page title, summary line and capability tabs stay
  put; the active tab panel takes the rest of the window. The providers
  workspace is a full-bleed split view, not a card: it runs to the settings
  panel's left, right and bottom edges (the rail tint ends in the panel's
  rounded corner) under one hairline below the tabs, and each pane scrolls on
  its own, so switching to a shorter
  provider (an OAuth plan has no connection form) cannot clamp the page scroll
  and jump the layout. Below 860px the panes stack and the panel scrolls as a
  whole.
- **Shared with Knowledge.** The summary line and capability tabs are one
  component (`settings/settings-workspace-header.tsx`,
  `styles/settings-workspace.css`) used by Models and Knowledge, replacing the
  metric tiles and vertical capability nav both pages carried. Knowledge shows
  each capability's state as a dot on its tab.
- **Custom channels get an ink monogram**, not the protocol vendor's logo
  (seven relays used to share one black OpenAI tile). Vendor presets and OAuth
  plans keep their brand mark.
- **Rail**: search + add at the top; custom providers first, then OAuth
  packages; each item shows icon, name, host, model count and a status dot
  (off / on / last test failed). Disabled providers stay in place, dimmed.
- **Connection edits are a draft.** Fields edit a local draft; a save bar
  appears only when the draft differs from the saved provider. Switching
  providers with unsaved edits asks first. Revealing the saved key (eye) fills
  the input but does not count as an edit.
- **Immediate edits stay immediate.** Provider enable switch, model switches,
  default model, model params, fetched/added/removed models persist at once,
  as before. A connection save merges into the *current* provider, so it never
  overwrites models or the enable state changed meanwhile.
- **New provider**: choosing a preset opens an unsaved draft in the detail
  pane (rail shows a pending item). Models are managed after the first save.
- **Model rows**: name, id, capability chips, default badge, last test result,
  enable switch, and a `⋯` menu (test, set default, edit params, remove).
- **Add dialog**: the two custom presets (OpenAI-/Anthropic-compatible) come
  first — most configured providers are custom channels.
- **Overview**: the three metric tiles collapse into one quiet summary line.

Subscription (OAuth package) providers have no connection section; the detail
pane explains that login lives on the OAuth page.
