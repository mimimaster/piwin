import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Reuse Desktop's existing DOM test dependency; no browser or network involved.
const requireDesktop = createRequire(
  new URL('../../../apps/desktop/package.json', import.meta.url),
);
const { Window } = requireDesktop('happy-dom');
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

function setup(width = 1440) {
  const window = new Window({
    width,
    settings: {
      enableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  window.HTMLElement.prototype.showPopover = function () {
    this.dataset.visible = 'true';
  };
  window.HTMLElement.prototype.hidePopover = function () {
    this.dataset.visible = 'false';
  };
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.document.write(read('proto-00-shell.html').replace(/<script[\s\S]*?<\/script>/g, ''));
  window.eval(read('shell-inspector.js'));
  window.eval(read('shell-interactions.js'));
  const query = (selector) => {
    const node = window.document.querySelector(selector);
    assert.ok(node, selector);
    return node;
  };
  const click = (selector) => query(selector).click();
  const input = (selector, text) => {
    query(selector).value = text;
    query(selector).dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const submit = (selector) =>
    query(selector).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const session = (title) =>
    [...window.document.querySelectorAll('[data-session]')]
      .find((row) => row.getAttribute('aria-label') === title)
      .click();
  return { window, query, click, input, submit, session };
}

test('project files preview and references return to the owning conversation', async () => {
  const page = setup();
  assert.equal(page.query('#session-title').textContent, 'Composer 忙会话队列');
  page.click('[data-open="files"]');
  page.click('[data-preview="composer-run-actions.tsx"]');
  assert.match(page.query('.source-view').textContent, /resolveRunAction/);
  page.click('[data-tool-action="reference"]');
  assert.match(page.query('.refs').textContent, /composer-run-actions.tsx/);
  page.click('[data-tool-action="back-files"]');
  assert.ok(page.query('.tree'));
  page.session('周报草稿');
  assert.doesNotMatch(page.query('#tool-content').textContent, /composer-run-actions/);
  page.session('Composer 忙会话队列');
  assert.match(page.query('.refs').textContent, /composer-run-actions.tsx/);
  await page.window.happyDOM.close();
});

test('terminals enforce four-session limit, switch logs and close independently', async () => {
  const page = setup();
  page.click('[data-open="terminal"]');
  assert.match(page.query('.terminal-screen').textContent, /45 passed/);
  for (let count = 0; count < 3; count++) page.click('[data-tool-action="add-terminal"]');
  assert.equal(page.query('#terminal-select').options.length, 4);
  assert.equal(page.query('[data-tool-action="add-terminal"]').disabled, true);
  page.input('.terminal-input input', 'pwd');
  page.submit('#terminal-form');
  assert.match(page.query('.terminal-screen').textContent, /\/Users\/you\/Developer\/piwin/);
  page.query('#terminal-select').value = '1';
  page.query('#terminal-select').dispatchEvent(new page.window.Event('change', { bubbles: true }));
  assert.match(page.query('.terminal-screen').textContent, /45 passed/);
  page.click('[data-tool-action="close-terminal"]');
  assert.equal(page.query('#terminal-select').options.length, 3);
  page.session('周报草稿');
  page.click('[data-open="terminal"]');
  assert.match(page.query('#tool-content').textContent, /为命令行选择项目/);
  await page.window.happyDOM.close();
});

test('Composition has its own document, draft and notes', async () => {
  const page = setup();
  page.session('周报草稿');
  assert.match(page.query('#transcript').textContent, /把这一周/);
  assert.equal(page.query('.branch-chip').hidden, true);
  page.click('[data-preview="周报草稿.md"]');
  assert.match(page.query('.preview-prose').textContent, /本周完成了/);
  page.input('.ta', '这是一份尚未发送的草稿');
  page.click('[data-open="notes"]');
  page.input('.note-editor', '只属于周报的笔记');
  page.session('宋体在 CJK 排版里的字距');
  assert.equal(page.query('.ta').value, '');
  page.session('周报草稿');
  assert.equal(page.query('.ta').value, '这是一份尚未发送的草稿');
  assert.equal(page.query('.note-editor').value, '只属于周报的笔记');
  await page.window.happyDOM.close();
});

test('create a named general conversation, submit text safely and switch back', async () => {
  const page = setup();
  page.click('[title="新建对话"]');
  assert.equal(page.query('#create-dialog').open, true);
  page.input('#new-name', '新的思考');
  page.submit('#create-form');
  assert.equal(page.query('#session-title').textContent, '新的思考');
  assert.match(page.query('.welcome').textContent, /一页空白/);
  page.input('.ta', '<img src=x onerror=alert(1)>');
  page.click('.send');
  assert.equal(page.query('#transcript').querySelectorAll('img').length, 0);
  assert.match(page.query('#transcript').textContent, /<img src=x/);
  page.session('周报草稿');
  page.session('新的思考');
  assert.match(page.query('#transcript').textContent, /<img src=x/);
  await page.window.happyDOM.close();
});

test('close every tool, reopen through picker and preserve terminal state', async () => {
  const page = setup();
  for (let count = 0; count < 3; count++) page.click('[data-action="close-tool"]');
  assert.ok(page.query('.home-grid'));
  page.click('[data-action="tools"]');
  page.click('#popover [data-open="terminal"]');
  assert.match(page.query('.terminal-screen').textContent, /45 passed/);
  await page.window.happyDOM.close();
});

test('compact drawer can be opened and dismissed without losing transcript', async () => {
  const page = setup(900);
  assert.equal(page.query('#app').dataset.inspector, 'off');
  page.click('[data-open="files"]');
  assert.equal(page.query('#app').dataset.inspector, 'on');
  assert.equal(page.query('.scrim').hidden, false);
  page.click('[data-action="dismiss-drawer"]');
  assert.equal(page.query('#app').dataset.inspector, 'off');
  assert.match(page.query('#transcript').textContent, /已改为排队语义/);
  await page.window.happyDOM.close();
});

test('queued drafts stay with their session and can be withdrawn', async () => {
  const page = setup();
  page.click('[data-action="demo"]');
  page.query('#demo-state').value = 'running';
  page.query('#demo-state').dispatchEvent(new page.window.Event('change', { bubbles: true }));
  page.input('.ta', '稍后补一个测试');
  page.click('.send');
  assert.equal(page.query('.queued').hidden, false);
  page.session('周报草稿');
  assert.equal(page.query('.queued').hidden, true);
  page.session('Composer 忙会话队列');
  assert.match(page.query('.queued').textContent, /稍后补一个测试/);
  page.click('[data-action="withdraw"]');
  assert.equal(page.query('.ta').value, '稍后补一个测试');
  await page.window.happyDOM.close();
});

test('continue in a project carries visible context without changing the original scope', async () => {
  const page = setup();
  page.session('周报草稿');
  page.click('[data-open="terminal"]');
  page.click('[data-tool-action="project"]');
  page.submit('#create-form');
  assert.equal(page.query('#scope-label').textContent, 'piwin');
  assert.match(page.query('#transcript').textContent, /本周完成了/);
  assert.equal(page.query('#transcript').querySelector('.welcome'), null);
  page.session('周报草稿');
  assert.equal(page.query('#scope-label').textContent, 'Composition');
  await page.window.happyDOM.close();
});
