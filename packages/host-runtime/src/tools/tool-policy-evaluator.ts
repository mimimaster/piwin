/**
 * Pure Host tool policy evaluation. No IO, no prompts, no memory.
 */

import {
  isHostToolPermissionAction,
  type HostToolExecutionContext,
  type HostToolPermissionAction,
  type HostToolRegistration,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRuleSet,
  type PermissionSubject,
} from '@piwin/contracts';
import { evaluateBrowserNavigatePermission } from '../browser-tools.js';
import {
  evaluateBashPermission,
  evaluateFileWritePermission,
  evaluateNotesPermission,
  evaluateProcessPermission,
  evaluateWebPermission,
  type NotesPermissionAction,
  type PermissionEvaluation,
} from '../permission-policy.js';

export type ToolPolicyDecision = {
  decision: PermissionDecision;
  reason: string;
  action: HostToolPermissionAction;
  subject?: PermissionSubject;
  rememberable: boolean;
};

export type ToolPolicyOutcome =
  | { kind: 'decision'; policy: ToolPolicyDecision }
  | {
      kind: 'invalid-input';
      action: HostToolPermissionAction;
      reason: 'subject-builder-required';
      message: string;
    }
  | {
      kind: 'unclassified';
      action: string;
      reason: 'unclassified-side-effect';
    };

export type ToolPolicyEvaluator = {
  evaluate(input: {
    registration: HostToolRegistration;
    arguments: Record<string, unknown>;
    context: HostToolExecutionContext;
    rules: PermissionRuleSet;
    mode: PermissionMode;
    projectRoot: string;
  }): ToolPolicyOutcome;
};

const SUBJECT_REQUIRED_ACTIONS = new Set<string>([
  'bash',
  'file-write',
  'network:web_fetch',
  'network:web_search',
  'network:image-gen',
  'process:start',
  'process:stop',
  'notes:note_write',
  'notes:note_update',
  'notes:note_delete',
  'browser:navigate',
  'browser:screenshot',
]);

export function evaluateHostToolPolicy(input: {
  registration: HostToolRegistration;
  arguments: Record<string, unknown>;
  context: HostToolExecutionContext;
  rules: PermissionRuleSet;
  mode: PermissionMode;
  projectRoot: string;
}): ToolPolicyOutcome {
  const action = input.registration.permissionSpec.action;
  if (!isHostToolPermissionAction(action)) {
    return { kind: 'unclassified', action, reason: 'unclassified-side-effect' };
  }

  if (input.registration.permissionSpec.admission === 'trusted') {
    return {
      kind: 'decision',
      policy: {
        decision: 'allow',
        reason: 'trusted-admission',
        action,
        rememberable: input.registration.permissionSpec.rememberable,
      },
    };
  }

  if (input.registration.permissionSpec.readOnly === true) {
    return {
      kind: 'decision',
      policy: {
        decision: 'allow',
        reason: 'read-only',
        action,
        rememberable: input.registration.permissionSpec.rememberable,
      },
    };
  }

  const subject = input.registration.permissionSpec.subjectBuilder?.(
    input.arguments,
    input.context,
  );
  if (SUBJECT_REQUIRED_ACTIONS.has(action) && subject === undefined) {
    return {
      kind: 'invalid-input',
      action,
      reason: 'subject-builder-required',
      message: `could not build permission subject for ${input.registration.descriptor.name}`,
    };
  }

  const evaluation = evaluateHostToolDomainPolicy({
    action,
    subject,
    args: input.arguments,
    mode: input.mode,
    rules: input.rules,
    projectRoot: input.projectRoot,
  });

  return {
    kind: 'decision',
    policy: {
      decision: evaluation.decision,
      reason: evaluation.reason,
      action,
      rememberable: input.registration.permissionSpec.rememberable,
      ...(subject !== undefined ? { subject } : {}),
    },
  };
}

export const hostToolPolicyEvaluator: ToolPolicyEvaluator = {
  evaluate: evaluateHostToolPolicy,
};

