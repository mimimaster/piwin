import { useMemo, type ReactElement } from 'react';
import { IconFile } from './shell-icons.js';
import { formatFilePillPath } from './activity-timeline';
import { PathChip } from './path-chip';
import { splitSystemFileReferences, type SystemFileTextPart } from './system-file-references';

export type SystemMessageContentProps = {
  text: string;
  projectPath?: string | null | undefined;
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  knownFilePaths?: readonly string[] | undefined;
};

function SystemFileReferenceView(props: {
  part: Extract<SystemFileTextPart, { kind: 'file' }>;
  projectPath?: string | null | undefined;
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
}): ReactElement {
  const { reference } = props.part;
  const resolved = formatFilePillPath(reference.path, undefined, props.projectPath);
  if (props.onOpenFile) {
    return (
      <PathChip
        fullPath={resolved.absolutePath}
        label={reference.label}
        className="system-file-link"
        data-testid="system-file-link"
        {...(props.projectPath ? { projectPath: props.projectPath } : {})}
        {...(resolved.relativePath ? { relativePath: resolved.relativePath } : {})}
        onOpen={() => props.onOpenFile?.(resolved.absolutePath, resolved.relativePath)}
      />
    );
  }

  return (
    <span
      className="pc system-file-reference static"
      data-testid="system-file-reference"
      title={resolved.absolutePath}
    >
      <IconFile className="i s12" />
      <span>{reference.label}</span>
    </span>
  );
}

/** Render system text with detected file names as transparent inline links. */
export function SystemMessageContent(props: SystemMessageContentProps): ReactElement {
  const parts = useMemo(
    () => splitSystemFileReferences(props.text, props.knownFilePaths),
    [props.text, props.knownFilePaths],
  );

  return (
    <div className="system-message-content" data-testid="system-message-content">
      {parts.map((part, index) =>
        part.kind === 'text' ? (
          <span key={`text-${index}`}>{part.text}</span>
        ) : (
          <SystemFileReferenceView
            key={`file-${part.reference.start}-${part.reference.path}`}
            part={part}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
          />
        ),
      )}
    </div>
  );
}
