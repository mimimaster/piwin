import type { ModelRef } from '@piwin/contracts';

export type SearchDelegateOption = {
  key: string;
  label: string;
  ref: ModelRef;
};

export function modelRefKey(model: ModelRef | undefined): string {
  return model
    ? [model.protocol ?? '', model.providerId, model.modelId].map(encodeURIComponent).join('/')
    : '';
}
