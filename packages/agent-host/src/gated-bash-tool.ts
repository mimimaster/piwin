/**
 * Replace Pi built-in bash with a permission-gated bash tool.
 * Deny hard-patterns immediately; ask UI for destructive patterns.
 */
import type { PermissionDecision } from '@piwin/contracts';
import {
  evaluateBashPermission,
  resolveNonInteractiveDecision,
} from './permission-policy.js';

export type GatedBashPermissionRequest = {
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
};

export type BuildGatedBashToolOptions = {
  cwd: string;
  requestPermission?: (
    request: GatedBashPermissionRequest,
  ) => Promise<PermissionDecision>;
};

/**
 * Build a Pi ToolDefinition for bash that enforces piwin permission policy.
 * Register as customTools name "bash" so it overrides the built-in definition.
 */
export async function buildGatedBashToolDefinition(
  options: BuildGatedBashToolOptions,
): Promise<unknown> {
  const piModule = await import('@earendil-works/pi-coding-agent');
  const createBashToolDefinition = (
    piModule as {
      createBashToolDefinition?: (
        cwd: string,
        bashOptions?: {
          operations?: {
            exec: (
              command: string,
              cwd: string,
              execOptions: {
                onData: (data: Buffer) => void;
                signal?: AbortSignal;
                timeout?: number;
                env?: NodeJS.ProcessEnv;
              },
            ) => Promise<{ exitCode: number | null }>;
          };
        },
      ) => unknown;
    }
  ).createBashToolDefinition;
  const createLocalBashOperations = (
    piModule as {
      createLocalBashOperations?: () => {
        exec: (
          command: string,
          cwd: string,
          execOptions: {
            onData: (data: Buffer) => void;
            signal?: AbortSignal;
            timeout?: number;
            env?: NodeJS.ProcessEnv;
          },
        ) => Promise<{ exitCode: number | null }>;
      };
    }
  ).createLocalBashOperations;

  if (typeof createBashToolDefinition !== 'function') {
    throw new Error('createBashToolDefinition missing from pi-coding-agent');
  }
  if (typeof createLocalBashOperations !== 'function') {
    throw new Error('createLocalBashOperations missing from pi-coding-agent');
  }

  const localOps = createLocalBashOperations();
  const requestPermission = options.requestPermission;

  return createBashToolDefinition(options.cwd, {
    operations: {
      exec: async (command, cwd, execOptions) => {
        const evaluation = evaluateBashPermission(command);
        let decision: PermissionDecision = evaluation.decision;

        if (decision === 'ask') {
          if (requestPermission) {
            decision = await requestPermission({
              action: 'bash',
              detail: `${evaluation.reason}: ${command}`,
              defaultDecision: 'ask',
            });
          } else {
            decision = resolveNonInteractiveDecision(evaluation);
          }
        }

        if (decision !== 'allow') {
          const message =
            `piwin blocked bash (${evaluation.reason}): ${command}` + '\n';
          execOptions.onData(Buffer.from(message, 'utf8'));
          return { exitCode: 1 };
        }

        return localOps.exec(command, cwd, execOptions);
      },
    },
  });
}
