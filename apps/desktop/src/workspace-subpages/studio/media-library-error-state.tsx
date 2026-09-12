import type { ReactElement } from 'react';
import { IconAlertCircle, IconRefresh } from '../../shell-icons';

export type MediaLibraryErrorStateProps = {
  error: string;
  isTeardown: boolean;
  onRetry: () => void;
  onClose: () => void;
  locale?: string | undefined;
};

export function MediaLibraryErrorState(props: MediaLibraryErrorStateProps): ReactElement {
  const isZh = props.locale !== 'en';
  const t = (en: string, cn: string) => (isZh ? cn : en);

  const title = props.isTeardown
    ? t('Host Service Disconnected', 'Host 服务尚未连接')
    : t('Could not load the library', '无法加载资料库');

  const detail = props.isTeardown
    ? t(
        'The connection to the Host service is establishing or disconnected. When the Host is ready, this page will automatically reconnect.',
        '与 Host 服务的连接正在建立或已中断。Host 启动就绪后页面将自动恢复，您也可以点击下方按钮重试。',
      )
    : props.error;

  return (
    <div className="lib-state is-error" data-testid="library-error-state">
      <div className="lib-error-card">
        <div
          className={`lib-error-icon-box${props.isTeardown ? '' : ' is-failure'}`}
          aria-hidden="true"
        >
          <IconAlertCircle width={26} height={26} />
        </div>
        <h2 className="lib-state-title">{title}</h2>
        <div className="lib-error-badge">
          <span className={`stamp-pill ${props.isTeardown ? 'ochre' : 'zhu'}`}>
            {props.isTeardown
              ? t('Host :4310 · Connecting…', 'Host :4310 · 连接等待中')
              : t('Error Occurred', '请求异常')}
          </span>
        </div>
        <p className="lib-state-detail">{detail}</p>
        <div className="lib-error-actions">
          <button
            type="button"
            className="btn pri"
            onClick={props.onRetry}
            data-testid="library-error-retry"
          >
            <IconRefresh width={12} height={12} style={{ marginRight: 5 }} aria-hidden="true" />
            <span>{t('Retry Connection', '重试连接')}</span>
          </button>
          <button
            type="button"
            className="btn sec"
            onClick={props.onClose}
            data-testid="library-error-back"
          >
            <span>{t('Back to Chat', '返回会话')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
