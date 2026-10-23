/**
 * 提交 in the Changes toolbar: a popover holding the message and the exact
 * consequence of pressing the button. With nothing staged it stages every
 * change first — the same thing a person would do by hand one step earlier.
 */
import { useState, type KeyboardEvent, type ReactElement } from 'react';
import { Button, Popover, TextArea } from '@piwin/ui-kit';

export type ChangesCommitPopoverProps = {
  stagedCount: number;
  totalCount: number;
  busy: boolean;
  locale: 'zh-CN' | 'en';
  onCommit: (message: string, options: { stageAllFirst: boolean }) => Promise<boolean>;
};

export function ChangesCommitPopover(props: ChangesCommitPopoverProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const stageAllFirst = props.stagedCount === 0;
  const canSubmit = !props.busy && message.trim().length > 0 && props.totalCount > 0;
  const consequence = stageAllFirst
    ? isZh
      ? `将暂存全部 ${props.totalCount} 个文件并提交`
      : `Stages all ${props.totalCount} file(s), then commits`
    : isZh
      ? `将提交 ${props.stagedCount} 个已暂存文件`
      : `Commits ${props.stagedCount} staged file(s)`;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    const ok = await props.onCommit(message, { stageAllFirst });
    if (ok) {
      setMessage('');
      setOpen(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      side="bottom"
      autoFocus={true}
      label={isZh ? '提交变更' : 'Commit changes'}
      contentClassName="changes-commit-popover"
      testId="changes-commit-popover"
      trigger={
        <Button
          size="compact"
          variant="primary"
          className="changes-commit-trigger"
          data-testid="changes-commit-trigger"
          disabled={props.totalCount === 0}
        >
          {isZh ? '提交' : 'Commit'}
        </Button>
      }
    >
      <div className="changes-commit-form" onKeyDown={handleKeyDown}>
        <TextArea
          value={message}
          onChange={(value) => setMessage(value)}
          rows={3}
          placeholder={isZh ? '提交信息' : 'Commit message'}
          testId="changes-commit-message"
          className="changes-commit-message"
        />
        <div className="changes-commit-foot">
          <span className="changes-commit-consequence muted" data-testid="changes-commit-consequence">
            {consequence}
          </span>
          <Button
            size="compact"
            variant="primary"
            disabled={!canSubmit}
            data-testid="changes-commit-submit"
            title="⌘↵"
            onClick={() => void submit()}
          >
            {isZh ? '提交' : 'Commit'}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
