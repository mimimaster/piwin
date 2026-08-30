import { describe, expect, it } from 'vitest';
import {
  LIVE_SPEAKABLE_RESULT_MAX_CHARS,
  sanitizeLiveSpeakableResult,
} from './live-speakable-result.js';

describe('sanitizeLiveSpeakableResult', () => {
  it('wraps a short assistant reply as a speakable takeaway', () => {
    const spoken = sanitizeLiveSpeakableResult({
      assistantText: '洛杉矶今天晴，大约 24 度。',
      completed: true,
    });
    expect(spoken).toContain('洛杉矶今天晴');
    expect(spoken).toContain('Do not read tables');
  });

  it('strips fenced dumps and truncates long replies', () => {
    const spoken = sanitizeLiveSpeakableResult({
      assistantText: `${'晴朗 '.repeat(400)}\n\`\`\`\nSECRET=1\n\`\`\``,
      completed: true,
    });
    expect(spoken).not.toContain('SECRET');
    expect(spoken.length).toBeLessThan(LIVE_SPEAKABLE_RESULT_MAX_CHARS + 180);
  });

  it('does not invent a result when the run failed', () => {
    const spoken = sanitizeLiveSpeakableResult({
      assistantText: 'should not be spoken as success',
      completed: false,
    });
    expect(spoken).toContain('did not finish');
    expect(spoken).not.toContain('should not be spoken');
  });
});
