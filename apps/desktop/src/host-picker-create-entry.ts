import type {
  HostCommand,
  HostCreateEntryInput,
  HostDirEntry,
  HostResponse,
} from '@piwin/contracts';

/** Shared request/error adapter for workspace, knowledge, and script pickers. */
export async function requestHostPickerEntry(
  request: (command: HostCommand) => Promise<HostResponse>,
  input: HostCreateEntryInput,
  locale: 'zh-CN' | 'en',
): Promise<HostDirEntry> {
  const response = await request({ type: 'host/create-entry', input });
  if (!response.success) {
    const messages: Record<string, string> = {
      'host-entry-invalid-name': '名称无效，请修改后重试。',
      'host-entry-already-exists': '已存在同名文件或文件夹，请使用其他名称。',
      'host-entry-permission-denied': '没有权限在此文件夹中创建，请选择其他位置。',
      'host-entry-not-directory': '这个文件夹已不存在，请刷新后选择其他位置。',
      'host-entry-create-failed': '创建失败，请检查名称和位置后重试。',
    };
    throw new Error(
      locale === 'zh-CN'
        ? (messages[response.problem?.code ?? ''] ?? response.error)
        : response.error,
    );
  }
  return response.data as HostDirEntry;
}
