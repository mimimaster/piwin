import type { ModelRef } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

/** A failed delegation must not become a path-only prompt to a text model. */
export class VisionDelegationError extends Error {
  constructor(model: ModelRef | undefined, cause: unknown) {
    const modelLabel = model ? `（${model.providerId}/${model.modelId}）` : '';
    super(
      `视觉委托失败${modelLabel}：${formatError(cause)}\n本轮已停止，图片未发送给主模型。请检查视觉委托设置后重试。`,
      { cause },
    );
    this.name = 'VisionDelegationError';
  }
}
