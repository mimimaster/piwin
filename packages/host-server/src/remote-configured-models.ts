import {
  readConfiguredChatModelsData,
  type ConfiguredChatModelsData,
} from '@piwin/contracts';

export function projectConfiguredChatModelsResponse(data: unknown): ConfiguredChatModelsData {
  return readConfiguredChatModelsData(data);
}
