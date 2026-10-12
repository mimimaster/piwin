import { expect, it } from 'vitest';
import type { PromptInput } from '@piwin/contracts';
import { readExtensionCommandText } from './extension-command-input.js';

it('extracts a bare command despite client theme/mode metadata, including explicit queued intent', () => {
  expect(readExtensionCommandText({ text: ' /teacher ta ', artifactHostTheme: 'dark', agentMode: 'agent' })).toBe('/teacher ta');
  expect(readExtensionCommandText({ text: '/teacher resume saved-id', source: 'queued-turn' })).toBe('/teacher resume saved-id');
});
it.each<PromptInput>([
  { text: 'Explain /teacher ta' },
  { text: 'History:\n/teacher learn math' },
  { text: '/teacher ta', skillId: 'teacher' },
  { text: '/teacher ta', source: 'continuation' },
  { text: '/teacher ta', source: 'resume' },
  { text: '/teacher ta', source: 'voice-delegation' },
  { text: '/teacher ta', streamingBehavior: 'steer' },
  { text: '/teacher ta', streamingBehavior: 'followUp' },
])('does not activate from non-command or Host-continuation/skill/streaming inputs: %j', input => {
  expect(readExtensionCommandText(input)).toBeUndefined();
});
