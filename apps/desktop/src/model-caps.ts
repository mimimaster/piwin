import {
  isLikelyImageGenerationModel,
  isLikelyVideoGenerationModel,
  modelSupportsCapability,
} from '@piwin/contracts';
import type { ModelConfigEntry } from '@piwin/contracts';

export type ModelCapKey = 'chat' | 'vision' | 'reason' | 'image' | 'video' | 'native-web-search';

/** Color comes from the theme per key (`.pmodel-cap--<key>`), not from here. */
export type ModelCapChip = { key: ModelCapKey; label: string };

/** Capability chips shown on a configured model row. */
export function modelCaps(
  model: ModelConfigEntry,
  isChinese: boolean,
): ModelCapChip[] {
  const likelyImage =
    model.capabilities?.includes('image-generation') === true ||
    isLikelyImageGenerationModel(model.id, model.label, model.capabilities);
  const likelyVideo =
    model.capabilities?.includes('video-generation') === true ||
    isLikelyVideoGenerationModel(model.id, model.label, model.capabilities);
  const showChat =
    model.capabilities?.includes('chat') === true ||
    (modelSupportsCapability(model, 'chat') && !likelyImage && !likelyVideo);
  const caps: ModelCapChip[] = [];
  if (showChat) {
    caps.push({
      key: 'chat',
      label: isChinese ? '对话' : 'Chat',
    });
  }
  if (model.input?.includes('image') && modelSupportsCapability(model, 'chat')) {
    caps.push({
      key: 'vision',
      label: isChinese ? '视觉' : 'Vision',
    });
  }
  if (model.reasoning === true) {
    caps.push({
      key: 'reason',
      label: isChinese ? '推理' : 'Reason',
    });
  }
  if (likelyImage) {
    caps.push({
      key: 'image',
      label: isChinese ? '生图' : 'Image',
    });
  }
  if (likelyVideo) {
    caps.push({
      key: 'video',
      label: isChinese ? '视频' : 'Video',
    });
  }
  if (modelSupportsCapability(model, 'native-web-search')) {
    caps.push({
      key: 'native-web-search',
      label: isChinese ? '模型内置搜索' : 'Native search',
    });
  }
  return caps;
}
