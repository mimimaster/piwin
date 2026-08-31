import {
  validateLiveApplyValues,
  validateLiveSettingFields,
  type LiveSettingField,
} from '@piwin/contracts';
import {
  CODEX_LIVE_INTELLIGENCE_ENABLED,
  CODEX_LIVE_INTELLIGENCES,
  CODEX_LIVE_VOICES,
  DEFAULT_CODEX_LIVE_INTELLIGENCE,
  DEFAULT_CODEX_LIVE_VOICE,
} from './codex-live-adapter.js';

export { CODEX_LIVE_INTELLIGENCE_ENABLED };

export function codexLiveSettingFields(): LiveSettingField[] {
  const fields: LiveSettingField[] = [
    {
      key: 'voice',
      control: 'select',
      label: 'Voice',
      required: true,
      defaultValue: DEFAULT_CODEX_LIVE_VOICE,
      options: CODEX_LIVE_VOICES.map((voice) => ({
        value: voice,
        label: voice.slice(0, 1).toUpperCase() + voice.slice(1),
      })),
    },
  ];
  if (CODEX_LIVE_INTELLIGENCE_ENABLED) {
    fields.push({
      key: 'intelligence',
      control: 'select',
      label: 'Intelligence',
      required: false,
      defaultValue: DEFAULT_CODEX_LIVE_INTELLIGENCE,
      options: CODEX_LIVE_INTELLIGENCES.map((level) => ({
        value: level,
        label: level.slice(0, 1).toUpperCase() + level.slice(1),
      })),
    });
  }
  const valid = validateLiveSettingFields(fields);
  if (!valid.ok) throw new Error(valid.message);
  return fields;
}

export function validateCodexLiveSettings(
  values: Readonly<Record<string, string>>,
): ReturnType<typeof validateLiveApplyValues> {
  return validateLiveApplyValues(codexLiveSettingFields(), values);
}
