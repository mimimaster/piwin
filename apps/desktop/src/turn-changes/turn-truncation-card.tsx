import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';

export type TurnTruncationCardProps = {
  locale?: string | undefined;
  onContinue?: (() => void) | undefined;
};

/** Non-error chip: the model hit an output cap. Continue keeps the path. */
export function TurnTruncationCard(props: TurnTruncationCardProps): ReactElement {
  const isChinese =
    props.locale === undefined ||
    props.locale === 'zh-CN' ||
    props.locale.startsWith('zh');
  return (
    <div className="turn-error-card turn-truncation-card" data-testid="turn-truncation-card">
      <div className="turn-error-card-inner">
        <div className="turn-error-header">
          <span className="turn-error-title">
            {isChinese ? '输出被截断' : 'Output truncated'}
          </span>
        </div>
        <div className="turn-error-detail" data-testid="turn-truncation-detail">
          {isChinese
            ? '模型在写完之前达到了输出上限。已生成的内容和工具结果还在。'
            : 'The model hit its output limit before finishing. Generated work is still here.'}
        </div>
        {props.onContinue ? (
          <div className="turn-error-actions">
            <Button
              variant="primary"
              size="compact"
              className="turn-error-retry-btn"
              data-testid="turn-truncation-continue-btn"
              onClick={props.onContinue}
            >
              {isChinese ? '继续' : 'Continue'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
