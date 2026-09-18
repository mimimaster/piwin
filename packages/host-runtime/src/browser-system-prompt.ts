import type { HostToolDescriptor, HostToolRegistration } from '@piwin/contracts';

const BROWSER_WORKFLOW_PROMPT = `When the task changes or evaluates visible web UI, or the user asks you to inspect or operate a page, use the shared browser proactively. Use browser_status to inspect the current page, navigate only when needed, browser_snapshot for current refs, and browser_screenshot for visual layout. After actions, prefer browser_wait_for and verify the resulting state. The user shares this browser and may click or type in it at any time; if the page changed under you, re-read it instead of assuming your last snapshot. Refresh refs after navigation or a stale-target result. Do not claim visual verification unless screenshot pixels or a vision description were delivered.`;

const BROWSER_ACT_PROMPT = `When you can name the element you want by its visible label (a button, link, field, tab), call browser_act with that intent instead of browser_snapshot followed by browser_click/browser_type; it resolves the target locally in one step. If it returns status "needs-decision", nothing was done: choose a ref from its candidates or take a snapshot.`;

type NamedTool =
  | Pick<HostToolRegistration, 'descriptor'>
  | Pick<HostToolDescriptor, 'name'>;

export function formatBrowserSystemPrompt(tools: ReadonlyArray<NamedTool>): string | undefined {
  const names = new Set(
    tools.map((tool) => ('descriptor' in tool ? tool.descriptor.name : tool.name)),
  );
  if (!names.has('browser_status') || !names.has('browser_snapshot')) return undefined;
  return names.has('browser_act')
    ? `${BROWSER_WORKFLOW_PROMPT} ${BROWSER_ACT_PROMPT}`
    : BROWSER_WORKFLOW_PROMPT;
}
