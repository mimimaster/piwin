import type { ReactElement } from 'react';
import { Dialog } from '@piwin/ui-kit';
import type { HostCreateEntryInput, HostDirEntry, HostListDirData } from '@piwin/contracts';
import { HostWorkspacePicker } from '../../host/host-workspace-picker.js';

export type KnowledgeFolderPickerDialogProps = {
  locale: 'zh-CN' | 'en';
  open: boolean;
  currentPath: string;
  onCurrentPathChange: (path: string) => void;
  onOpenChange: (open: boolean) => void;
  listDirectory: (path?: string, includeHidden?: boolean) => Promise<HostListDirData>;
  createEntry: (input: HostCreateEntryInput) => Promise<HostDirEntry>;
  recents: readonly string[];
  onConfirm: (path: string) => void;
  onCancel: () => void;
};

/** Host folder picker used by "添加资料". Kept out of the shell so the shell
 *  stays navigation and the picker stays a picker. */
export function KnowledgeFolderPickerDialog(
  props: KnowledgeFolderPickerDialogProps,
): ReactElement {
  return (
    <Dialog
      label={
        props.locale === 'zh-CN'
          ? '添加文件夹作为知识库'
          : 'Add a folder as a knowledge base'
      }
      open={props.open}
      onOpenChange={props.onOpenChange}
      testId="knowledge-folder-picker"
      closeOnInteractOutside
      contentClassName="workspace-open-dialog"
    >
      <HostWorkspacePicker
        locale={props.locale}
        currentPath={props.currentPath}
        onCurrentPathChange={props.onCurrentPathChange}
        listDirectory={props.listDirectory}
        createEntry={props.createEntry}
        recents={props.recents}
        onConfirm={props.onConfirm}
        onCancel={props.onCancel}
      />
    </Dialog>
  );
}
