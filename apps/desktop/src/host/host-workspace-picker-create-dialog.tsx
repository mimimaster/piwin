import type { ReactElement } from 'react';
import { Button, Dialog, TextInput } from '@piwin/ui-kit';
import type { useHostPickerCreation } from '../hooks/use-host-picker-creation.js';

export function HostWorkspacePickerCreateDialog(props: {
  locale: 'zh-CN' | 'en';
  creation: ReturnType<typeof useHostPickerCreation>;
}): ReactElement {
  const zh = props.locale === 'zh-CN';
  const { creation } = props;
  const { draft, pending, error, validName } = creation;
  const title =
    draft?.kind === 'directory' ? (zh ? '新增文件夹' : 'New Folder') : zh ? '新增文件' : 'New File';
  return (
    <Dialog
      label={title}
      open={draft !== null}
      testId="host-workspace-create-dialog"
      onOpenChange={(open) => {
        if (!open) creation.cancel();
      }}
    >
      <form
        className="host-workspace-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          void creation.submit();
        }}
      >
        <h3>{title}</h3>
        <p className="muted host-workspace-create-location" title={draft?.parentPath}>
          {zh ? '位置：' : 'Location: '}
          {draft?.parentPath}
        </p>
        <TextInput
          label={zh ? '名称' : 'Name'}
          value={draft?.name ?? ''}
          testId="host-workspace-create-name"
          autoFocus
          disabled={pending}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            creation.setName(event.currentTarget.value);
          }}
          error={
            error ??
            (!validName
              ? zh
                ? '请输入有效名称，不能包含路径分隔符。'
                : 'Enter a valid name without path separators.'
              : undefined)
          }
          description={
            draft?.kind === 'file'
              ? zh
                ? '创建空文件，可在名称中填写扩展名。'
                : 'Creates an empty file. Include an extension in the name if needed.'
              : undefined
          }
        />
        <div className="host-workspace-create-buttons">
          <Button variant="ghost" disabled={pending} onClick={creation.cancel}>
            {zh ? '取消' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            type="submit"
            data-testid="host-workspace-create-submit"
            disabled={pending || !validName}
          >
            {pending ? (zh ? '正在创建…' : 'Creating…') : zh ? '创建' : 'Create'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
