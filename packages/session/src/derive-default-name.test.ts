import { describe, it, expect } from 'vitest';
import { deriveDefaultNameFromMessage, deriveSessionListName, extractUserFacingBody } from './derive-default-name.js';

describe('deriveDefaultNameFromMessage', () => {
  it('returns trimmed first line for a simple prompt', () => {
    expect(deriveDefaultNameFromMessage('Fix the login bug')).toBe('Fix the login bug');
  });

  it('strips markdown headers, bold, italic, code', () => {
    expect(deriveDefaultNameFromMessage('## **Fix** the _login_ `bug`')).toBe('Fix the login bug');
  });

  it('strips URLs and keeps surrounding text', () => {
    expect(deriveDefaultNameFromMessage('Check https://example.com/page for details')).toBe(
      'Check for details',
    );
  });

  it('collapses whitespace and trims', () => {
    expect(deriveDefaultNameFromMessage('  hello\n\n  world  ')).toBe('hello world');
  });

  it('takes the leading sentence from a multi-sentence prompt', () => {
    expect(
      deriveDefaultNameFromMessage(
        'Refactor the auth module. Also update the docs and add more tests afterwards.',
      ),
    ).toBe('Refactor the auth module');
  });

  it('strips polite/instructional openers (Chinese)', () => {
    expect(deriveDefaultNameFromMessage('请帮我修复登录 bug')).toBe('修复登录 bug');
    expect(deriveDefaultNameFromMessage('麻烦你生成一份交付文档')).toBe('生成一份交付文档');
  });

  it('strips polite/instructional openers (English)', () => {
    expect(deriveDefaultNameFromMessage('Please fix the login bug')).toBe('Fix the login bug');
    expect(deriveDefaultNameFromMessage('Can you refactor the auth module?')).toBe(
      'Refactor the auth module',
    );
  });

  it('keeps non-opener verbs intact', () => {
    expect(deriveDefaultNameFromMessage('Debug the parser issue')).toBe('Debug the parser issue');
  });

  it('truncates at 32 chars with ellipsis', () => {
    const long = 'This is a very long prompt that exceeds thirty two characters easily';
    const result = deriveDefaultNameFromMessage(long);
    expect(result.length).toBeLessThanOrEqual(32);
    expect(result.endsWith('…')).toBe(true);
  });

  it('truncates CJK without requiring spaces', () => {
    const long =
      '请为Walkthrough生成一份详细的交付文档请包含以下文本格式以及更多说明内容确保足够长';
    const result = deriveDefaultNameFromMessage(long);
    expect(result.length).toBeLessThanOrEqual(32);
    expect(result.endsWith('…')).toBe(true);
    expect(result.startsWith('为Walkthrough')).toBe(true);
  });

  it('returns empty string for blank input', () => {
    expect(deriveDefaultNameFromMessage('   \n\n  ')).toBe('');
  });

  it('uses the URL hostname when the message is only a link', () => {
    expect(deriveDefaultNameFromMessage('https://example.com/page')).toBe('example.com');
  });

  it('uses the first code line when the message is only a fence', () => {
    expect(deriveDefaultNameFromMessage('```ts\nconst answer = 42;\n```')).toBe(
      'const answer = 42;',
    );
  });

  it('strips agent-mode injection wrappers and keeps the user body', () => {
    const wrapped = [
      '[piwin-mode:agent]',
      '[piwin-prompt-meta kind="mode:agent" version="2" applies="every-turn"]',
      'Operating contract for this turn:',
      'Success: satisfy the goal.',
      '',
      '---',
      'User:',
      'Fix the login bug',
    ].join('\n');
    expect(deriveDefaultNameFromMessage(wrapped)).toBe('Fix the login bug');
  });

  it('strips skill wrappers and keeps the user body', () => {
    const wrapped = [
      '[piwin-skill:create-skill]',
      'Follow the installed skill "create-skill" (id: skill-1).',
      '---',
      'generate a skill for docs',
    ].join('\n');
    expect(deriveDefaultNameFromMessage(wrapped)).toBe('generate a skill for docs');
  });

  it('returns empty for pure directive noise', () => {
    expect(
      deriveDefaultNameFromMessage(
        '[piwin-mode:agent]\n[piwin-prompt-meta kind="mode:agent" version="2"]',
      ),
    ).toBe('');
  });
});

describe('extractUserFacingBody', () => {
  it('returns an empty string when the transcript body is missing', () => {
    expect(extractUserFacingBody(undefined as unknown as string)).toBe('');
    expect(extractUserFacingBody('')).toBe('');
  });

  it('returns plain user text unchanged', () => {
    expect(extractUserFacingBody('Fix the login bug')).toBe('Fix the login bug');
  });

  it('keeps the body after ---\\nUser: mode wrappers', () => {
    const wrapped = [
      '[piwin-mode:agent]',
      '[piwin-prompt-meta kind="mode:agent" version="2" applies="every-turn"]',
      'Operating contract for this turn:',
      "Success: satisfy the user's stated goal with the smallest correct change.",
      '',
      '---',
      'User:',
      '排查刻度条间距',
    ].join('\n');
    expect(extractUserFacingBody(wrapped)).toBe('排查刻度条间距');
  });

  it('strips mode wrappers when no User section is present', () => {
    const wrapped = [
      '[piwin-mode:agent]',
      '[piwin-prompt-meta kind="mode:agent" version="2" applies="every-turn"]',
      'Operating contract for this turn:',
      'Success: satisfy the goal.',
    ].join('\n');
    const body = extractUserFacingBody(wrapped);
    expect(body).not.toContain('piwin-mode');
    expect(body).not.toContain('piwin-prompt-meta');
    expect(body).not.toContain('Operating contract');
  });

  it('preserves image-path notes that are not piwin wrappers', () => {
    expect(extractUserFacingBody('See the screenshot below')).toBe('See the screenshot below');
  });
});

describe('deriveSessionListName', () => {
  it('uses text, then attachment basename, then Conversation', () => {
    expect(deriveSessionListName({ text: 'Fix login' })).toBe('Fix login');
    expect(
      deriveSessionListName({
        text: '',
        attachmentNames: ['/tmp/../secret/photo.png'],
      }),
    ).toBe('photo.png');
    expect(deriveSessionListName({ text: 'https://example.com/x' })).toBe('example.com');
    expect(deriveSessionListName({ text: '', attachmentNames: ['...'] })).toBe('Conversation');
  });
});
