import { describe, expect, it } from 'vitest';
import { detectExtensionCommandDescriptions } from './extension-command-descriptions.js';

describe('literal extension command descriptions', () => {
  it('reads both registration forms and root properties after nested handlers', () => {
    expect(detectExtensionCommandDescriptions(`
      pi.registerCommand('teacher-ta', { description: '助教答疑 · Answer questions', handler() {} });
      pi.registerCommand({ name: 'teacher-status', handler() { return { description: 'wrong' }; }, description: "学习进度" });
    `)).toEqual({ 'teacher-ta': '助教答疑 · Answer questions', 'teacher-status': '学习进度' });
  });
  it('ignores comments, quoted source, nested properties and dynamic expressions', () => {
    expect(detectExtensionCommandDescriptions(`
      // pi.registerCommand('comment', { description: 'wrong' });
      const sample = "registerCommand('string', { description: 'wrong' })";
      pi.registerCommand('nested', { metadata: { description: 'wrong' }, handler() {} });
      pi.registerCommand('dynamic', { description: getSecret(), handler() {} });
      pi.registerCommand('concat', { description: 'literal' + suffix, handler() {} });
      pi.registerCommand('template', { description: \`computed \${suffix}\`, handler() {} });
    `)).toEqual({});
  });
  it('decodes literal escapes, static templates and keeps the first description', () => {
    expect(detectExtensionCommandDescriptions(String.raw`
      pi.registerCommand('escaped', { description: 'Answer \'why\'\n\u590d\u4e60' });
      pi.registerCommand('escaped', { description: 'second registration' });
      pi.registerCommand('static', { description: \`Review due cards\` });
    `.replaceAll('\\`', '`'))).toEqual({ escaped: "Answer 'why'\n复习", static: 'Review due cards' });
  });
  it('does not attribute descriptions to unrelated or nameless calls', () => {
    expect(detectExtensionCommandDescriptions(`
      pi.registerTool({ name: 'tool', description: 'Wrong' });
      pi.registerCommand(name, { description: 'Dynamic name' });
      pi.registerCommand('empty', { description: '  ' });
      pi.registerCommand('first-empty', { handler() {} });
      pi.registerCommand('first-empty', { description: 'second registration' });
    `)).toEqual({});
  });
});
