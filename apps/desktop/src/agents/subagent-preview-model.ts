/**
 * Desktop adapter for the shared dense-preview projection
 * (`@piwin/host-client` subagent-preview-projection). Desktop only resolves
 * its own model label and maps the reducer's live stream onto the shared
 * tail shape; the lines themselves are the same in every shell.
 */
import type { SessionSummary, SubagentInvocation } from '@piwin/contracts';
import {
  deriveSubagentPreview as deriveSharedSubagentPreview,
  type SubagentPreviewView,
} from '@piwin/host-client';
import type { ChatMessageUi, SubagentStreamState } from '../conversation/chat-ui-types';
import type { ActiveSubagentStatus } from './subagent-activity-model';
import type { SubagentLocale } from './subagent-card-view';
import type { ModelOption } from '../models/model-options';
import { resolveModelDisplayName } from '../conversation/conversation-message-identity';

export type { SubagentPreviewLine, SubagentPreviewView } from '@piwin/host-client';

export type DesktopSubagentPreviewInput = {
  status: ActiveSubagentStatus;
  messages: readonly ChatMessageUi[];
  liveTail: SubagentStreamState | null;
  invocation?: SubagentInvocation | undefined;
  child?: SessionSummary | undefined;
  taskSummary?: string | undefined;
  modelOptions?: readonly ModelOption[] | undefined;
  showThinking: boolean;
  locale: SubagentLocale;
};

export function deriveSubagentPreview(input: DesktopSubagentPreviewInput): SubagentPreviewView {
  const model = input.invocation?.model ?? input.child?.subagentModel;
  const modelLabel =
    model !== undefined
      ? resolveModelDisplayName({
          model,
          ...(input.modelOptions ? { modelOptions: input.modelOptions } : {}),
        }).shortModelName
      : undefined;
  const tail = input.liveTail;
  return deriveSharedSubagentPreview({
    status: input.status,
    messages: input.messages,
    liveTail:
      tail === null
        ? null
        : { id: tail.currentMessageId ?? 'live', text: tail.text, thinking: tail.thinking, tools: tail.tools },
    invocation: input.invocation,
    child: input.child,
    taskSummary: input.taskSummary,
    modelLabel,
    showThinking: input.showThinking,
    locale: input.locale,
  });
}
