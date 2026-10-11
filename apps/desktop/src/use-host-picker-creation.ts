import { useRef, useState } from 'react';
import type { HostCreateEntryInput, HostDirEntry } from '@piwin/contracts';
import { isValidHostEntryName } from '@piwin/contracts';
import type { HostPickerCreationTarget } from './host-workspace-picker-menu.js';
import { suggestHostEntryName } from './host-workspace-picker-nav.js';

type CreationDraft = { kind: HostDirEntry['kind']; name: string; parentPath: string };

export function useHostPickerCreation(
  locale: 'zh-CN' | 'en',
  onCreate: (input: HostCreateEntryInput) => Promise<void>,
) {
  const [draft, setDraft] = useState<CreationDraft | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const name = draft?.name.trim() ?? '';
  const validName = isValidHostEntryName(
    name,
    draft?.parentPath.startsWith('/') ? 'posix' : 'windows',
  );

  function start(kind: HostDirEntry['kind'], column: HostPickerCreationTarget): void {
    if (pendingRef.current) return;
    setError(null);
    // Preserve the invoked destination even if it differs from the browsed directory.
    setDraft({
      kind,
      parentPath: column.path,
      name: suggestHostEntryName(column.entries, kind, locale),
    });
  }

  function cancel(): void {
    if (!pendingRef.current) setDraft(null);
  }

  function setName(value: string): void {
    setDraft((previous) => (previous ? { ...previous, name: value } : null));
    setError(null);
  }

  async function submit(): Promise<void> {
    if (!draft || !validName || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await onCreate({ parentPath: draft.parentPath, kind: draft.kind, name });
      setDraft(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return { draft, pending, error, validName, start, cancel, setName, submit };
}
