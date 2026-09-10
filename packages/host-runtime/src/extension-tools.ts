/**
 * Host customTools for Pi Extensions (agent-driven install + list).
 *
 * The model calls `extension_install` when the user asks to add an extension
 * ("install the X extension"). Install stages an immutable revision, enables
 * it, and triggers an after-current-run `extensions/apply` so the new tools
 * are live on the next turn — no app restart. Every call passes a per-call
 * permission prompt (`risk: 'unknown'`, not rememberable).
 *
 * Only self-contained sources work: a git repo whose entry is a root
 * `index.ts` / a single `.ts` file, or a local path. Packages that need
 * `npm install` (dependencies or lifecycle scripts) are rejected with the
 * exact `pi install npm:<name>` command instead.
 */
import type {
  ExtensionsConfig,
  ExtensionSummary,
  HostToolRegistration,
  InstallSource,
  ToolResult,
} from '@piwin/contracts';
import { installExtension } from '@piwin/marketplace';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { scanExtensions } from './extension-scanner.js';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';

/** Outcome of the after-install `extensions/apply` for this session. */
export type ExtensionApplyOutcome = { ok: true; phase: string } | { ok: false; error: string };

export type BuildExtensionToolsOptions = {
  /** When false, returns no tools. */
  enabled: boolean;
  piwinRoot: string;
  sessionId: string;
  extensionsConfig?: ExtensionsConfig;
  /**
   * Trigger `extensions/apply` for this session. The tool always requests
   * `after-current-run` so activation runs once the current turn finishes.
   */
  applyExtensions: (when: 'after-current-run') => Promise<ExtensionApplyOutcome>;
};

function invalid(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}

function parseInstallSource(args: Record<string, unknown>): InstallSource | { error: string } {
  const kind = args.kind;
  if (kind === 'local') {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    if (!path) return { error: 'kind "local" requires a non-empty "path".' };
    return { kind: 'local', path };
  }
  if (kind === 'git') {
    const url = typeof args.url === 'string' ? args.url.trim() : '';
    if (!url) return { error: 'kind "git" requires a non-empty "url".' };
    // Reject the shapes that are clearly an npm package rather than a repo, so
    // the model gets the right next step instead of a confusing clone failure.
    const looksLikeNpmSpec =
      /^npm:/i.test(url) || /^@[^/\s]+\/[^/\s]+$/.test(url) || /^[a-z0-9][a-z0-9._-]*$/i.test(url);
    if (looksLikeNpmSpec) {
      const name = url.replace(/^npm:/i, '');
      return {
        error: `"${name}" looks like an npm package, not a git repository. Tell the user to run \`pi install npm:${name}\` — this tool only installs from a git URL or a local path.`,
      };
    }
    const subdir = typeof args.subdir === 'string' ? args.subdir.trim() : '';
    const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
    return {
      kind: 'git',
      url,
      ...(subdir ? { subdir } : {}),
      ...(ref ? { ref } : {}),
    };
  }
  return { error: 'kind must be "git" or "local".' };
}

function summarizeExtension(extension: ExtensionSummary): Record<string, unknown> {
  return {
    id: extension.id,
    name: extension.name,
    description: extension.description,
    source: extension.source,
    enabled: extension.enabled,
    ...(extension.version ? { version: extension.version } : {}),
    ...(extension.managed ? { managed: true } : {}),
  };
}

export function buildExtensionTools(options: BuildExtensionToolsOptions): HostToolRegistration[] {
  if (!options.enabled) {
    return [];
  }
  const { piwinRoot, sessionId } = options;

  return [
    {
      descriptor: {
        name: 'extension_list',
        description:
          'List Pi extensions installed for the user, with enabled state. ' +
          'Call before extension_install to check whether the extension is already present.',
        parameters: { type: 'object', properties: {} },
      },
      family: 'extensions-write',
      permissionSpec: {
        action: 'extensions:list',
        risk: 'unknown',
        rememberable: false,
        readOnly: true,
      },
      async execute() {
        const extensions = await scanExtensions({
          piwinRoot,
          ...(options.extensionsConfig ? { extensionsConfig: options.extensionsConfig } : {}),
        });
        return {
          ok: true,
          output: JSON.stringify(extensions.map(summarizeExtension), null, 2),
          details: { count: extensions.length },
        };
      },
    },
    {
      descriptor: {
        name: 'extension_install',
        description:
          'Install a Pi extension for the user, enable it, and activate it after this turn ' +
          '(new tools are available on the next turn; no restart). ' +
          'Sources: kind "git" (a repo whose entry is a root index.ts or a single self-contained .ts file; ' +
          'set "subdir" when it lives in a folder), or kind "local" (an absolute path). ' +
          'Packages that need `npm install` cannot be installed this way — the tool returns the ' +
          '`pi install npm:<name>` command to give the user instead. ' +
          'The user approves every install in a permission prompt.',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['git', 'local'] },
            url: { type: 'string', description: 'Git URL (kind=git). https:// or ssh://.' },
            path: { type: 'string', description: 'Absolute local path (kind=local).' },
            subdir: {
              type: 'string',
              description: 'Optional subdirectory inside the git repo that holds the extension.',
            },
            ref: { type: 'string', description: 'Optional git branch or tag.' },
            name: { type: 'string', description: 'Optional display id override.' },
          },
          required: ['kind'],
        },
      },
      family: 'extensions-write',
      permissionSpec: {
        action: 'extensions:install',
        risk: 'unknown',
        rememberable: false,
        subjectBuilder: (args) => ({
          kind: 'tool',
          action: `extensions:install ${
            typeof args.url === 'string' ? args.url : typeof args.path === 'string' ? args.path : ''
          }`.trim(),
        }),
      },
      prepareArgs: passThroughPrepareArgs,
      async execute(args) {
        const source = parseInstallSource(args);
        if ('error' in source) {
          return invalid(source.error);
        }
        const name =
          typeof args.name === 'string' && args.name.trim() ? args.name.trim() : undefined;

        let extensionId: string;
        try {
          const result = await installExtension({
            piwinRoot,
            source,
            ...(name ? { name } : {}),
          });
          extensionId = result.extensionId;
        } catch (error) {
          return {
            ok: false,
            code: 'execution-failed',
            message: error instanceof Error ? error.message : String(error),
          };
        }

        try {
          await createExtensionRevisionStore(piwinRoot).setEnabled(extensionId, true);
        } catch (error) {
          return {
            ok: false,
            code: 'execution-failed',
            message: `Installed ${extensionId} but could not enable it: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }

        const applied = await options.applyExtensions('after-current-run');
        if (!applied.ok) {
          return {
            ok: true,
            output:
              `Installed and enabled "${extensionId}", but scheduling activation failed: ${applied.error}. ` +
              `It will load in new sessions; the user can retry activation from Settings → Extensions.`,
            details: { extensionId, activated: false },
          };
        }
        return {
          ok: true,
          output:
            `Installed and enabled "${extensionId}". Activation is scheduled for after this turn ` +
            `(phase: ${applied.phase}); its tools are available on your next turn.`,
          details: { extensionId, activated: true, phase: applied.phase },
        };
      },
    },
  ];
}
