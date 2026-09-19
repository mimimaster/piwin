/**
 * Main-agent guidance injected when `code_search` is available.
 *
 * Devin's own system prompt carries this rule next to the tool description, and
 * it is what makes the tool get used at all — a tool description alone loses to
 * the always-present `grep`/`read`. Wording is verbatim from the Devin CLI
 * 3000.2.17 binary, with the tool name interpolated where Devin leaves a gap.
 *
 * Mirrors `browser-system-prompt.ts`: the compiler calls this with the session
 * tool set and injects the result only when the tool is actually registered.
 */
import type { HostToolDescriptor, HostToolRegistration } from '@piwin/contracts';

const CODE_SEARCH_WORKFLOW_PROMPT = '- IMPORTANT: If you need to explore the codebase to gather context, and the task does not involve a single file or function which is provided by name, you should use the code_search tool first instead of running search commands. Evaluate the relevance of what it returns carefully — the subagent can make mistakes — and follow up with your normal grep/glob/read tools to fill in anything it missed. IMPORTANT: YOU CANNOT CALL THIS TOOL IN PARALLEL.';

type NamedTool = Pick<HostToolRegistration, 'descriptor'> | Pick<HostToolDescriptor, 'name'>;

/** Returns the guidance when `code_search` is in the session tool set. */
export function formatCodeSearchSystemPrompt(tools: ReadonlyArray<NamedTool>): string | undefined {
  const names = new Set(
    tools.map((tool) => ('descriptor' in tool ? tool.descriptor.name : tool.name)),
  );
  return names.has('code_search') ? CODE_SEARCH_WORKFLOW_PROMPT : undefined;
}

/** Exported for tests and for docs that quote the injected rule. */
export { CODE_SEARCH_WORKFLOW_PROMPT };
