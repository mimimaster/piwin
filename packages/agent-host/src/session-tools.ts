import type { PermissionDecision, ProjectNetworkPolicy, WebConfig } from '@piwin/contracts';
import { createEmptyNetworkPolicy } from '@piwin/contracts';
import { createWebToolDefinitions } from '@piwin/tools-web';
import type { HostToolDefinition, WebRuntimeCredentials } from '@piwin/tools-web';
import { getProjectNetworkPolicy } from '@piwin/project';
import {
  evaluateWebPermission,
  resolveNonInteractiveDecision,
  type WebPermissionAction,
} from './permission-policy.js';

export type SessionToolRegistration = {
  tools: HostToolDefinition[];
};

export type ToolPermissionGate = (input: {
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
  signal?: AbortSignal;
}) => Promise<PermissionDecision>;

export type BuildSessionToolsOptions = {
  webConfig?: WebConfig;
  /** Host-resolved secrets kept in memory and never written into WebConfig. */
  webCredentials?: WebRuntimeCredentials;
  /**
   * Interactive gate (Desktop via HostRuntime). When omitted, ask→deny.
   */
  requestPermission?: ToolPermissionGate;
  /** Absolute project path for project-remember network policy. */
  projectPath?: string;
  /** Path to ~/.piwin/projects.json */
  projectsFilePath?: string;
};

function isBuildOptions(value: unknown): value is BuildSessionToolsOptions {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return (
    'webConfig' in value ||
    'webCredentials' in value ||
    'requestPermission' in value ||
    'projectPath' in value ||
    'projectsFilePath' in value
  );
}

/**
 * Build host-owned tools to attach to a Pi session.
 * Web executors are wrapped so network never runs without a policy decision.
 */
export function buildSessionTools(
  options: BuildSessionToolsOptions | WebConfig = {},
): SessionToolRegistration {
  let webConfig: WebConfig | undefined;
  let requestPermission: ToolPermissionGate | undefined;
  let webCredentials: WebRuntimeCredentials | undefined;
  let projectPath: string | undefined;
  let projectsFilePath: string | undefined;

  if (isBuildOptions(options)) {
    if (options.webConfig) webConfig = options.webConfig;
    if (options.webCredentials) webCredentials = options.webCredentials;
    if (options.requestPermission) requestPermission = options.requestPermission;
    if (options.projectPath) projectPath = options.projectPath;
    if (options.projectsFilePath) projectsFilePath = options.projectsFilePath;
  } else {
    webConfig = options as WebConfig;
  }

  const bare = createWebToolDefinitions(webConfig, webCredentials);
  const tools = bare.map((tool) =>
    wrapWebToolWithPermission(tool, {
      ...(requestPermission ? { requestPermission } : {}),
      ...(projectPath ? { projectPath } : {}),
      ...(projectsFilePath ? { projectsFilePath } : {}),
    }),
  );
  return { tools };
}

function wrapWebToolWithPermission(
  tool: HostToolDefinition,
  options: {
    requestPermission?: ToolPermissionGate;
    projectPath?: string;
    projectsFilePath?: string;
  },
): HostToolDefinition {
  if (tool.name !== 'web_search' && tool.name !== 'web_fetch') {
    return tool;
  }
  const action = tool.name as WebPermissionAction;
  return {
    ...tool,
    async execute(args, signal) {
      const target = action === 'web_search' ? String(args.query ?? '') : String(args.url ?? '');
      const evaluation = evaluateWebPermission(action, target);
      let decision: PermissionDecision = evaluation.decision;

      if (decision === 'ask') {
        const remembered = await isRememberedNetworkAllow(
          action,
          target,
          options.projectPath,
          options.projectsFilePath,
        );
        if (remembered) {
          decision = 'allow';
        } else if (options.requestPermission) {
          decision = await options.requestPermission({
            action: `network:${action}`,
            detail: target,
            defaultDecision: 'ask',
            ...(signal ? { signal } : {}),
          });
        } else {
          decision = resolveNonInteractiveDecision(evaluation);
        }
      }

      if (decision !== 'allow') {
        throw new Error(
          `Permission ${decision} for ${action}: ${evaluation.reason} (${target.slice(0, 120)})`,
        );
      }
      return tool.execute(args, signal);
    },
  };
}

async function isRememberedNetworkAllow(
  action: WebPermissionAction,
  target: string,
  projectPath?: string,
  projectsFilePath?: string,
): Promise<boolean> {
  if (!projectPath || !projectsFilePath) {
    return false;
  }
  let policy: ProjectNetworkPolicy;
  try {
    policy = await getProjectNetworkPolicy(projectsFilePath, projectPath);
  } catch {
    policy = createEmptyNetworkPolicy();
  }

  if (action === 'web_search') {
    return policy.allowWebSearch === true;
  }

  try {
    const hostname = new URL(target).hostname.toLowerCase();
    return policy.allowedFetchHosts.includes(hostname);
  } catch {
    return false;
  }
}

/**
 * Best-effort attach tools onto a Pi session-like object.
 * Supports common shapes: session.registerTool / agent.registerTool / tools array.
 */
export function attachToolsToPiSession(
  piSession: unknown,
  tools: HostToolDefinition[],
): { attached: number; mode: string } {
  if (!piSession || typeof piSession !== 'object') {
    return { attached: 0, mode: 'none' };
  }
  const sessionRecord = piSession as Record<string, unknown>;

  if (typeof sessionRecord.registerTool === 'function') {
    const registerTool = sessionRecord.registerTool as (tool: Record<string, unknown>) => void;
    for (const tool of tools) {
      registerTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: tool.execute,
      });
    }
    return { attached: tools.length, mode: 'registerTool' };
  }

  const agent = sessionRecord.agent;
  if (agent && typeof agent === 'object') {
    const agentRecord = agent as Record<string, unknown>;
    if (typeof agentRecord.registerTool === 'function') {
      const registerTool = agentRecord.registerTool as (tool: Record<string, unknown>) => void;
      for (const tool of tools) {
        registerTool({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          execute: tool.execute,
        });
      }
      return { attached: tools.length, mode: 'agent.registerTool' };
    }
  }

  return { attached: 0, mode: 'unsupported' };
}
