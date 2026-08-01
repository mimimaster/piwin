# CLI Model Questionnaire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让模型通过 Pi 原生 Extension UI 的 `ctx.ui.select` 向用户提出结构化选择题，并在 CLI 中以 TTY 交互方式显示选项、把选择结果返回模型继续执行。

**Architecture:** 不新增 `ask-user` IPC 或第二套问题协议。新增一个 piwin bundled Extension `questionnaire`，由 Pi ResourceLoader 自动加载；Extension 只调用 Pi 原生 `ctx.ui.select` / `ctx.ui.input`，因此 Desktop 继续复用已有 `extension/ui_request` Dialog。CLI 通过 `createAgentHost` 的既有 `onExtensionUiRequest` seam 提供一个 Node 标准库实现的 TTY handler，渲染到 stderr，模型/会话文本仍保持 stdout 干净。

**Tech Stack:** TypeScript strict、Pi 0.80.10 Extension API、Node `readline/promises`、Vitest、现有 `@piwin/agent-host` ResourceLoader/Extension UI bridge。

## Global Constraints

- UI/apps never import Pi packages; only `@piwin/agent-host` may depend on Pi.
- Reuse `ExtensionUiKind = 'confirm' | 'select' | 'input'` and existing `extension/ui_request` / `extension/ui_resolve` IPC.
- Do not weaken TypeScript strictness or add `any` / non-null assertions.
- CLI must not render interactive prompts on stdout; stdout remains model/output protocol, question UI uses stderr.
- Non-TTY execution must resolve as cancelled or unavailable rather than hang waiting for input.
- Existing user changes in the working tree are unrelated and must remain untouched.
- Run targeted tests, package typechecks, and the full repository checks appropriate to touched packages.

---

### Task 1: Add the Pi-native bundled questionnaire Extension

**Files:**
- Create: `packages/agent-host/bundled-extensions/questionnaire.ts`
- Modify: `packages/agent-host/src/extension-scanner.test.ts`
- Test: `packages/agent-host/bundled-extensions/questionnaire.test.ts`

**Interfaces:**
- Consumes: Pi Extension API `registerTool`, `ctx.hasUI`, `ctx.ui.select`, and `ctx.ui.input`.
- Produces: a bundled model-facing tool named `questionnaire` with parameters `{ questions: Array<{ id: string; prompt: string; options: string[]; allowOther?: boolean }> }` and a JSON text result `{ answers: Array<{ id: string; value: string }>; cancelled: boolean }`.

- [ ] **Step 1: Write the failing Extension behavior test**

Create a fake `ExtensionAPI` that captures the registered tool, execute one question with a fake `ctx.ui.select`, and assert that the tool returns the selected value. Add cancellation and malformed-input cases. The test should exercise this shape:

```ts
const registrations: RegisteredTool[] = [];
questionnaireExtension({ registerTool: (tool) => registrations.push(tool) });
const result = await registrations[0].execute(
  'tool-1',
  { questions: [{ id: 'scope', prompt: 'Choose scope', options: ['project', 'global'] }] },
  undefined,
  undefined,
  {
    hasUI: true,
    ui: { select: async () => 'project', input: async () => undefined },
  },
);
expect(result.content[0]?.text).toContain('project');
expect(result.details).toEqual({
  answers: [{ id: 'scope', value: 'project' }],
  cancelled: false,
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @piwin/agent-host exec vitest run bundled-extensions/questionnaire.test.ts
```

Expected: FAIL because `packages/agent-host/bundled-extensions/questionnaire.ts` does not exist.

- [ ] **Step 3: Implement the minimal Pi-native Extension**

Create a dependency-light bundled module. Keep runtime imports out of the copied extension so it can be loaded from `~/.piwin/extensions`; use a JSON-schema-shaped `parameters` object. Validate unknown runtime values with type guards. The registered tool must:

