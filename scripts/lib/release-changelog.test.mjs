import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countChangelogItems,
  draftChangelogSection,
  extractChangelogSection,
  renderReleaseNotes,
} from './release-changelog.mjs';

const CHANGELOG = `# 更新日志

说明文字里的列表不属于任何版本：
- 忽略我

## 0.1.2 — 2026-10-09
### 新增
- 下载页显示历史版本

### 修复
- 修复 Windows 标题栏按钮
* 星号列表也算

## 0.1.1 — 2026-10-08
- 没有分组的条目
`;

test('extractChangelogSection reads one version and stops at the next', () => {
  assert.deepEqual(extractChangelogSection(CHANGELOG, '0.1.2'), {
    version: '0.1.2',
    date: '2026-10-09',
    groups: [
      { title: '新增', items: ['下载页显示历史版本'] },
      { title: '修复', items: ['修复 Windows 标题栏按钮', '星号列表也算'] },
    ],
  });
});

test('extractChangelogSection keeps ungrouped items and reports missing versions', () => {
  const section = extractChangelogSection(CHANGELOG, '0.1.1');
  assert.deepEqual(section?.groups, [{ title: '', items: ['没有分组的条目'] }]);
  assert.equal(section && countChangelogItems(section), 1);
  assert.equal(extractChangelogSection(CHANGELOG, '0.1.3'), undefined);
  // 0.1.1 must not match the 0.1.10 heading prefix.
  assert.equal(extractChangelogSection('## 0.1.10 — 2026-11-01\n- x\n', '0.1.1'), undefined);
});

test('draftChangelogSection groups user-facing commit types and counts the rest', () => {
  const draft = draftChangelogSection('0.1.1', '2026-10-08', [
    'feat(mobile): add iOS Live Activity',
    'fix(desktop): reuse object URLs',
    'perf(desktop): virtualize the sidebar file tree',
    'docs: add guide',
    'merge something',
    '\uFEFFfix: bom-prefixed subject',
  ]);
  assert.equal(draft.omitted, 2);
  assert.equal(
    draft.markdown,
    [
      '## 0.1.1 — 2026-10-08',
      '',
      '### 新增',
      '- add iOS Live Activity',
      '',
      '### 优化',
      '- virtualize the sidebar file tree',
      '',
      '### 修复',
      '- reuse object URLs',
      '- bom-prefixed subject',
      '',
    ].join('\n'),
  );
});

test('a draft round-trips through extract and render', () => {
  const draft = draftChangelogSection('0.1.1', '2026-10-08', ['feat: a', 'fix: b']);
  const section = extractChangelogSection(draft.markdown, '0.1.1');
  assert.equal(section && renderReleaseNotes(section), '### 新增\n- a\n\n### 修复\n- b');
});
