import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";

// Compare real Pi sessions against a local synthetic stream, never a provider.
// This deliberately uses a chars/4 mock server budget, not a real tokenizer.
const runtimes = [];
let outputPath;
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  const value = process.argv[++index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  if (flag === "--output") outputPath = resolve(value);
  else if (flag === "--runtime") {
    const split = value.indexOf("=");
    if (split < 1)
      throw new Error("--runtime expects VERSION=/absolute/package/root");
    runtimes.push([value.slice(0, split), resolve(value.slice(split + 1))]);
  } else throw new Error(`Unknown option ${flag}`);
}
if (!runtimes.length)
  throw new Error(
    "Supply at least one --runtime VERSION=/absolute/pi-coding-agent/root",
  );
const probeDirectory = await mkdtemp(join(tmpdir(), "piwin-overflow-probe-"));
const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const results = [];
for (const [version, dir] of runtimes) {
  assert.equal(
    JSON.parse(await readFile(dir + "/package.json", "utf8")).version,
    version,
  );
  const pi = await import(dir + "/dist/index.js");
  const aiDir = existsSync(
    dir + "/node_modules/@earendil-works/pi-ai/dist/index.js",
  )
    ? dir + "/node_modules/@earendil-works/pi-ai"
    : dir + "/../pi-ai";
  const ai = await import(aiDir + "/dist/index.js");
  for (const mode of [
    "threshold-burst",
    "oversized-retained-batch",
    "oversized-summary",
  ]) {
    const window = mode === "threshold-burst" ? 14000 : 256000;
    const credentials = new ai.InMemoryCredentialStore();
    const runtime = await pi.ModelRuntime.create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
    });
    runtime.registerProvider("synthetic", {
      api: "openai-completions",
      apiKey: "synthetic-key",
      baseUrl: "https://invalid.invalid/v1",
      models: [
        {
          id: "synthetic",
          name: "Synthetic",
          reasoning: false,
          input: ["text"],
          contextWindow: window,
          maxTokens: 1000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    const model = runtime.getModel("synthetic", "synthetic");
    const loader = {
      getExtensions: () => ({
        extensions: [],
        errors: [],
        runtime: pi.createExtensionRuntime(),
      }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => "Synthetic research session.",
      getAppendSystemPrompt: () => [],
      getSystemPromptSource: () => undefined,
      getAppendSystemPromptSources: () => [],
      extendResources: () => {},
      reload: async () => {},
    };
    const sessionManager = pi.SessionManager.inMemory(probeDirectory);
    const settingsManager = pi.SettingsManager.inMemory({
      compaction: {
        enabled: true,
        reserveTokens: 2000,
        keepRecentTokens: 2000,
      },
      retry: { enabled: false },
    });
    const count = mode === "oversized-retained-batch" ? 9 : 1;
    const output =
      mode === "threshold-burst" ? "a ".repeat(14000) : "b ".repeat(60000);
    const { session } = await pi.createAgentSession({
      cwd: probeDirectory,
      agentDir: join(probeDirectory, "agent"),
      modelRuntime: runtime,
      model,
      settingsManager,
      sessionManager,
      resourceLoader: loader,
      tools: ["large"],
      customTools: [
        {
          name: "large",
          label: "large",
          description: "Synthetic output",
          parameters: { type: "object", properties: {} },
          execute: async () => ({
            content: [{ type: "text", text: output }],
            details: {},
          }),
        },
      ],
    });
    const order = [];
    const assistantStops = [];
    let turns = 0;
    let toolIssued = false;
    session.subscribe((event) => {
      if (event.type === "message_end" && event.message?.role === "assistant")
        assistantStops.push({
          stopReason: event.message.stopReason,
          errorMessage: event.message.errorMessage,
        });
      if (event.type === "tool_execution_end")
        order.push(event.isError ? "tool:error" : "tool:success");
      if (event.type === "compaction_start") order.push("compact:start");
      if (event.type === "compaction_end")
        order.push(event.result ? "compact:success" : "compact:failed");
    });
    const message = (
      content,
      stopReason = "stop",
      errorMessage,
      estimate = 10,
    ) => ({
      role: "assistant",
      content,
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: estimate,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: estimate + 1,
        cost: zeroCost,
      },
      stopReason,
      timestamp: Date.now(),
      ...(errorMessage ? { errorMessage } : {}),
    });
    session.agent.streamFunction = (_model, context) => {
      const stream = ai.createAssistantMessageEventStream();
      const text = JSON.stringify(context.messages);
      const estimated = Math.ceil(
        (text.length + (context.systemPrompt?.length ?? 0)) / 4,
      );
      const system =
        context.systemPrompt ?? ai.getCurrentSystemPrompt(context.messages);
      const isSummary = system.includes(
        "You are a context summarization assistant.",
      );
      order.push(`${isSummary ? "summary" : "request"}:${estimated}`);
      let response;
      if (estimated > window)
        response = message(
          [],
          "error",
          `maximum context length is ${window} tokens; synthetic estimated input ${estimated}`,
          0,
        );
      else if (isSummary)
        response = message([
          { type: "text", text: "Synthetic compact summary." },
        ]);
      else if (mode === "oversized-summary" || turns < 2) {
        turns++;
        response = message(
          [{ type: "text", text: "Seed response " + "c ".repeat(4000) }],
          "stop",
          undefined,
          estimated,
        );
      } else if (!toolIssued) {
        toolIssued = true;
        response = message(
          Array.from({ length: count }, (_, i) => ({
            type: "toolCall",
            id: `synthetic-${i}`,
            name: "large",
            arguments: {},
          })),
          "toolUse",
          undefined,
          estimated,
        );
      } else
        response = message(
          [{ type: "text", text: "Synthetic completed." }],
          "stop",
          undefined,
          estimated,
        );
      setTimeout(() => {
        response.timestamp = Date.now();
        if (response.stopReason === "error")
          stream.push({ type: "error", reason: "error", error: response });
        else
          stream.push({
            type: "done",
            reason: response.stopReason,
            message: response,
          });
      }, 5);
      return stream;
    };
    let exception;
    try {
      if (mode === "oversized-summary") {
        for (let i = 0; i < 12; i++) {
          sessionManager.appendMessage({
            role: "user",
            content: [{ type: "text", text: "d ".repeat(50000) }],
            timestamp: Date.now(),
          });
          sessionManager.appendMessage(
            message([{ type: "text", text: "Seed." }]),
          );
        }
        session.agent.state.messages =
          sessionManager.buildSessionContext().messages;
        await session.compact();
      } else {
        await session.prompt("Seed one " + "e ".repeat(4000));
        await session.prompt("Seed two " + "f ".repeat(4000));
        await session.prompt("Run synthetic tools.");
      }
    } catch (error) {
      exception = error.message;
    }
    const last = session.agent.state.messages.findLast(
      (m) => m.role === "assistant",
    );
    if (mode !== "oversized-summary")
      assert.equal(
        order.filter((event) => event === "tool:success").length,
        count,
      );
    else assert.match(exception ?? "", /Summarization failed/);
    results.push({
      version,
      mode,
      window,
      order,
      assistantStops,
      lastStopReason: last?.stopReason,
      lastError: last?.errorMessage,
      exception,
      finalContextEstimate: Math.ceil(
        JSON.stringify(session.agent.state.messages).length / 4,
      ),
    });
    session.dispose();
  }
}
if (outputPath)
  await writeFile(outputPath, JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
