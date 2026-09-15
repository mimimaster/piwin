import type { HostToolDescriptor, HostToolRegistration } from '@piwin/contracts';

const BROWSER_WORKFLOW_PROMPT = `Browser workbench:
- browser_status first when controller or lifecycle is unknown.
- browser_snapshot before click/type; use refs from the latest snapshot.
- Write tools auto-acquire the agent lock from idle. Do not call browser_lock first.
- If the user has control, wait or ask them to give it back. Do not retry the same write.
- After a write, check the returned page url/title; snapshot again if the page changed.
- Visual QA requires a screenshot with inspect evidence; do not claim pixels you did not receive.`;

type NamedTool =
  | Pick<HostToolRegistration, 'descriptor'>
  | Pick<HostToolDescriptor, 'name'>;

export function formatBrowserSystemPrompt(tools: ReadonlyArray<NamedTool>): string | undefined {
  const names = new Set(
    tools.map((tool) => ('descriptor' in tool ? tool.descriptor.name : tool.name)),
  );
  if (!names.has('browser_status') || !names.has('browser_snapshot')) return undefined;
  return BROWSER_WORKFLOW_PROMPT;
}
