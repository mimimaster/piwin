/**
 * Pure chrome helpers for the left sidebar and stage ContextBar.
 * Host commands stay with App; this file owns title/scope labels and the
 * archived-list hydration fan-out.
 */
import type { SessionListOrder } from '@piwin/contracts';
import type { DesktopLocale } from './desktop-locale';

export type ArchivedHydrationRequest = {
  scope: { kind: 'general' } | { kind: 'project'; projectPath: string };
  options: {
    includeArchived: boolean;
    order: SessionListOrder;
  };
};

export function listArchivedHydrationRequests(input: {
  includeArchived: boolean;
  order: SessionListOrder;
  recentProjects: readonly { path: string }[];
  activeProjectPath: string | null;
}): ArchivedHydrationRequest[] {
  const requests: ArchivedHydrationRequest[] = [
    {
      scope: { kind: 'general' },
      options: { includeArchived: input.includeArchived, order: input.order },
    },
  ];
  for (const project of input.recentProjects) {
    requests.push({
      scope: { kind: 'project', projectPath: project.path },
      options: {
        includeArchived: input.includeArchived,
        order: input.order,
      },
    });
  }
  return requests;
}

export function resolveWorkbenchSessionTitle(input: {
  projectPath: string | null;
  projectLabel: string | null;
  sessionName: string;
}): string {
  if (input.projectPath && input.projectLabel) {
    return `${input.projectLabel} / ${input.sessionName}`;
  }
  return input.sessionName;
}

export function resolveWorkbenchScopeLabel(input: {
  isGeneral: boolean;
  locale: DesktopLocale;
  generalCopy: string;
}): string {
  if (input.isGeneral) {
    return input.generalCopy;
  }
  return input.locale === 'zh-CN' ? '项目' : 'Project';
}

export function findLastUserMessage<T extends { role: string }>(messages: readonly T[]): T | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message;
    }
  }
  return null;
}

export function insetComposerText(current: string, text: string): string {
  return current.trim() ? `${current}\n\n${text}` : text;
}

export function transcriptActivitySignal(input: {
  runPhase: string;
  messages: readonly { text: string; thinking: string }[];
  tools: readonly { toolCallId: string; status: string; output: string }[];
}): string {
  const latestMessage = input.messages[input.messages.length - 1];
  const latestVisibleLength = latestMessage
    ? latestMessage.text.length + latestMessage.thinking.length
    : 0;
  const toolStates = input.tools
    .map((tool) => `${tool.toolCallId}:${tool.status}:${tool.output.length}`)
    .join(',');
  return `${input.runPhase}:${input.messages.length}:${latestVisibleLength}:${toolStates}`;
}
