/* Offline fixture views. No Host calls, filesystem writes, or real commands. */
function createShellInspector(options) {
  const { app, getSession, toast, popup, onReference, onOpenProject } = options;
  const content = document.getElementById('tool-content');
  const tabList = document.getElementById('tool-tabs');
  const labels = {
    files: '文件',
    terminal: '命令行',
    review: '变更',
    browser: '浏览器',
    notes: '笔记',
  };
  const icons = { files: 'file', terminal: 'term', review: 'git', browser: 'globe', notes: 'file' };
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const icon = (name) => `<svg class="i s14" aria-hidden="true"><use href="#${name}"/></svg>`;
  const projectSources = {
    'composer-card.tsx':
      "import { useState } from 'react';\n\nexport function ComposerCard() {\n  const [draft, setDraft] = useState('');\n\n  function handleKeyDown(event) {\n    if (event.isComposing) return;\n    if (event.key === 'Enter') {\n      event.preventDefault();\n      return event.metaKey\n        ? triggerSteer()\n        : triggerSend();\n    }\n  }\n\n  return <Composer draft={draft} />;\n}",
    'composer-run-actions.tsx':
      "export function resolveRunAction({\n  streaming, draft, paused,\n}) {\n  if (streaming) {\n    if (draft.trim()) {\n      return { kind: 'queue' };\n    }\n    return { kind: 'pause' };\n  }\n  if (paused && !draft.trim()) {\n    return { kind: 'continue' };\n  }\n  return { kind: 'send' };\n}",
    'composer-dock.test.tsx':
      "describe('composer keyboard', () => {\n  it('queues Enter while streaming', () => {\n    expect(resolveAction('Enter'))\n      .toEqual('queue');\n  });\n\n  it('steers Command+Enter', () => {\n    expect(resolveAction('Meta+Enter'))\n      .toEqual('steer');\n  });\n});",
    'AGENTS.md':
      '# Project rules\n\nKeep changes focused.\nReuse public package boundaries.\nVerify behavior before delivery.',
    'package.json':
      '{\n  "name": "piwin",\n  "private": true,\n  "scripts": {\n    "typecheck": "pnpm -r typecheck"\n  }\n}',
  };
  function state() {
    const session = getSession();
    if (!session.tools)
      session.tools = {
        tabs: session.scope === 'project' ? ['files', 'terminal', 'review'] : ['files', 'notes'],
        active: session.scope === 'project' && session.original ? 'review' : 'files',
        preview: null,
        selectedChange: 'composer-run-actions.tsx',
        terminals:
          session.scope === 'project'
            ? [
                {
                  id: 1,
                  log: 'piwin · main\n\n❯ pnpm vitest composer-dock\n\n ✓ composer-dock.test.tsx (45 tests)\n\n Test Files  1 passed (1)\n      Tests  45 passed (45)\n   Duration  6.2s\n',
                },
              ]
            : [],
        terminalId: 1,
        nextTerminal: 2,
        note: '',
      };
    return session.tools;
  }
  function blank(title, description, action, label, symbol = 'file') {
    return `<div class="blank-tool">${icon(symbol)}<h3>${title}</h3><p>${description}</p>${action ? `<button class="primary" data-tool-action="${action}">${label}</button>` : ''}</div>`;
  }
  function fileButton(name, changed = '') {
    return `<button class="tree-file" data-preview="${escape(name)}">${icon('file')}<span>${escape(name)}</span>${changed ? `<span class="modified">${changed}</span>` : ''}</button>`;
  }
  function renderFiles() {
    const session = getSession();
    if (state().preview) return renderPreview(state().preview);
    if (session.scope === 'general') {
      const documents = session.documents || [];
      return (
        `<div class="tool-toolbar"><strong>会话资料</strong><span class="ml">${documents.length} 份</span><button class="ib" data-tool-action="new-note" aria-label="新增会话笔记">${icon('plus')}</button></div>` +
        (documents.length
          ? `<div class="tree">${documents.map((name) => fileButton(name)).join('')}<p class="file-note">本次对话引用的资料与生成的文稿。<br>点击查看，或引用到下一条消息。</p></div>`
          : blank(
              '资料会在这里聚拢',
              '引用的资料、生成的文稿，都会跟着这次对话留在这里。',
              'new-note',
              '写一份笔记',
            ))
      );
    }
    return `<div class="tool-toolbar">${icon('folder')}<strong>${escape(session.project || 'piwin')}</strong><span class="ml">工作目录</span><button class="ib" data-tool-action="refresh" aria-label="刷新文件">${icon('refresh')}</button></div>
      <label class="tool-search">${icon('search')}<input aria-label="筛选文件" id="file-filter" placeholder="按文件名筛选…"></label>
      <div class="tree"><details open><summary>apps / desktop / src</summary>
      ${fileButton('composer-card.tsx')}${fileButton('composer-run-actions.tsx', 'M')}${fileButton('composer-dock.test.tsx', 'M')}</details>
      <details><summary>packages</summary><details><summary>contracts</summary>${fileButton('index.ts')}</details></details>
      ${fileButton('AGENTS.md')}${fileButton('package.json')}<p class="file-note">单击预览文件 · 预览内可引用给 Agent<br>文件树保留在同一栏，返回即可继续浏览。</p><p id="file-no-results" hidden>没有匹配的文件</p></div>`;
  }
  function renderPreview(name) {
    const isCode = /\.(tsx?|json)$/.test(name);
    const text =
      projectSources[name] ||
      "// Public exports\nexport type { SessionScope } from './session.js';";
    const prose =
      getSession().documentText ||
      '本周继续推进 Inkstone 工作台：收紧界面层级，让文件与工具自然地跟随对话。下一步，在真实任务中验证阅读与操作的节奏。';
    return `<div class="tool-toolbar"><button class="chip" data-tool-action="back-files">← 资料</button><strong>${escape(name)}</strong><span class="ml">只读</span></div>
      ${
        isCode
          ? `<pre class="source-view"><code>${text
              .split('\n')
              .map(
                (line, index) =>
                  `<span class="c">${String(index + 1).padStart(2)}  </span>${escape(line)}`,
              )
              .join('\n')}</code></pre>`
          : `<div class="preview-title"><span class="eyebrow">DOCUMENT / ${getSession().scope === 'project' ? 'PROJECT' : 'COMPOSITION'}</span><p>当前会话 · Markdown</p></div><div class="preview-prose"><h3>${escape(name.replace('.md', ''))}</h3><p>${escape(prose)}</p><blockquote>留出呼吸的空间，让内容成为主角。</blockquote><h3>接下来</h3><p>收集反馈，补齐细节，再回到这份草稿继续。</p></div>`
      }
      <div class="panel-actions"><button class="primary" data-tool-action="reference">引用到消息 ↗</button><button class="secondary" data-tool-action="copy-path">复制${getSession().scope === 'general' ? '名称' : '路径'}</button></div>`;
  }
  function renderTerminal() {
    if (getSession().scope !== 'project')
      return blank(
        '为命令行选择项目',
        '这是一段独立对话。进入项目继续后，命令行会使用该项目的工作目录。',
        'project',
        '在项目中继续…',
        'term',
      );
    const current = state().terminals.find((terminal) => terminal.id === state().terminalId);
    if (!current)
      return blank(
        '一个安静的终端',
        '为当前项目打开一个命令行。最多同时保留 4 个。',
        'add-terminal',
        '新建终端',
        'term',
      );
    return `<div class="terminal-tabs"><select id="terminal-select" aria-label="当前终端">${state()
      .terminals.map(
        (terminal) =>
          `<option value="${terminal.id}" ${terminal.id === current.id ? 'selected' : ''}>zsh ${terminal.id} · ${terminal.id === 1 ? '测试' : '交互'}</option>`,
      )
      .join(
        '',
      )}</select><button class="ib" data-tool-action="add-terminal" aria-label="新建终端" ${state().terminals.length >= 4 ? 'disabled' : ''}>${icon('plus')}</button><button class="ib" data-tool-action="close-terminal" aria-label="关闭当前终端">${icon('close')}</button></div>
      <div class="tool-toolbar">${icon('folder')}<strong>~/Developer/${escape(getSession().project || 'piwin')}</strong><button class="ib ml" data-tool-action="restart-terminal" title="重启当前终端" aria-label="重启当前终端">${icon('refresh')}</button></div>
      <div class="terminal-screen"><pre>${escape(current.log)}</pre><form id="terminal-form" class="terminal-input"><span>❯</span><input aria-label="终端命令" placeholder="输入 pwd 或 pnpm test" autocomplete="off" spellcheck="false"></form></div><div class="terminal-status"><span class="plus">●</span> zsh · ${state().terminals.length}/4 个终端<br>原型演示：命令仅模拟输出，不会在本机执行。</div>`;
  }
  function renderReview() {
    const session = getSession();
    if (session.scope !== 'project')
      return blank(
        '这里还没有项目变更',
        '独立对话的文稿在「文件」中。代码变更会在项目会话里展示。',
        'files',
        '查看会话资料',
        'git',
      );
    if (!session.original)
      return blank(
        '工作从这里开始',
        '这个会话还没有代码变更。修改文件后，可以在这里查看差异。',
        'files',
        '浏览项目文件',
        'git',
      );
    const selected = state().selectedChange;
    return `<div class="review-summary"><h3>本次修改 <span class="n">2 个文件</span></h3><p><span class="plus">+79</span> <span class="minus">−12</span><span class="ml">未暂存</span></p></div>
      <div class="chg"><div class="sec-h">未暂存 <span class="n">2</span></div>${['composer-run-actions.tsx', 'composer-dock.test.tsx'].map((name) => `<button class="file ${name === selected ? 'on' : ''}" data-change="${name}"><span class="m">M</span>${name}<span class="pm plus">+${name.includes('test') ? '31' : '48'}</span></button>`).join('')}</div>
      <div class="diff"><div class="dh">${selected}<span class="r">@@ ${selected.includes('test') ? '42,4' : '85,7'} @@</span></div>${(selected.includes('test') ? [" describe('composer', () => {", "+  it('queues Enter', () => {", "+    expect(action.kind).toBe('queue');", '+  });', ' });'] : [' if (streaming) {', "-  return { kind: 'pause' }", '+  if (draft.trim())', "+    return { kind: 'queue' }", "+  return { kind: 'pause' }", ' }']).map((line, index) => `<div class="dl ${line[0] === '+' ? 'a' : line[0] === '-' ? 'd' : ''}"><span class="ln">${(selected.includes('test') ? 42 : 85) + index}</span>${escape(line)}</div>`).join('')}</div>
      <div class="panel-actions"><button class="secondary" data-tool-action="review-source">查看完整文件</button><button class="secondary" data-tool-action="review-reference">引用变更 ↗</button></div>`;
  }
  function render() {
    const current = state();
    tabList.innerHTML = current.tabs
      .map(
        (key) =>
          `<button class="tab ${key === current.active ? 'on' : ''}" role="tab" aria-selected="${key === current.active}" data-open="${key}" aria-label="${labels[key]}">${icon(icons[key])}<span class="tab-label">${labels[key]}</span></button>`,
      )
      .join('');
    document.getElementById('tool-scope').textContent = '本次会话';
    document.getElementById('tool-scope').title = getSession().title;
    document.getElementById('tool-footnote').textContent =
      getSession().scope === 'project'
        ? `项目 · ${getSession().project || 'piwin'}`
        : '独立对话 · 会话资料';
    content.setAttribute('aria-label', labels[current.active] || '工具启动器');
    if (!current.active)
      content.innerHTML = `<div class="blank-tool"><span class="eyebrow">YOUR WORKSPACE</span><h3>为这次对话添一件工具</h3><div class="home-grid">${Object.keys(
        labels,
      )
        .map((key) => `<button data-open="${key}">${icon(icons[key])}${labels[key]}</button>`)
        .join('')}</div></div>`;
    else if (current.active === 'files') content.innerHTML = renderFiles();
    else if (current.active === 'terminal') content.innerHTML = renderTerminal();
    else if (current.active === 'review') content.innerHTML = renderReview();
    else if (current.active === 'notes')
      content.innerHTML = `<div class="tool-toolbar"><strong>随手记</strong><span class="ml">随会话保留</span></div><textarea class="note-editor" aria-label="会话笔记" placeholder="留下一个想法，一条待办…">${escape(current.note)}</textarea><div class="panel-actions"><button class="primary" data-tool-action="reference-note">引用到消息 ↗</button><span class="eyebrow">本页暂存</span></div>`;
    else
      content.innerHTML = `<div class="browser-address">预览 · inkstone.local / welcome</div><div class="mini-page"><span class="eyebrow">PIWIN / INKSTONE</span><h2>让想法<br>安静生长。</h2><p>会话在中间，工具在手边。<br>纸、墨与一点朱砂。</p></div><div class="terminal-status">本地设计示例 · 不连接外部网站</div><div class="panel-actions"><button class="secondary" data-tool-action="browser-reference">引用页面 ↗</button></div>`;
  }
  function open(key) {
    if (!(key in labels)) return;
    const current = state();
    if (!current.tabs.includes(key)) current.tabs.push(key);
    current.active = key;
    app.dataset.inspector = 'on';
    if (innerWidth <= 1023) app.dataset.sidebar = 'off';
    render();
    options.onLayout();
  }
  function preview(name) {
    state().preview = name;
    open('files');
  }
  function menu(anchor) {
    popup(
      `<div class="menu-label">添加到当前会话</div>${Object.keys(labels)
        .map(
          (key) =>
            `<button class="menu-item" data-open="${key}">${icon(icons[key])}${labels[key]}<small>${state().tabs.includes(key) ? '已打开' : '+'}</small></button>`,
        )
        .join(
          '',
        )}<div class="menu-line"></div><p class="demo-copy">工具可以关闭；再次打开时恢复。切换会话，会回到各自的工具与资料。</p>`,
      anchor,
    );
  }
  function handle(action) {
    const current = state();
    if (action === 'back-files') {
      current.preview = null;
      open('files');
    } else if (action === 'files') {
      current.preview = null;
      open('files');
    } else if (action === 'reference') onReference(current.preview);
    else if (action === 'review-source') preview(current.selectedChange);
    else if (action === 'review-reference') onReference(`变更 · ${current.selectedChange}`);
    else if (action === 'browser-reference') onReference('页面 · Inkstone welcome');
    else if (action === 'reference-note') {
      if (current.note.trim()) onReference(`笔记 · ${current.note.slice(0, 60)}`);
      else toast('先写下一点内容');
    } else if (action === 'new-note') open('notes');
    else if (action === 'project') onOpenProject();
    else if (action === 'refresh') toast('文件列表已刷新（演示）');
    else if (action === 'copy-path') {
      const path =
        getSession().scope === 'project'
          ? `~/Developer/${getSession().project || 'piwin'}/${current.preview?.endsWith('.tsx') ? 'apps/desktop/src/' : ''}${current.preview}`
          : current.preview;
      navigator.clipboard.writeText(path).then(
        () => toast('已复制'),
        () => toast('浏览器未开放剪贴板，请手动复制文件名'),
      );
    } else if (action === 'add-terminal') {
      if (current.terminals.length >= 4) return toast('最多同时打开 4 个终端');
      const terminal = { id: current.nextTerminal++, log: '新终端已就绪（演示）\n' };
      current.terminals.push(terminal);
      current.terminalId = terminal.id;
      render();
    } else if (action === 'close-terminal') {
      current.terminals = current.terminals.filter(
        (terminal) => terminal.id !== current.terminalId,
      );
      current.terminalId = current.terminals[0]?.id;
      render();
    } else if (action === 'restart-terminal') {
      const terminal = current.terminals.find((item) => item.id === current.terminalId);
      if (terminal) terminal.log = '终端已重新启动（演示）\n';
      render();
    }
  }
  content.addEventListener('input', (event) => {
    if (event.target.matches('.note-editor')) state().note = event.target.value;
    if (event.target.id === 'file-filter') {
      const query = event.target.value.toLowerCase();
      let matches = 0;
      content.querySelectorAll('.tree-file').forEach((file) => {
        file.hidden = !file.textContent.toLowerCase().includes(query);
        if (!file.hidden) matches++;
      });
      if (query)
        content.querySelectorAll('details').forEach((folder) => {
          folder.open = true;
        });
      document.getElementById('file-no-results').hidden = matches !== 0;
    }
  });
  content.addEventListener('change', (event) => {
    if (event.target.id === 'terminal-select') {
      state().terminalId = Number(event.target.value);
      render();
    }
  });
  content.addEventListener('submit', (event) => {
    if (event.target.id !== 'terminal-form') return;
    event.preventDefault();
    const input = event.target.querySelector('input');
    const command = input.value.trim();
    if (!command) return;
    const terminal = state().terminals.find((item) => item.id === state().terminalId);
    const result =
      command === 'pwd'
        ? `/Users/you/Developer/${getSession().project || 'piwin'}`
        : command === 'pnpm test'
          ? '✓ 45 tests passed · fixture output'
          : '此原型支持 pwd / pnpm test 演示，不执行真实命令。';
    if (terminal) terminal.log += `\n❯ ${command}\n${result}\n`;
    render();
    content.querySelector('.terminal-screen')?.scrollTo(0, 100000);
    content.querySelector('.terminal-input input')?.focus();
  });
  return { render, open, preview, menu, handle, state, escape, icon };
}