export function evaluateHostToolDomainPolicy(input: {
  action: HostToolPermissionAction;
  subject: PermissionSubject | undefined;
  args: Record<string, unknown>;
  mode: PermissionMode;
  rules: PermissionRuleSet;
  projectRoot: string;
}): PermissionEvaluation {
  switch (input.action) {
    case 'bash': {
      const command =
        input.subject?.kind === 'bash' ? input.subject.command : String(input.args.command ?? '');
      return evaluateBashPermission(command, input.mode, input.rules);
    }
    case 'file-write': {
      const path =
        input.subject?.kind === 'file-write' ? input.subject.path : String(input.args.path ?? '');
      return evaluateFileWritePermission({
        absPath: path,
        projectRoot: input.projectRoot,
        mode: input.mode,
        rules: input.rules,
      });
    }
    case 'network:web_fetch':
      return evaluateWebPermission(
        'web_fetch',
        String(input.args.url ?? ''),
        input.rules,
        input.mode,
      );
    case 'network:web_search':
      return evaluateWebPermission(
        'web_search',
        String(input.args.query ?? ''),
        input.rules,
        input.mode,
      );
    case 'network:image-gen':
      return evaluateWebPermission(
        'web_fetch',
        input.subject?.kind === 'web-fetch' ? `https://${input.subject.host}` : 'https://image.example',
        input.rules,
        input.mode,
      );
    case 'network:video-gen':
      return { decision: 'allow', reason: 'legacy-unclassified-allow' };
    case 'process:start':
    case 'process:stop':
      return evaluateProcessPermission(input.action, input.rules, input.mode);
    case 'browser:navigate':
      return evaluateBrowserNavigatePermission(String(input.args.url ?? ''), input.rules, input.mode);
    case 'browser:screenshot':
      if (input.subject?.kind === 'file-write') {
        return evaluateFileWritePermission({
          absPath: input.subject.path,
          projectRoot: input.projectRoot,
          mode: input.mode,
          rules: input.rules,
        });
      }
      return {
        decision: input.mode === 'ask-all' ? 'ask' : 'allow',
        reason: input.mode === 'ask-all' ? 'ask-all-browser-screenshot' : 'browser-screenshot',
      };
    case 'notes:note_list':
    case 'notes:note_search':
    case 'notes:note_read':
    case 'notes:note_write':
    case 'notes:note_update':
    case 'notes:note_delete': {
      const noteAction = input.action.slice('notes:'.length) as NotesPermissionAction;
      const detail =
        typeof input.args.noteId === 'string'
          ? input.args.noteId
          : typeof input.args.query === 'string'
            ? input.args.query
            : typeof input.args.content === 'string'
              ? input.args.content.slice(0, 120)
              : '';
      return evaluateNotesPermission(noteAction, detail, input.mode, input.rules);
    }
    case 'flashcards:create':
    case 'flashcards:batch-create':
    case 'flashcards:delete':
      return {
        decision: input.mode === 'bypass' ? 'allow' : 'ask',
        reason: `${input.action} mutation requires review`,
      };
    case 'planning:create':
    case 'planning:update':
      return {
        decision: 'allow',
        reason: 'host-owned-planning-artifact',
      };
    case 'subagent:run':
      return {
        decision: input.mode === 'bypass' ? 'allow' : 'ask',
        reason: input.mode === 'bypass' ? 'bypass-delegate' : 'subagent-spawn',
      };
    case 'browser:click':
    case 'browser:type':
    case 'browser:fill-form':
    case 'browser:scroll':
    case 'browser:back':
    case 'browser:forward':
    case 'browser:lock':
      return {
        decision: input.mode === 'ask-all' ? 'ask' : 'allow',
        reason: input.mode === 'ask-all' ? 'ask-all-browser-interaction' : 'browser-interaction',
      };
    case 'filesystem:read':
    case 'filesystem:list':
    case 'process:list':
    case 'process:logs':
    case 'browser:snapshot':
    case 'browser:find':
    case 'browser:wait':
    case 'flashcards:list':
    case 'artifact:instructions':
    case 'toolbox:route':
    case 'mcp:trusted':
      return { decision: 'deny', reason: 'unclassified-side-effect' };
    case 'device:health-read':
      return { decision: 'allow', reason: 'client-device-consent-enforced' };
  }
}
