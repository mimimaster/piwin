import type { ReactElement } from 'react';
import { Notice } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context';

export type SettingsFeedbackTone = 'info' | 'success' | 'warning';

export type SettingsFeedbackToastProps = {
  error: string | null;
  info: string | null;
  tone?: SettingsFeedbackTone;
};

/**
 * Settings-wide save/error bubble. Mount once in the shell; pages call setInfo/setError.
 * Uses `.settings-feedback-host` so the notice floats over the content column
 * instead of covering the field that triggered it.
 */
export function SettingsFeedbackToast(props: SettingsFeedbackToastProps): ReactElement | null {
  const { locale } = useDesktopLocale();
  const message = props.error ?? props.info;
  if (!message) {
    return null;
  }

  const isError = props.error !== null;
  return (
    <div
      className="settings-feedback-host ui-feedback-host"
      aria-live="polite"
      data-testid="settings-feedback-toast"
    >
      <Notice
        tone={isError ? 'error' : (props.tone ?? 'info')}
        {...(isError
          ? { title: locale === 'zh-CN' ? '设置错误' : 'Settings error' }
          : {})}
        testId={isError ? 'settings-feedback-error' : 'settings-feedback-info'}
      >
        {message}
      </Notice>
    </div>
  );
}
