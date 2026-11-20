/**
 * Modal directory picker backed by HostWorkspacePicker for selecting any
 * workspace folder to bind or preview in System Prompts settings.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { HostListDirData } from '@piwin/contracts';
import { Dialog } from '@piwin/ui-kit';
import { requestHostPickerEntry } from '../../host/host-picker-create-entry.js';
import { HostWorkspacePicker } from '../../host/host-workspace-picker';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { useSettings } from '../settings-context';

export function ProjectDirectoryPickerDialog(props: {
  open: boolean;
  initialPath?: string;
  onOpenChange: (open: boolean) => void;
  onSelectDirectory: (directoryPath: string) => void;
}): ReactElement {
  const { hostClient } = useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [pickerPath, setPickerPath] = useState(props.initialPath ?? '');

  useEffect(() => {
    if (props.open) {
      setPickerPath(props.initialPath ?? '');
    }
  }, [props.initialPath, props.open]);

  return (
    <Dialog
      label={isZh ? '选择生效项目目录' : 'Choose project directory'}
      open={props.open}
      onOpenChange={props.onOpenChange}
      testId="system-prompts-project-picker-dialog"
      contentClassName="workspace-open-dialog"
    >
      <HostWorkspacePicker
        locale={isZh ? 'zh-CN' : 'en'}
        currentPath={pickerPath}
        onCurrentPathChange={setPickerPath}
        mode="directory"
        listDirectory={async (path, includeHidden) => {
          const response = await hostClient?.request?.({
            type: 'host/list-dir',
            ...(path ? { path } : {}),
            includeHidden: includeHidden ?? false,
          });
          if (!response?.success) {
            throw new Error(response?.error ?? 'host/list-dir failed');
          }
          return response.data as HostListDirData;
        }}
        {...(hostClient?.supportsCommand?.('host/create-entry') && hostClient.request
          ? {
              createEntry: (input) =>
                requestHostPickerEntry(
                  (command) => {
                    const send = hostClient.request;
                    if (!send) throw new Error('Host connection is unavailable.');
                    return send(command);
                  },
                  input,
                  isZh ? 'zh-CN' : 'en',
                ),
            }
          : {})}
        onConfirm={(selectedPath) => {
          const trimmed = selectedPath.trim();
          if (!trimmed) return;
          props.onSelectDirectory(trimmed);
          props.onOpenChange(false);
        }}
        onCancel={() => props.onOpenChange(false)}
      />
    </Dialog>
  );
}