```ts
export default function questionnaireExtension(pi: ExtensionApi): void {
  pi.registerTool({
    name: 'questionnaire',
    label: 'Questionnaire',
    description: 'Ask the user one or more questions and use the selected answers.',
    parameters: QUESTIONNAIRE_PARAMETERS,
    async execute(_toolCallId, params, _signal, _onUpdate, context) {
      if (context.hasUI === false) return unavailableResult();
      const questions = parseQuestions(params);
      if (questions.length === 0) return invalidResult('No questions provided');

      const answers: QuestionnaireAnswer[] = [];
      for (const question of questions) {
        const options = question.allowOther ? [...question.options, 'Other'] : question.options;
        const selected = await context.ui.select(question.prompt, options);
        if (selected === undefined) return cancelledResult(answers);
        if (question.allowOther && selected === 'Other') {
          const custom = await context.ui.input(`Response for: ${question.prompt}`, 'Type your answer');
          if (custom === undefined || custom.trim().length === 0) return cancelledResult(answers);
          answers.push({ id: question.id, value: custom.trim() });
        } else {
          answers.push({ id: question.id, value: selected });
        }
      }
      return successResult(answers);
    },
  });
}
```

The actual file must provide the concrete `ExtensionApi`, `ExtensionContext`, result types, schema, parser, and result helpers without `any`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @piwin/agent-host exec vitest run bundled-extensions/questionnaire.test.ts
```

Expected: PASS for selection, cancellation, no-UI, and invalid-input cases.

- [ ] **Step 5: Verify bundled installation/listing**

Extend the existing scanner test so `ensureBundledExtensionsInstalled(tempRoot)` includes `questionnaire`, and `scanExtensions` reports it as `source: 'bundled'`. Run:

```bash
pnpm --filter @piwin/agent-host exec vitest run src/extension-scanner.test.ts
```

Expected: PASS; existing `path-guard` assertions remain green.

- [ ] **Step 6: Commit the isolated Extension slice**

```bash
git add packages/agent-host/bundled-extensions/questionnaire.ts packages/agent-host/bundled-extensions/questionnaire.test.ts packages/agent-host/src/extension-scanner.test.ts
git commit -m "feat: add Pi-native questionnaire extension"
```

---

### Task 2: Implement a testable CLI TTY handler for Pi Extension UI

**Files:**
- Create: `apps/cli/src/extension-ui-cli.ts`
- Create: `apps/cli/src/extension-ui-cli.test.ts`

**Interfaces:**
- Consumes: `ExtensionUiRequest` / `ExtensionUiResponse` from `@piwin/agent-host` and Node `readline/promises`.
- Produces: `createCliExtensionUiRequestHandler(options?)`, matching the existing `onExtensionUiRequest` callback signature.

- [ ] **Step 1: Write failing formatting/parsing tests**

Test deterministic pieces before touching the terminal:

```ts
expect(formatSelectPrompt({ title: 'Choose mode', options: ['SDK', 'RPC'] })).toContain('1) SDK');
expect(formatSelectPrompt({ title: 'Choose mode', options: ['SDK', 'RPC'] })).toContain('2) RPC');
expect(parseSelection('2', 2)).toBe(1);
expect(parseSelection('', 2)).toBeUndefined();
expect(parseSelection('3', 2)).toBeUndefined();
```

Also test `createCliExtensionUiRequestHandler({ ask: async () => '2' })` returns `{ kind: 'select', value: 'RPC' }`, confirm maps yes/no, input returns `{ kind: 'input', value }`, cancellation returns the correct `cancelled` response, and a non-TTY handler cancels without invoking `ask`.

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
pnpm --filter @piwin/cli exec vitest run src/extension-ui-cli.test.ts
```

Expected: FAIL because the module/functions do not exist.

- [ ] **Step 3: Implement the CLI handler with Node standard library only**

Define:

