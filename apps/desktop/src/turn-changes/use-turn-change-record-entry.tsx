/**
 * The undo fallback, 代码撤销记录, as a Changes ⋯ menu entry plus the dialog
 * it opens. The working-tree list gains no undo powers from hosting it.
 */
import { useCallback, useState, type ReactNode } from 'react';
import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import { DropdownMenuItem } from '@piwin/ui-kit';
import { TurnChangeRecordDialog } from './turn-change-record-dialog.js';
import { pickProjectDirectory } from '../pick-project-directory.js';

export type TurnChangeRecordEntryInput = {
  hostClient: {
    supportsCommand: (type: HostCommand['type']) => boolean;
    request: (command: HostCommand, options?: { idempotencyKey?: string }) => Promise<HostResponse>;
    /** `live` = the Host sidecar on this machine; only then can a local folder picker name a Host path. */
    getTransport?: () => string;
  };
  subscribePush?: (listener: (message: HostPush) => void) => () => void;
  projectPath: string | null;
  locale: 'zh-CN' | 'en';
  turnChangesSupported: boolean;
};

export type TurnChangeRecordEntry = {
  /** null when the Host cannot list turn-change operations for this project. */
  menuItem: ReactNode;
  dialog: ReactNode;
};

export function useTurnChangeRecordEntry(input: TurnChangeRecordEntryInput): TurnChangeRecordEntry {
  const { hostClient } = input;
  const [open, setOpen] = useState(false);
  const t = (zh: string, en: string): string => (input.locale === 'en' ? en : zh);
  const available =
    input.turnChangesSupported &&
    input.projectPath !== null &&
    hostClient.supportsCommand('turn-changes/operations');
  const request = useCallback(
    (command: HostCommand, options?: { idempotencyKey?: string }) => hostClient.request(command, options),
    [hostClient],
  );
  const subscribe = input.subscribePush;
  const subscribePush = useCallback(
    (listener: (push: HostPush) => void) => subscribe?.(listener) ?? (() => undefined),
    [subscribe],
  );

  if (!available) return { menuItem: null, dialog: null };
  return {
    menuItem: (
      <DropdownMenuItem onSelect={() => setOpen(true)} testId="workspace-changes-undo-record">
        {t('代码撤销记录', 'Undo history')}
      </DropdownMenuItem>
    ),
    dialog: (
      <TurnChangeRecordDialog
        open={open}
        onOpenChange={setOpen}
        projectPath={input.projectPath}
        request={request}
        subscribePush={subscribePush}
        locale={input.locale}
        {...(hostClient.getTransport?.() === 'live'
          ? { pickDirectory: () => pickProjectDirectory({ title: t('选择导出位置', 'Choose export location') }) }
          : {})}
      />
    ),
  };
}
