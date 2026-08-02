import { useState, type ReactElement } from 'react';
import { ContextMenu, ContextMenuItem } from '@piwin/ui-kit';
import { FileTypeIcon } from './file-type-icon';

export type PathChipProps = {
  fullPath: string;
  onOpen: () => void;
  label?: string | undefined;
  className?: string | undefined;
  showIcon?: boolean | undefined;
  'data-testid'?: string | undefined;
};

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

async function writePathToClipboard(path: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(path);
    return true;
  } catch {
    // Clipboard may be unavailable in insecure contexts; fail silently.
    return false;
  }
}

/**
 * Renders a file path as a compact chip with distinct file-type icons & colors.
 * Left click opens the file; right click offers "Copy Path" for the full path.
 */
export function PathChip({
  fullPath,
  onOpen,
  label,
  className = 'md-doc-chip',
  showIcon = true,
  'data-testid': testId,
}: PathChipProps): ReactElement {
  const displayText = label ?? fileNameFromPath(fullPath);
  const [copyLabel, setCopyLabel] = useState('Copy Path');

  function handleCopy(): void {
    void (async () => {
      const ok = await writePathToClipboard(fullPath);
      if (ok) {
        setCopyLabel('Copied');
        setTimeout(() => setCopyLabel('Copy Path'), 1200);
      }
    })();
  }

  return (
    <ContextMenu
      content={
        <ContextMenuItem onSelect={handleCopy} testId="path-chip-copy-path">
          {copyLabel}
        </ContextMenuItem>
      }
    >
      <a
        href="#"
        className={className}
        title={fullPath}
        data-testid={testId}
        data-full-path={fullPath}
        onClick={(event) => {
          event.preventDefault();
          onOpen();
        }}
      >
        {showIcon ? <FileTypeIcon filePathOrExt={fullPath} /> : null}
        <span className="chip-text">{displayText}</span>
      </a>
    </ContextMenu>
  );
}