```ts
export type CliExtensionUiRequest = ExtensionUiRequest & { sessionId: string };
export type CliExtensionUiOptions = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  isInteractive?: boolean;
  ask?: (question: string) => Promise<string>;
};
export function createCliExtensionUiRequestHandler(
  options?: CliExtensionUiOptions,
): (request: CliExtensionUiRequest) => Promise<ExtensionUiResponse>;
export function formatSelectPrompt(input: { title: string; options: string[] }): string;
export function parseSelection(value: string, optionCount: number): number | undefined;
```

Use `readline/promises` with the injected `input`/`output` streams. Default output is `process.stderr`; default input is `process.stdin`. The default `ask` creates one readline interface per request, calls `question(prompt)`, and closes it in `finally`. Mark the handler non-interactive when `isInteractive` is explicitly false, `input.isTTY !== true`, or `output.isTTY !== true`. For `select`, print a numbered list and accept a 1-based index; for `confirm`, accept `y/yes` and `n/no`; for `input`, return the entered line. Empty/invalid answers must not loop indefinitely: return cancelled. Never write prompt text to stdout.

- [ ] **Step 4: Run the focused test and verify it passes**

```bash
pnpm --filter @piwin/cli exec vitest run src/extension-ui-cli.test.ts
```

Expected: PASS without opening a real terminal.

- [ ] **Step 5: Commit the CLI UI slice**

```bash
git add apps/cli/src/extension-ui-cli.ts apps/cli/src/extension-ui-cli.test.ts
git commit -m "feat: add CLI Extension UI selector"
```

---

### Task 3: Wire `piwin chat` to the existing Pi Extension UI bridge

**Files:**
- Modify: `apps/cli/src/index.ts:1-40,670-693`
- Modify: `apps/cli/src/extension-ui-cli.test.ts` if needed for the exported wiring helper
- Test: `apps/cli/src/index.test.ts` only if an existing CLI test harness can isolate `commandChat`; otherwise verify through the handler and host integration tests.

**Interfaces:**
- Consumes: `createCliExtensionUiRequestHandler` from `./extension-ui-cli.js`.
- Produces: `createAgentHost({ onExtensionUiRequest })` for `piwin chat`, while preserving all existing CLI flags and stdout behavior.

- [ ] **Step 1: Add a wiring-level failing test or test seam**

Expose a small pure helper if needed:

```ts
export function createCliAgentHostOptions(input: {
  mode: HostMode;
  mock: boolean;
  permissionModeOverride?: PermissionMode;
}) {
  return {
    mode: input.mode,
    mock: input.mock,
    onExtensionUiRequest: createCliExtensionUiRequestHandler(),
    ...(input.permissionModeOverride !== undefined
      ? { permissionModeOverride: input.permissionModeOverride }
      : {}),
  };
}
```

Assert the returned options contain an `onExtensionUiRequest` function and preserve `mode`, `mock`, and permission override. If the current CLI module structure makes importing `index.ts` unsuitable, keep this as a direct code review/targeted typecheck requirement and cover the behavior through Task 2 plus the existing host bridge test.

- [ ] **Step 2: Run the relevant test/typecheck before implementation**

```bash
pnpm --filter @piwin/cli exec vitest run src/extension-ui-cli.test.ts
pnpm --filter @piwin/cli typecheck
```

Expected: existing tests pass; the new wiring assertion fails or the helper is absent.

- [ ] **Step 3: Wire the handler into `commandChat`**

Import `createCliExtensionUiRequestHandler` and include it in the existing `createAgentHost` options:

```ts
const host = createAgentHost({
  mode,
  mock,
  onExtensionUiRequest: createCliExtensionUiRequestHandler(),
  ...(permissionModeOverride !== undefined ? { permissionModeOverride } : {}),
});
```

Do not change `host serve`: it is a JSONL transport for Desktop and already forwards `extension/ui_request`. Do not import Pi packages into the CLI. Keep `formatEvent` unchanged so model text and tool output remain stdout-only.

