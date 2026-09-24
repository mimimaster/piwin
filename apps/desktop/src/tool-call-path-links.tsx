/** Openable path / logical document targets shown in tool call bodies. */
import type { ReactElement } from 'react';
import type { DocumentTargetRef } from '@piwin/contracts';
import type { ToolCardUi } from './chat-reducer';
import { formatFilePillPath } from './activity-timeline';
import { IconFile } from './shell-icons';

export type DocumentOpenInput = {
  title: string;
  path?: string;
  /** Explicit inline content; empty string is a legal empty document. */
  content?: string;
  target?: DocumentTargetRef;
  /** Owning assistant message id (tool snapshot recovery). */
  messageId?: string;
  toolCallId?: string;
};

/**
 * Resolve a tool path (absolute or project-relative) into open-file args.
 * Reuses the same absolute/relative rules as search result pills.
 */
export function resolveToolOpenPath(
  filePath: string,
  projectPath?: string | null,
): { absolutePath: string; relativePath: string } {
  const formatted = formatFilePillPath(filePath, undefined, projectPath);
  return {
    absolutePath: formatted.absolutePath,
    relativePath: formatted.relativePath,
  };
}

export function openResolvedToolPath(
  filePath: string,
  projectPath: string | null | undefined,
  onOpenFile: ((absolutePath: string, relativePath?: string) => void) | undefined,
): void {
  if (!onOpenFile) {
    return;
  }
  const resolved = resolveToolOpenPath(filePath, projectPath);
  onOpenFile(resolved.absolutePath, resolved.relativePath);
}

/**
 * Prefer the logical document opener so historical skill reads can recover
 * the persisted tool snapshot (messageId is filled in by the transcript row).
 * Falls back to onOpenFile when Doc Preview is not wired.
 */
export function openPathLikeToolDocument(input: {
  filePath: string;
  tool: ToolCardUi;
  projectPath?: string | null | undefined;
  onOpenDocument?: ((doc: DocumentOpenInput) => void) | undefined;
}): boolean {
  if (!input.onOpenDocument) {
    return false;
  }
  const resolved = resolveToolOpenPath(input.filePath, input.projectPath);
  const skillTarget = input.tool.presentation?.documentTargets?.find(
    (target) => target.kind === 'skill',
  );
  const basename = resolved.absolutePath.split(/[\\/]/).pop() || resolved.absolutePath;
  input.onOpenDocument({
    title: skillTarget?.kind === 'skill' ? skillTarget.skillId : basename,
    path: resolved.absolutePath,
    ...(skillTarget ? { target: skillTarget } : {}),
    toolCallId: input.tool.toolCallId,
  });
  return true;
}

/** Clickable path list for expanded tool body (targetPaths / changedPaths). */
export function ToolPathLinkList(props: {
  paths: string[];
  projectPath?: string | null | undefined;
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  toolCallId?: string | undefined;
  testId: string;
  prefix?: string | undefined;
}): ReactElement {
  const canOpen = Boolean(props.onOpenDocument || props.onOpenFile);
  return (
    <div className="tool-call-paths" data-testid={props.testId}>
      {props.prefix ? <span className="tool-call-paths-prefix">{props.prefix}</span> : null}
      {props.paths.map((filePath) => {
        const resolved = resolveToolOpenPath(filePath, props.projectPath);
        if (!canOpen) {
          return (
            <span key={filePath} className="pc tool-call-path-link static" title={resolved.absolutePath}>
              <IconFile className="i s12" />
              <span>{filePath}</span>
            </span>
          );
        }
        return (
          <button
            key={filePath}
            type="button"
            className="pc tool-call-path-link"
            title={resolved.absolutePath}
            data-testid="tool-call-path-link"
            data-full-path={resolved.absolutePath}
            onClick={() => {
              if (props.onOpenDocument) {
                const basename = resolved.absolutePath.split(/[\\/]/).pop() || resolved.absolutePath;
                props.onOpenDocument({
                  title: basename,
                  path: resolved.absolutePath,
                  ...(props.toolCallId ? { toolCallId: props.toolCallId } : {}),
                });
                return;
              }
              openResolvedToolPath(filePath, props.projectPath, props.onOpenFile);
            }}
          >
            <IconFile className="i s12" />
            <span>{filePath}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Logical document targets (skill:xxx / project-relative) for the expanded
 * tool body. Prefer these over raw absolute targetPaths — Host already
 * resolved identity and scope for us.
 */
export function ToolDocumentTargetList(props: {
  targets: DocumentTargetRef[];
  toolCallId: string;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  testId: string;
}): ReactElement {
  const canOpen = Boolean(props.onOpenDocument);
  return (
    <div className="tool-call-doc-targets" data-testid={props.testId}>
      {props.targets.map((target) => {
        const label = target.displayRef;
        if (!canOpen) {
          return (
            <span key={target.displayRef} className="pc tool-call-doc-target-link static" title={label}>
              <IconFile className="i s12" />
              <span>{label}</span>
            </span>
          );
        }
        return (
          <button
            key={target.displayRef}
            type="button"
            className="pc tool-call-doc-target-link"
            data-testid="tool-call-doc-target"
            data-target-ref={label}
            title={label}
            onClick={() => {
              const title =
                target.kind === 'skill'
                  ? target.skillId
                  : target.kind === 'media'
                    ? target.displayRef
                    : target.kind === 'local-file'
                      ? target.absolutePath.split(/[\\/]/).pop() || target.absolutePath
                      : target.relativePath.split(/[\\/]/).pop() || target.relativePath;
              props.onOpenDocument?.({
                title,
                target,
                toolCallId: props.toolCallId,
              });
            }}
          >
            <IconFile className="i s12" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
