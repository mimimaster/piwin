/* Session and shell presentation only; all changes last until this page reloads. */
(() => {
  const app = document.getElementById('app');
  const transcript = document.getElementById('transcript');
  const composer = document.querySelector('.ta');
  const refs = document.querySelector('.refs');
  const popover = document.getElementById('popover');
  const dialog = document.getElementById('create-dialog');
  const originalTranscript = transcript.innerHTML;
  const sessions = new Map();
  let activeId = 'session-2';
  let toastTimer;
  let createFromGeneral = false;
  let inspector;
  const getSession = () => sessions.get(activeId);
  const sections = [...document.querySelectorAll('.sb-scroll .sec')];
  const escape = (value) => inspector.escape(value);
  const icon = (name) => inspector.icon(name);
  document.querySelectorAll('.sb .row').forEach((row, index) => {
    const id = `session-${index}`;
    const title = row.querySelector('.t').textContent;
    const scope = sections[2].contains(row) ? 'general' : 'project';
    row.dataset.session = id;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', title);
    sessions.set(id, {
      id,
      title,
      scope,
      original: row.classList.contains('cur'),
      project: title === 'Markdown 渲染整理' ? 'openwebui_m' : 'piwin',
      draft: '',
      state: 'idle',
      references: row.classList.contains('cur') ? ['composer-card.tsx', 'AGENTS.md §3.3'] : [],
      messages: [],
      scroll: 0,
      documents: scope === 'general' ? [title === '周报草稿' ? '周报草稿.md' : `${title}.md`] : [],
    });
  });
  function toast(message) {
    const target = document.getElementById('toast');
    target.textContent = message;
    target.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      target.hidden = true;
    }, 3000);
  }
  function popup(html, anchor) {
    popover.innerHTML = html;
    const bounds = anchor.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(innerWidth - 276, bounds.right - 260))}px`;
    popover.showPopover();
    const height = popover.offsetHeight;
    popover.style.top = `${Math.max(8, bounds.bottom + height + 6 <= innerHeight ? bounds.bottom + 6 : bounds.top - height - 6)}px`;
  }
  function layout() {
    const compact = innerWidth <= 1023;
    document.querySelector('.scrim').hidden =
      !compact || (app.dataset.inspector === 'off' && app.dataset.sidebar === 'off');
    document
      .querySelectorAll('[data-action="inspector"]')
      .forEach((button) => button.setAttribute('aria-pressed', app.dataset.inspector === 'on'));
    document
      .querySelectorAll('[data-action="sidebar"]')
      .forEach((button) => button.setAttribute('aria-pressed', app.dataset.sidebar === 'on'));
  }
  function reference(name) {
    if (!getSession().references.includes(name)) getSession().references.push(name);
    renderRefs();
    composer.focus();
    toast('已放入当前会话的消息引用');
    if (innerWidth <= 1023) {
      app.dataset.inspector = 'off';
      layout();
    }
  }
  inspector = createShellInspector({
    app,
    getSession,
    toast,
    popup,
    onReference: reference,
    onOpenProject: () => create('project', true),
    onLayout: layout,
  });
  function renderRefs() {
    refs.innerHTML = getSession()
      .references.map(
        (name, index) =>
          `<button class="ref" data-remove-ref="${index}" title="移除引用 ${escape(name)}">@ ${escape(name)} <span aria-hidden="true"> ×</span></button>`,
      )
      .join('');
    refs.hidden = getSession().references.length === 0;
  }
  function setState(value) {
    getSession().state = value;
    app.dataset.state = value;
    document.querySelectorAll('[data-st]').forEach((element) => {
      element.hidden = !element.dataset.st.split(' ').includes(value);
    });
    document
      .querySelectorAll('[data-set="state"]')
      .forEach((button) => button.classList.toggle('on', button.dataset.v === value));
    app.dataset.draft = composer.value.trim() ? 'on' : 'off';
    document.querySelector('.send').title =
      value === 'running' ? '暂停 / 有草稿时排队' : '发送 (Enter)';
  }
  function generalTranscript(session) {
    const weekly = session.title.includes('周报');
    const leitner = session.title.includes('Leitner');
    const question = weekly
      ? '帮我把这周的设计工作整理成一份简洁的周报。重点说清进展和下一步。'
      : leitner
        ? '帮我梳理一下 Leitner 的复习节奏，写成一份容易执行的备忘。'
        : '宋体放在 CJK 界面里，怎样处理字距和行高，才有安静、舒服的阅读感？';
    const headline = weekly
      ? '把这一周，收成一页。'
      : leitner
        ? '让记忆，有自己的节奏。'
        : '把呼吸，留在字与字之间。';
    session.documentText = weekly
      ? '本周完成了 Inkstone 纸 / 墨两套视觉语言的整理，细化了会话、文件与命令行之间的关系。接下来补齐空态和窄屏交互，收集真实使用反馈。'
      : leitner
        ? '从每天一次的复习开始。答对的卡片进入下一盒，答错的回到第一盒。让短时回顾逐渐拉开间隔，并根据掌握程度调整。'
        : '正文保持自然字距，以 1.7–1.9 的行高形成连续阅读的节奏。宋体用于标题与少量强调，界面操作继续使用清晰的无衬线字体。';
    return `<article class="turn"><div><div class="head"><span class="who">你</span><span>昨天 · 20:16</span></div><div class="ucard">${question}</div></div></article>
      <article class="turn"><div><div class="head"><span class="av">C</span><span>Sonnet 4.6</span><span>20:17</span></div><div class="general-prose"><h2>${headline}</h2><p>${session.documentText}</p><blockquote>${weekly ? '把完成的事情说清楚，给接下来的工作留一点余地。' : leitner ? '每天一点，比偶尔很多更容易持续。' : '不是把字排得更开，而是让阅读的节奏从容一些。'}</blockquote><p>我整理成了一份文稿，可以在右侧展开，也可以继续在这里修改。</p></div><button class="artifact-card" data-preview="${escape(session.documents[0])}">${icon('file')}<span><strong>${escape(session.documents[0])}</strong><small>Markdown · 会话文稿 · 点击预览</small></span><span class="ml">↗</span></button><div class="cap"><i></i>本次对话 · 1 份文稿 · 未绑定项目</div></div></article>`;
  }
  function welcome(session) {
    return `<div class="welcome"><span class="seal">砚</span><span class="eyebrow">${session.scope === 'general' ? 'COMPOSITION / A FRESH PAGE' : 'PROJECT / PIWIN'}</span><h1>${session.scope === 'general' ? '一页空白，<br>从你的想法开始。' : '接着这个项目，<br>往前走一步。'}</h1><p>${session.scope === 'general' ? '写作、研究，或整理一个还没成形的念头。<br>资料和工具会随着这次对话慢慢聚拢。' : '工作目录已选定。描述一个问题，或引用右侧文件开始。'}</p><div class="suggestions"><button data-suggestion="帮我整理今天的工作，写一份周报">整理一份周报</button><button data-suggestion="帮我梳理这个想法，列出值得继续探索的问题">梳理一个想法</button><button data-open="files">浏览资料 ↗</button></div></div>`;
  }
  function renderMessages() {
    for (const message of getSession().messages) {
      transcript.insertAdjacentHTML(
        'beforeend',
        `<article class="turn"><div><div class="head"><span class="who">${message.role === 'user' ? '你' : '原型演示'}</span><span>刚刚</span></div><div class="${message.role === 'user' ? 'ucard' : 'prose'}">${escape(message.text).replace(/\n/g, '<br>')}</div></div></article>`,
      );
    }
  }
  function renderSession() {
    const session = getSession();
    document.getElementById('session-title').textContent = session.title;
    document.getElementById('scope-label').textContent =
      session.scope === 'general' ? 'Composition' : session.project || 'piwin';
    document.querySelector('.branch-chip').hidden = session.scope === 'general';
    document.getElementById('context-label').textContent =
      session.scope === 'general' ? '独立对话' : '项目会话';
    document.getElementById('context-detail').textContent =
      session.scope === 'general' ? '未绑定项目' : `~/Developer/${session.project || 'piwin'}`;
    document.querySelectorAll('[data-session]').forEach((row) => {
      row.classList.toggle('sel', row.dataset.session === activeId);
      row.classList.toggle('cur', row.dataset.session === activeId);
      row.setAttribute('aria-current', row.dataset.session === activeId ? 'true' : 'false');
    });
    transcript.innerHTML = session.original
      ? originalTranscript
      : session.scope === 'general' && !session.empty
        ? generalTranscript(session)
        : session.messages.length
          ? ''
          : welcome(session);
    renderMessages();
    composer.value = session.draft;
    renderRefs();
    setState(session.state);
    inspector.render();
    showQueue();
    transcript.scrollTop = session.scroll;
    document.querySelector('.hint').innerHTML =
      '<span>Enter 发送</span><span>⇧Enter 换行</span><span>运行中 Enter 排队</span>';
  }
  function activate(id) {
    getSession().draft = composer.value;
    getSession().scroll = transcript.scrollTop;
    activeId = id;
    renderSession();
    if (innerWidth <= 1023) {
      app.dataset.sidebar = 'off';
      app.dataset.inspector = 'off';
    }
    layout();
  }
  function create(scope = 'general', continueInProject = false) {
    createFromGeneral = continueInProject;
    document.getElementById('new-scope').value = scope;
    document.getElementById('new-name').value = continueInProject
      ? `${getSession().title} · 项目续聊`
      : '';
    dialog.showModal();
  }
  function demo(anchor) {
    popup(
      `<div class="menu-label">INKSTONE / 00.2</div><div class="demo-row"><span>运行状态</span><select id="demo-state" aria-label="演示状态"><option value="idle">就绪</option><option value="running">运行中</option><option value="waiting">等待批准</option></select></div><div class="demo-row"><span>输入石板</span><span class="seg"><button data-set="slab" data-v="ink" class="${app.dataset.slab === 'ink' ? 'on' : ''}">砚</button><button data-set="slab" data-v="paper" class="${app.dataset.slab === 'paper' ? 'on' : ''}">纸</button></span></div><div class="menu-line"></div><button class="menu-item" data-action="reset-layout">还原布局<small>224 / 360</small></button><p class="demo-copy">试试左侧 Composition 会话、右栏文件和命令行，以及两处「＋」。<br>所有数据仅为本页演示，刷新后还原。</p><a class="menu-item" href="10-shell-workspace-increment.md" target="_blank">本次增量说明 ↗</a>`,
      anchor,
    );
    document.getElementById('demo-state').value = getSession().state;
  }
  function send(intervene = false) {
    const text = composer.value.trim();
    if (!text) {
      if (getSession().state === 'running') {
        setState('idle');
        toast('已暂停（演示）');
      }
      return;
    }
    if (getSession().state === 'running' && !intervene) {
      if (getSession().queued) {
        toast('已有一条排队消息，可先撤回编辑');
        return;
      }
      getSession().queued = text;
      composer.value = '';
      getSession().draft = '';
      app.dataset.draft = 'off';
      toast('已排队，将在本轮结束后发送（演示）');
      showQueue();
      return;
    }
    const session = getSession();
    session.messages.push({ role: 'user', text });
    session.messages.push({
      role: 'assistant',
      text: '这条消息已加入原型会话。真实产品将在这里继续回复；本页不连接模型。',
    });
    session.draft = '';
    session.references = [];
    session.state = 'idle';
    renderSession();
    transcript.scrollTop = transcript.scrollHeight;
  }
  function showQueue() {
    let queue = document.querySelector('.queued');
    if (!queue) {
      queue = document.createElement('div');
      queue.className = 'queued';
      document.querySelector('.dock-in').prepend(queue);
    }
    queue.hidden = !getSession().queued;
    queue.innerHTML = `<span class="qm">已排队 1</span><b>${escape(getSession().queued)}</b><button class="chip ml" data-action="withdraw">撤回</button>`;
  }
  document.getElementById('create-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const scope = document.getElementById('new-scope').value;
    const id = `new-${Date.now()}`;
    const title = document.getElementById('new-name').value.trim() || '新对话';
    sessions.set(id, {
      id,
      title,
      scope,
      project: 'piwin',
      empty: true,
      draft: createFromGeneral ? `继续讨论：${getSession().title}` : '',
      state: 'idle',
      references: [],
      messages: createFromGeneral
        ? [...transcript.querySelectorAll('.turn')].flatMap((turn) => {
            const body = turn.querySelector('.ucard,.general-prose,.prose');
            return body
              ? [
                  {
                    role: body.matches('.ucard') ? 'user' : 'assistant',
                    text: body.textContent.trim(),
                  },
                ]
              : [];
          })
        : [],
      documents: [],
      scroll: 0,
    });
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.session = id;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', title);
    row.innerHTML = `<span class="node"></span><span class="t">${escape(title)}</span><span class="end"><span class="tm">刚刚</span><span class="acts"><button class="ib s20" title="置顶"><svg class="i s12"><use href="#pin" /></svg></button><button class="ib s20" title="归档"><svg class="i s12"><use href="#archive" /></svg></button><button class="ib s20" title="更多"><svg class="i s12"><use href="#more" /></svg></button></span></span>`;
    const targetThread = scope === 'general'
      ? (sections[2].querySelector('.thread') || sections[2])
      : sections[1].querySelector('.thread');
    targetThread.append(row);
    document.getElementById('session-search').value = '';
    document.querySelectorAll('[data-session]').forEach((item) => {
      item.hidden = false;
    });
    if (scope === 'project') {
      const thread = sections[1].querySelector('.thread');
      thread.hidden = false;
      const countEl = thread.previousElementSibling.querySelector('.n');
      if (countEl) {
        countEl.textContent = thread.querySelectorAll('[data-session]').length;
      }
    } else if (scope === 'general') {
      const countEl = sections[2].querySelector('.sec-h .n');
      if (countEl) {
        countEl.textContent = targetThread.querySelectorAll('[data-session]').length;
      }
    }
    dialog.close();
    activate(id);
    composer.focus();
  });
  document.addEventListener('click', (event) => {
    const target = event.target.closest('button,[data-session],.folder,.pc,.work-h');
    if (!target) return;
    if (target.dataset.set) {
      app.dataset[target.dataset.set] = target.dataset.v;
      target.parentElement
        .querySelectorAll('[data-set]')
        .forEach((button) => button.classList.toggle('on', button === target));
      return;
    }
    const opened = target.dataset.open;
    if (opened) {
      popover.hidePopover();
      inspector.open(opened);
      return;
    }
    if (target.dataset.preview) {
      inspector.preview(target.dataset.preview);
      return;
    }
    if (target.dataset.change) {
      inspector.state().selectedChange = target.dataset.change;
      inspector.render();
      return;
    }
    if (target.dataset.toolAction) {
      inspector.handle(target.dataset.toolAction);
      return;
    }
    if (target.dataset.session && target === event.target.closest('[data-session]')) {
      activate(target.dataset.session);
      return;
    }
    if (target.dataset.removeRef) {
      getSession().references.splice(Number(target.dataset.removeRef), 1);
      renderRefs();
      return;
    }
    if (target.dataset.suggestion) {
      composer.value = target.dataset.suggestion;
      getSession().draft = composer.value;
      composer.focus();
      return;
    }
    const action = target.dataset.action;
    if (action === 'demo') return demo(target);
    if (action === 'tools') return inspector.menu(target);
    if (action === 'inspector') {
      app.dataset.inspector = app.dataset.inspector === 'on' ? 'off' : 'on';
      if (innerWidth <= 1023) app.dataset.sidebar = 'off';
      layout();
      return;
    }
    if (action === 'sidebar') {
      app.dataset.sidebar = app.dataset.sidebar === 'on' ? 'off' : 'on';
      if (innerWidth <= 1023) app.dataset.inspector = 'off';
      layout();
      return;
    }
    if (action === 'dismiss-drawer') {
      app.dataset.sidebar = 'off';
      app.dataset.inspector = 'off';
      layout();
      return;
    }
    if (action === 'close-tool') {
      const state = inspector.state();
      const position = state.tabs.indexOf(state.active);
      state.tabs = state.tabs.filter((key) => key !== state.active);
      state.active = state.tabs[Math.max(0, position - 1)] || null;
      inspector.render();
      return;
    }
    if (action === 'widen') {
      setWidth(app.style.getPropertyValue('--inspector') === '560px' ? 360 : 560);
      return;
    }
    if (action === 'reset-layout') {
      app.style.removeProperty('--inspector');
      app.dataset.sidebar = innerWidth <= 1023 ? 'off' : 'on';
      app.dataset.inspector = innerWidth <= 1023 ? 'off' : 'on';
      popover.hidePopover();
      layout();
      return;
    }
    if (action === 'cancel-create') return dialog.close();
    if (action === 'scope')
      return popup(
        `<div class="menu-label">当前范围 · ${getSession().scope === 'general' ? '独立对话' : '项目'}</div><button class="menu-item" data-action="new-general">新建独立对话</button><button class="menu-item" data-action="new-project">在 piwin 中新建会话</button>`,
        target,
      );
    if (action === 'new-general' || action === 'new-project') {
      popover.hidePopover();
      create(action === 'new-general' ? 'general' : 'project');
      return;
    }
    if (action === 'withdraw') {
      composer.value = getSession().queued || '';
      getSession().queued = null;
      document.querySelector('.queued').hidden = true;
      composer.focus();
      return;
    }
    if (target.id === 'allow' || target.id === 'deny') {
      setState(target.id === 'allow' ? 'running' : 'idle');
      toast(target.id === 'allow' ? '已允许一次（演示）' : '已拒绝，保留当前对话（演示）');
      return;
    }
    if (target.classList.contains('send')) return send();
    if (target.classList.contains('work-h')) {
      const work = target.closest('.work');
      const collapsed = work.dataset.collapsed !== 'true';
      work.dataset.collapsed = String(collapsed);
      work.querySelectorAll('.think,.thread').forEach((element) => {
        element.hidden = collapsed;
      });
      return;
    }
    if (target.classList.contains('pc')) return inspector.preview(target.textContent.trim());
    if (target.classList.contains('folder')) {
      const thread = target.nextElementSibling;
      if (thread?.classList.contains('thread')) {
        thread.hidden = !thread.hidden;
        target.querySelector('use').setAttribute('href', thread.hidden ? '#chevr' : '#chevd');
      }
      return;
    }
    const title = target.title;
    if (title.includes('新建')) return create(title.includes('项目') ? 'project' : 'general');
    if (title.includes('搜索')) return document.getElementById('session-search').focus();
    if (target.textContent.trim() === '查看变更') return inspector.open('review');
    if (title.includes('附件'))
      return popup(
        '<div class="menu-label">加入当前消息</div><button class="menu-item" data-open="files">引用会话文件</button><button class="menu-item" data-open="notes">引用笔记</button>',
        target,
      );
    if (title.includes('工作区')) return create('project');
    // Related catalog pages remain available without inventing Host behavior.
    const destinations = {
      资料库: 'proto-06-subpages.html',
      知识卡片: 'proto-06-subpages.html',
      设置: 'proto-05-settings.html',
    };
    if (destinations[target.textContent.trim()]) {
      location.href = destinations[target.textContent.trim()];
      return;
    }
    if (
      target.closest('.bar') ||
      action === 'branch' ||
      title === '会话树' ||
      target.closest('.acts-f') ||
      target.textContent.trim() === '报告'
    )
      toast('本增量展示容器与导航；该功能详见同目录专项原型');
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'demo-state') {
      setState(event.target.value);
      popover.hidePopover();
    }
  });
  composer.addEventListener('input', () => {
    getSession().draft = composer.value;
    app.dataset.draft = composer.value.trim() ? 'on' : 'off';
  });
  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      send(event.metaKey || event.ctrlKey);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      getSession().state === 'waiting' &&
      getSession().original &&
      !dialog.open &&
      !event.target.closest('input,textarea,select,button') &&
      !event.isComposing
    ) {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        document.getElementById(event.key === 'Enter' ? 'allow' : 'deny').click();
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (innerWidth <= 1023) {
        app.dataset.sidebar = 'on';
        app.dataset.inspector = 'off';
        layout();
      }
      document.getElementById('session-search').focus();
    }
    if (['Enter', ' '].includes(event.key) && event.target.matches('[data-session]'))
      event.target.click();
    if (event.key === 'Escape' && !dialog.open && !popover.matches(':popover-open')) {
      app.dataset.inspector = 'off';
      if (innerWidth <= 1023) app.dataset.sidebar = 'off';
      layout();
    }
  });
  document.getElementById('session-search').addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('[data-session]').forEach((row) => {
      row.hidden = !row.textContent.toLowerCase().includes(query);
      if (!row.hidden && query && row.parentElement.classList.contains('thread'))
        row.parentElement.hidden = false;
    });
  });
  const resize = document.querySelector('.resize-handle');
  function setWidth(width) {
    const value = Math.max(
      300,
      Math.min(600, innerWidth - (app.dataset.sidebar === 'on' ? 224 : 0) - 430, width),
    );
    app.style.setProperty('--inspector', `${value}px`);
    resize.setAttribute('aria-valuenow', value);
  }
  resize.addEventListener('pointerdown', (event) => {
    resize.setPointerCapture(event.pointerId);
  });
  resize.addEventListener('pointermove', (event) => {
    if (resize.hasPointerCapture(event.pointerId)) setWidth(innerWidth - event.clientX - 8);
  });
  resize.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      setWidth(
        Number(resize.getAttribute('aria-valuenow')) + (event.key === 'ArrowLeft' ? 20 : -20),
      );
    }
  });
  let wasCompact = innerWidth <= 1023;
  app.dataset.sidebar = wasCompact ? 'off' : 'on';
  if (wasCompact) app.dataset.inspector = 'off';
  addEventListener('resize', () => {
    const compact = innerWidth <= 1023;
    if (compact !== wasCompact) {
      app.dataset.sidebar = compact ? 'off' : 'on';
      app.dataset.inspector = 'off';
      wasCompact = compact;
    }
    layout();
  });
  renderSession();
  layout();
})();