- [ ] **Step 4: Run CLI typecheck and targeted tests**

```bash
pnpm --filter @piwin/cli typecheck
pnpm --filter @piwin/cli test
pnpm --filter @piwin/agent-host test
```

Expected: all pass.

- [ ] **Step 5: Perform a mock/non-TTY smoke check**

Run:

```bash
printf '' | pnpm --filter @piwin/cli exec tsx src/index.ts chat 'Ask me a question' --mock
```

Expected: command exits without hanging; mock mode does not attempt a real UI request. Run a real-provider/manual TTY check separately with `pnpm --filter @piwin/cli dev -- chat 'Ask me a question'` after a provider is configured.

- [ ] **Step 6: Commit the wiring slice**

```bash
git add apps/cli/src/index.ts apps/cli/src/extension-ui-cli.test.ts
 git commit -m "feat: wire questionnaire UI into CLI chat"
```

---

### Task 4: Document the cross-surface behavior and verify the vertical slice

**Files:**
- Create: `docs/adr/0023-model-questionnaire.md`
- Modify: `docs/architecture.md` in the host event/extension UI section
- Modify: `docs/dev-plan.md` in the Agent Window/CLI capability notes

**Interfaces:**
- Consumes: shipped `questionnaire` Extension, existing `extension/ui_request` bridge, CLI TTY handler.
- Produces: documented behavior and limitations: Desktop Dialog, CLI stderr TTY selector, non-TTY cancellation, no new Pi dependency or IPC contract.

- [ ] **Step 1: Write the ADR**

Document the decision:

```markdown
# ADR 0023: Model Questionnaire via Pi Extension UI

## Decision

The model-facing `questionnaire` tool is implemented as a bundled Pi Extension.
It uses Pi's native `ctx.ui.select` and `ctx.ui.input`; piwin does not add a
second question protocol. Desktop consumes the existing extension UI push/resolve
bridge. `piwin chat` supplies a Node readline TTY handler and renders prompts to
stderr. Non-TTY sessions report unavailable/cancelled UI rather than blocking.

## Consequences

- Pi SDK/RPC→SDK fallback and Desktop/CLI share one interaction path.
- Desktop keeps its existing `extension-ui-dialog` component.
- CLI has a simple numbered selector first; arrow-key TUI and multi-select remain
  future enhancements to the CLI adapter, not new model contracts.
- Extensions may disable the bundled tool through the existing extension config.
```

- [ ] **Step 2: Update architecture/dev plan**

Add that the existing Extension UI bridge is also the model questionnaire path, and mark the CLI structured selection slice as implemented. Explicitly state that UI apps still consume only normalized Piwin/Extension contracts and never import Pi packages.

- [ ] **Step 3: Run final verification**

```bash
pnpm --filter @piwin/agent-host typecheck
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/cli typecheck
pnpm --filter @piwin/cli test
pnpm typecheck
pnpm test
```

Expected: all commands pass. Review `git diff --check` and confirm no unrelated pre-existing working-tree changes were modified.

- [ ] **Step 4: Commit documentation and final verification state**

```bash
git add docs/adr/0023-model-questionnaire.md docs/architecture.md docs/dev-plan.md
git commit -m "docs: document Pi-native questionnaire flow"
```

---

## Self-review checklist

- [ ] Spec coverage: Pi-native `ctx.ui.select`/`input`, bundled model tool, CLI TTY choices, Desktop reuse, non-TTY behavior, tests, docs.
- [ ] No new raw Pi import from `apps/cli` or `apps/desktop`.
- [ ] No second question IPC or duplicate Desktop dialog.
- [ ] No `any`, non-null assertions, silent catches, or stdout protocol pollution.
- [ ] Existing permission approval flow remains unchanged and is not conflated with questionnaire answers.
- [ ] Type names/signatures are consistent across the Extension, CLI handler, and existing `onExtensionUiRequest` seam.
