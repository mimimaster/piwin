import type { ReactElement } from 'react';
import { Button, Notice } from '@piwin/ui-kit';
import type { DesktopLocale } from './desktop-locale';

export function AttentionOptInBanner(props: {
  visible: boolean;
  locale: DesktopLocale;
  onEnable: () => void;
  onDismiss: () => void;
}): ReactElement | null {
  if (!props.visible) {
    return null;
  }
  const zh = props.locale === 'zh-CN';
  return (
    <Notice
      tone="info"
      testId="attention-opt-in-banner"
      action={
        <>
          <Button
            variant="primary"
            data-testid="attention-opt-in-enable"
            onClick={props.onEnable}
          >
            {zh ? '开启' : 'Enable'}
          </Button>
          <Button data-testid="attention-opt-in-later" onClick={props.onDismiss}>
            {zh ? '以后再说' : 'Later'}
          </Button>
        </>
      }
    >
      {zh
        ? '任务在后台完成或需要批准时提醒你？'
        : 'Get notified when tasks finish in the background or need your approval?'}
    </Notice>
  );
}
