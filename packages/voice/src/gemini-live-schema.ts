import { validateLiveApplyValues, validateLiveSettingFields, type LiveSettingField } from '@piwin/contracts';

export const GEMINI_LIVE_PROVIDER_ID = 'google-gemini';
export const GEMINI_LIVE_DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';
export const GEMINI_LIVE_DEFAULT_VOICE = 'Kore';
export const GEMINI_LIVE_DEFAULT_THINKING = 'minimal';
export const GEMINI_LIVE_CHECKED = '2026-08-29';

export const GEMINI_LIVE_FALLBACK_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
export const GEMINI_LIVE_MODELS = [GEMINI_LIVE_DEFAULT_MODEL, GEMINI_LIVE_FALLBACK_MODEL] as const;

export const GEMINI_LIVE_VOICES = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
] as const;

export const GEMINI_LIVE_THINKING = ['minimal', 'low', 'medium', 'high'] as const;

export const GEMINI_LIVE_CONSTRAINED_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

/** Locked into the ephemeral token so the voice cannot invent an OpenAI identity. */
export const GEMINI_LIVE_SYSTEM_INSTRUCTION =
  'You are piwin Live, the realtime voice of the piwin desktop. Your model is Google Gemini. You are not OpenAI, ChatGPT, GPT, Codex, or a ChatGPT subscription voice. Do not introduce yourself as those. Speak the user language. Casual talk stays in this call. For work that needs files, code, tools, or the current project, call delegate_to_work_session with the instruction.';

export function geminiLiveSettingFields(): LiveSettingField[] {
  const fields: LiveSettingField[] = [
    {
      key: 'model',
      control: 'select',
      label: 'Model',
      required: true,
      defaultValue: GEMINI_LIVE_DEFAULT_MODEL,
      options: GEMINI_LIVE_MODELS.map((model) => ({ value: model, label: model })),
    },
    {
      key: 'voice',
      control: 'select',
      label: 'Voice',
      required: true,
      defaultValue: GEMINI_LIVE_DEFAULT_VOICE,
      options: GEMINI_LIVE_VOICES.map((voice) => ({ value: voice, label: voice })),
    },
    {
      key: 'thinkingLevel',
      control: 'select',
      label: 'Thinking',
      required: true,
      defaultValue: GEMINI_LIVE_DEFAULT_THINKING,
      options: GEMINI_LIVE_THINKING.map((level) => ({
        value: level,
        label: level.slice(0, 1).toUpperCase() + level.slice(1),
      })),
    },
  ];
  const valid = validateLiveSettingFields(fields);
  if (!valid.ok) throw new Error(valid.message);
  return fields;
}

export function validateGeminiLiveSettings(
  values: Readonly<Record<string, string>>,
): ReturnType<typeof validateLiveApplyValues> {
  return validateLiveApplyValues(geminiLiveSettingFields(), values);
}
