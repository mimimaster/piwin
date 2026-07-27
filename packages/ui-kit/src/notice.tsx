import type { ReactElement, ReactNode } from 'react';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export type NoticeProps = {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  details?: ReactNode;
  testId?: string;
};

/**
 * Inline non-blocking feedback near an initiating surface.
 * Queue/TTL policy stays in the app; this is presentation only.
 */
export function Notice(props: NoticeProps): ReactElement {
  const tone = props.tone ?? 'info';
  const role = tone === 'error' ? 'alert' : 'status';
  return (
    <div
      className={`ui-notice tone-${tone}`}
      role={role}
      data-testid={props.testId ?? 'notice'}
      data-tone={tone}
    >
      <div className="ui-notice-body">
        {props.title ? <strong className="ui-notice-title">{props.title}</strong> : null}
        {props.children ? <div className="ui-notice-message">{props.children}</div> : null}
        {props.details ? <div className="ui-notice-details">{props.details}</div> : null}
      </div>
      {props.action ? <div className="ui-notice-action">{props.action}</div> : null}
    </div>
  );
}
