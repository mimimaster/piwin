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
    canonicalizePath?: (path: string) => string;
  }): ToolPolicyOutcome;
};

/**
 * Real-path the parts of a subject compared against the workspace boundary
 * (ADR 0019 §4.1). Injected so this module stays free of filesystem access.
 */
function canonicalizeSubject(
  subject: PermissionSubject | undefined,
  canonicalizePath: ((path: string) => string) | undefined,
): PermissionSubject | undefined {
  if (!subject || !canonicalizePath) return subject;
  if (subject.kind === 'file-write' && subject.path.trim().length > 0) {
    return { kind: 'file-write', path: canonicalizePath(subject.path.trim()) };
  }
  if (subject.kind === 'file-paths') {
    return { kind: 'file-paths', paths: subject.paths.map((path) => canonicalizePath(path.trim())) };
  }
  if (subject.kind === 'process' && subject.cwd !== undefined && subject.cwd.trim().length > 0) {
    return { kind: 'process', cwd: canonicalizePath(subject.cwd.trim()) };
  }
  return subject;
}

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
  'browser:upload',
]);

export function evaluateHostToolPolicy(input: {
  registration: HostToolRegistration;
  arguments: Record<string, unknown>;
  context: HostToolExecutionContext;
  rules: PermissionRuleSet;
  mode: PermissionMode;
  projectRoot: string;
  canonicalizePath?: (path: string) => string;
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

  const subject = canonicalizeSubject(
    input.registration.permissionSpec.subjectBuilder?.(input.arguments, input.context),
    input.canonicalizePath,
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
      return evaluateBashPermission(command, input.mode, input.rules, input.projectRoot);
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
        input.subject?.kind === 'web-fetch'
          ? `https://${input.subject.host}`
          : 'https://image.example',
        input.rules,
        input.mode,
      );
    case 'network:video-gen':
      return { decision: 'allow', reason: 'legacy-unclassified-allow' };
    case 'process:start':
    case 'process:stop':
      return evaluateProcessPermission(input.action, input.rules, input.mode, {
        projectRoot: input.projectRoot,
        ...(input.subject?.kind === 'process' && input.subject.cwd !== undefined
          ? { cwd: input.subject.cwd }
          : {}),
      });
    case 'browser:navigate':
      return evaluateBrowserNavigatePermission(
        String(input.args.url ?? ''),
        input.rules,
        input.mode,
      );
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
    case 'extensions:install':
      // Installing an extension loads new code into the agent runtime; always
      // confirm with the user except under an explicit bypass mode.
      return {
        decision: input.mode === 'bypass' ? 'allow' : 'ask',
        reason: input.mode === 'bypass' ? 'bypass-extension-install' : 'extension-install',
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
    case 'browser:restart':
    case 'browser:dialog':
      return {
        decision: input.mode === 'ask-all' ? 'ask' : 'allow',
        reason: input.mode === 'ask-all' ? 'ask-all-browser-interaction' : 'browser-interaction',
      };
    case 'browser:tabs': {
      const action = input.args.action;
      if (action === 'list' || action === undefined) {
        return { decision: 'allow', reason: 'browser-tabs-list' };
      }
      if (action === 'new' && typeof input.args.url === 'string' && input.args.url.trim() !== '') {
        return evaluateBrowserNavigatePermission(input.args.url, input.rules, input.mode);
      }
      return {
        decision: input.mode === 'ask-all' ? 'ask' : 'allow',
        reason: input.mode === 'ask-all' ? 'ask-all-browser-interaction' : 'browser-tabs-write',
      };
    }
    case 'browser:upload':
      if (input.subject?.kind === 'file-paths' && input.subject.paths.length > 0) {
        let firstAsk: PermissionEvaluation | undefined;
        let firstAllow: PermissionEvaluation | undefined;
        for (const path of input.subject.paths) {
          const result = evaluateFileWritePermission({
            absPath: path,
            projectRoot: input.projectRoot,
            mode: input.mode,
            rules: input.rules,
          });
          if (result.decision === 'deny') return result;
          if (result.decision === 'ask') firstAsk ??= result;
          else firstAllow ??= result;
        }
        return firstAsk ?? firstAllow ?? { decision: 'deny', reason: 'empty-browser-upload' };
      }
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
        reason: input.mode === 'ask-all' ? 'ask-all-browser-upload' : 'browser-upload',
      };
    case 'browser:viewport': {
      const isSet =
        input.args.action === 'set' ||
        typeof input.args.width === 'number' ||
        typeof input.args.height === 'number';
      if (!isSet) {
        return { decision: 'allow', reason: 'browser-viewport-query' };
      }
      return {
        decision: input.mode === 'ask-all' ? 'ask' : 'allow',
        reason: input.mode === 'ask-all' ? 'ask-all-browser-interaction' : 'browser-viewport-set',
      };
    }
    case 'filesystem:read':
    case 'filesystem:list':
    case 'process:list':
    case 'process:logs':
    case 'browser:snapshot':
    case 'browser:find':
    case 'browser:wait':
    case 'browser:status':
    case 'browser:console':
    case 'browser:network':
    case 'flashcards:list':
    case 'extensions:list':
    case 'artifact:instructions':
    case 'toolbox:route':
    case 'mcp:trusted':
    // knowledge_* tools always set readOnly: true, so evaluateHostToolPolicy
    // short-circuits to allow before this domain evaluator ever runs.
    case 'knowledge:knowledge_list':
    case 'knowledge:knowledge_search':
    case 'knowledge:knowledge_read':
      return { decision: 'deny', reason: 'unclassified-side-effect' };
    case 'device:health-read':
      return { decision: 'allow', reason: 'client-device-consent-enforced' };
  }
}
