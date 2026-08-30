import {
  validateLiveApplyValues,
  validateLiveSettingFields,
  type LiveSettingField,
} from '@piwin/contracts';
import { CODEX_LIVE_VOICES, DEFAULT_CODEX_LIVE_VOICE } from './codex-live-adapter.js';

/** WP1 wire probe is not done. Hide Instant/Medium/High until evidence lands. */
export const CODEX_LIVE_INTELLIGENCE_ENABLED = false;

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
      defaultValue: 'medium',
      options: [
        { value: 'instant', label: 'Instant' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
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
