/* Local prototype controller. No Host calls, permissions, microphones, or private data. */
(() => {
  const { state, escape, icon, row, pages, sheets, scenes } = Inkstone;
  const phone = document.querySelector('#phone');
  const dialog = document.querySelector('#sheet');
  const device = document.querySelector('#device');
  const savedForms = new Map();
  let currentSheet = '';
  let previousFocus = null;
  let toastTimer;

  function toast(message) {
    if (dialog.open) {
      dialog.querySelector('.sheet-feedback')?.remove();
      const feedback = document.createElement('p');
      feedback.className = 'sheet-feedback inline-error';
      feedback.setAttribute('role','status');
      feedback.textContent = message;
      dialog.querySelector('.sheet-body').prepend(feedback);
      return;
    }
    const element = document.querySelector('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
  }

  function positionSheet() {
    const bounds = device.getBoundingClientRect();
    const inset = window.innerWidth <= 700 ? 0 : 6;
    dialog.style.setProperty('--dialog-width', `${bounds.width - inset * 2}px`);
    dialog.style.setProperty('--dialog-left', `${bounds.left + inset}px`);
    dialog.style.setProperty('--dialog-bottom', `${Math.max(0,window.innerHeight - bounds.bottom + inset)}px`);
  }

  function paintSheet() {
    const sheet = sheets[currentSheet];
    if (!sheet) return;
    document.querySelector('#sheet-content').innerHTML = `<div class="sheet-grab"></div><div class="sheet-head"><h2 id="sheet-title">${sheet.title}</h2><button class="icon-button" data-action="close-sheet" aria-label="关闭弹层">${icon('close')}</button></div><div class="sheet-body">${sheet.render()}</div>`;
    const values = savedForms.get(currentSheet);
    if (values) dialog.querySelectorAll('input[name],textarea[name]').forEach((input) => { if (values[input.name] !== undefined) input.value = values[input.name]; });
    positionSheet();
  }

  function openSheet(key) {
    if (!sheets[key]) { toast('这个入口的演示暂未定义'); return; }
    if (!dialog.open) previousFocus = document.activeElement;
    currentSheet = key;
    paintSheet();
    if (!dialog.open) dialog.showModal();
  }

  function closeSheet() {
    if (dialog.open) dialog.close();
    currentSheet = '';
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  function sceneForRoute() {
    const aliases = { new: 'sessions', 'settings-detail': 'settings', connect: 'settings', library: 'shelf', automations: 'shelf', walkthrough: 'review' };
    return scenes.findIndex(([route]) => route === (aliases[state.route] || state.route));
  }

  function render() {
    const scroller = phone.querySelector('.screen-scroll');
    const previousScroll = scroller?.scrollTop || 0;
    const previousRoute = phone.dataset.route;
    phone.innerHTML = pages[state.route]();
    phone.dataset.route = state.route;
    if (previousRoute === state.route) phone.querySelector('.screen-scroll')?.scrollTo(0, previousScroll);
    const sceneIndex = Math.max(0,sceneForRoute());
    const scene = scenes[sceneIndex];
    document.querySelector('#scene-nav').innerHTML = scenes.map(([route,title],index)=>`<button class="scene-link ${index===sceneIndex ? 'active' : ''}" data-action="navigate" data-value="${route}" ${index===sceneIndex ? 'aria-current="page"' : ''}><span class="scene-index">${String(index+1).padStart(2,'0')}</span><span>${title}</span><span class="scene-arrow">↗</span></button>`).join('');
    document.querySelector('#scene-number').textContent = `${String(sceneIndex+1).padStart(2,'0')} / 10`;
    document.querySelector('#scene-caption').textContent = scene[1];
    document.querySelector('#scene-notes').innerHTML = `<div class="note-rule"></div><div class="eyebrow">DESIGN NOTE / ${String(sceneIndex+1).padStart(2,'0')}</div><h2>${scene[2]}</h2><p>${scene[3]}</p><div class="note-item"><b>${scene[4]}</b><p>${scene[5]}</p></div><div class="note-item"><b>${scene[6]}</b><p>${scene[7]}</p></div><span class="note-tag">延续 Inkstone · 为拇指重排</span><div class="note-bottom">纸 / 墨 · 朱 / 灯<br>触控入口 · 独立检视页<br>PROTOTYPE — LOCAL DEMO</div>`;
    document.querySelectorAll('[data-action="theme"]').forEach((button)=>button.setAttribute('aria-pressed',String(button.dataset.value === document.documentElement.dataset.face)));
    if (dialog.open) positionSheet();
  }

  function navigate(route) {
    if (!pages[route]) return;
    closeSheet();
    state.route = route;
    if (location.hash !== `#${route}`) history.pushState(null,'',`#${route}`);
    render();
  }

  function updateSheet() { render(); if (dialog.open) paintSheet(); }
  function theme(face) {
    document.documentElement.dataset.face = face;
    document.querySelector('meta[name="theme-color"]').content = face === 'ink' ? '#191714' : '#f8f6f0';
    render();
  }
  function online() {
    if (!state.offline) return true;
    toast('连接已断开。草稿可继续写，恢复连接后再操作。');
    return false;
  }
  function inputValue(selector) { return document.querySelector(selector)?.value.trim() || ''; }
  function putDraft(text) { state.draft = text; navigate('chat'); toast('已放入砚台，可修改后再发送'); }

  const actions = {
    navigate,
    sheet: openSheet,
    'close-sheet': closeSheet,
    theme,
    'toggle-theme': () => theme(document.documentElement.dataset.face === 'ink' ? 'paper' : 'ink'),
    compact: () => { device.classList.toggle('compact'); },
    'open-session': (title) => { state.currentTitle = title; state.archived = false; state.freshSession = false; navigate('chat'); },
    'session-filter': (filter) => { state.sessionFilter = filter; render(); },
    'inbox-filter': (filter) => { state.inboxFilter = filter; render(); },
    'workspace-tab': (tab) => { state.workspaceTab = tab; render(); phone.querySelector('.screen-scroll')?.scrollTo(0,0); phone.querySelector('.workspace-tabs .active')?.scrollIntoView({block:'nearest',inline:'center'}); },
    'open-workspace': (tab) => { state.workspaceTab = tab; navigate('workspace'); },
    'library-filter': (filter) => { state.libraryFilter = filter; render(); },
    'settings-section': (section) => { state.settingsSection = section; navigate('settings-detail'); },
    'open-settings': (section) => { state.settingsSection = section; navigate('settings-detail'); },
    'choose-model': (model) => { state.model = model; updateSheet(); },
    'choose-effort': (effort) => { state.effort = effort; updateSheet(); },
    'choose-mode': (mode) => { state.mode = mode; updateSheet(); },
    'choose-scheme': (scheme) => { state.scheme = scheme; updateSheet(); },
    'choose-project': (project) => { state.selectedProject = project; closeSheet(); render(); toast(`已选择项目：${project}`); },
    'trust-project': () => { closeSheet(); render(); toast('示例项目已打开，未改变真实项目权限'); },
    attach: (name) => { state.attachment = name; navigate('chat'); toast('已加入示例附件，可随消息发送'); },
    'remove-attachment': () => { state.attachment = ''; render(); },
    'add-context': (text) => { state.attachment = text; navigate('chat'); toast('已加入对话上下文'); },
    command: putDraft,
    prefill: (text) => { state.draft = text; render(); },
    'media-prompt': putDraft,
    'use-dictation': () => { const text = inputValue('#dictation-text'); if (text) putDraft(text); else toast('先留下一句文字'); },
    'terminal-draft': () => { const command = inputValue('[name="terminal-command"]'); if (command) putDraft(`请执行并检查结果：${command}`); else toast('请先输入命令'); },
    send: () => {
      if (!online()) return;
      if (state.run === 'running' && !state.draft.trim()) { state.run = 'paused'; render(); toast('演示已暂停，可以修改要求或继续'); return; }
      if (!state.draft.trim()) {
        if (state.run === 'paused') { state.run = 'running'; render(); toast('演示继续运行'); }
        else toast('先写一句话，再发送');
        return;
      }
      if (state.run === 'running') { state.queue = state.draft; state.draft = ''; render(); toast('已排到当前工作之后'); return; }
      state.messages.push(state.draft + (state.attachment ? ` [${state.attachment}]` : ''));
      state.draft = ''; state.attachment = ''; state.run = 'running';
      render(); phone.querySelector('#chat-scroll')?.scrollTo(0,100000); toast('演示消息已发出，Agent 继续工作');
    },
    'toggle-run': () => { if (!online()) return; state.run = state.run === 'running' ? 'paused' : 'running'; closeSheet(); render(); toast(state.run === 'running' ? '演示继续运行' : '演示工作已暂停'); },
    'edit-queue': () => { state.draft = state.queue; state.queue = ''; render(); toast('已取回砚台，修改后可重新排队'); },
    'cancel-queue': () => { state.queue = ''; render(); toast('已取消这条排队消息'); },
    intervene: () => { if (!online()) return; const text = inputValue('#intervene-input'); if (!text) { toast('先写下追加的要求'); return; } state.queue = text; navigate('chat'); toast('补充要求已进入演示队列'); },
    permission: (choice) => {
      if (!online()) return;
      const scope = inputValue('#permission-scope') || 'once';
      state.permission = choice; closeSheet(); render();
      toast(choice === 'approved' ? `允 · 演示已批准${scope === 'once' ? '本次操作' : scope === 'session' ? '本会话同类操作' : '本项目同类操作'}` : '否 · 演示请求已拒绝');
    },
    'reset-permission': () => { state.permission = 'pending'; render(); },
    'execute-plan': (mode) => { if (!online()) return; state.planApproved = true; state.scheme = mode === 'agents' ? 'Ultra Code' : '单 Agent'; state.run = 'running'; navigate('plan'); toast('演示计划开始执行'); },
    'save-comment': () => { const comment = inputValue('#review-comment'); if (!comment) { toast('先写下你的审阅意见'); return; } state.comment = comment; closeSheet(); render(); toast('批注已保存到当前演示，并关联主会话'); },
    'mark-reviewed': () => { state.reviewDone = !state.reviewDone; render(); toast(state.reviewDone ? '已标记看过 · 未提交或发布代码' : '已取消审阅标记'); },
    'reset-review': () => { state.reviewDone = false; closeSheet(); render(); },
    'save-note': () => { state.note = inputValue('#note-editor'); toast('笔记已保存在当前演示中'); },
    'flip-card': () => { state.cardFlipped = !state.cardFlipped; render(); },
    'rate-card': (rating) => { state.studied += 1; state.cardFlipped = false; render(); toast(`已记录「${rating}」· 演示下一张`); },
    'reset-study': () => { state.studied = 0; state.cardFlipped = false; render(); },
    'next-card': () => { state.browsed = (state.browsed + 1) % 12; state.cardFlipped = false; render(); },
    'study-mode': (mode) => { state.studyMode = mode === '计划复习' ? 'review' : 'browse'; state.cardFlipped = false; render(); },
    'set-study-mode': (mode) => { state.studyMode = mode; state.cardFlipped = false; navigate('cards'); },
    'produce-cards': () => { navigate('cards'); toast('演示生成了 3 张卡片，已进入卡片工作台'); },
    'mute-voice': () => { state.muted = !state.muted; render(); },
    'end-voice': () => { state.muted = false; navigate('chat'); toast('语音演示已结束，对话仍在这里'); },
    'toggle-notifications': () => { state.notifications = !state.notifications; paintSheet(); },
    'toggle-handoff': () => { state.handoff = !state.handoff; paintSheet(); },
    disconnect: () => { state.offline = true; navigate('chat'); toast('正在演示断线状态，可以继续写草稿'); },
    reconnect: () => { state.offline = false; closeSheet(); render(); toast('演示连接已恢复；草稿保留，未自动发送'); },
    'pair-demo': () => { state.offline = false; navigate('sessions'); toast('已连接示例 Host，未访问真实网络'); },
    'manual-connect': () => { if (!inputValue('[name="host-address"]') || !inputValue('[name="pairing-code"]')) { toast('请填写示例地址和配对码'); return; } actions['pair-demo'](); },
    'pin-session': () => { state.pinned = !state.pinned; closeSheet(); render(); toast(state.pinned ? '已置顶示例会话' : '已取消置顶'); },
    'archive-session': () => { state.archived = true; navigate('sessions'); toast('会话已归档，可在设置的归档管理恢复'); },
    'restore-archive': () => { state.archived = false; navigate('sessions'); toast('示例会话已恢复'); },
    'rename-session': () => { const title = inputValue('[name="session-title"]'); if (!title) { toast('名字不能为空'); return; } state.currentTitle = title; closeSheet(); render(); },
    'switch-branch': (title) => { state.currentTitle = title; navigate('chat'); toast('已打开示例分支'); },
    'fork-session': () => { state.currentTitle = `${state.currentTitle} · 分叉`; state.run = 'idle'; navigate('chat'); toast('已在原型中另起一个分支'); },
    'history-jump': () => { navigate('chat'); phone.querySelector('#chat-scroll')?.scrollTo(0,0); toast('已定位到最初的用户消息'); },
    'start-session': () => { if (!online()) return; const text = inputValue('#new-prompt'); if (!text) { toast('先写一句你想做的事'); return; } state.freshSession = true; state.currentTitle = text.slice(0,16); state.messages = [text]; state.draft = ''; state.run = 'running'; navigate('chat'); toast('新的演示会话已开始'); },
    regenerate: () => { if (!online()) return; state.run = 'running'; render(); toast('正在演示重新生成，历史回复仍保留'); },
    'save-demo': (message) => {
      const values = {};
      dialog.querySelectorAll('input[name],textarea[name]').forEach((input)=>{ values[input.name] = input.value; });
      if (currentSheet) savedForms.set(currentSheet,values);
      closeSheet(); toast(message || '已保存当前演示');
    },
    'copy-response': async () => copyText('记忆应该安静地发生。Host 记住会话本身，设备记住你阅读的位置。'),
    'copy-report': async () => copyText('Inkstone 走查报告（原型示例）\n主题色、会话节点、砚台输入区与权限印章已统一。'),
    'export-session': () => {
      const blob = new Blob([`# ${state.currentTitle}\n\nInkstone 移动端原型 · 示例数据\n\n${state.messages.join('\n\n')}`],{type:'text/markdown;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'inkstone-demo-session.md'; link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000); closeSheet(); toast('已导出演示会话');
    },
    'extension-tab': (tab) => openSheet(({技能:'skills',MCP:'mcp',扩展:'extension-install',提示词:'prompt-template',插件:'extension-install'})[tab]),
  };

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('示例内容已复制'); }
    catch (error) { console.warn('Prototype clipboard unavailable:', error.name); toast('浏览器未允许复制，可直接选择正文复制'); }
  }

  document.addEventListener('click', async (event) => {
    const control = event.target.closest('[data-action]');
    if (!control || control.disabled) return;
    const action = actions[control.dataset.action];
    if (action) await action(control.dataset.value || '');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('[role="button"][data-action]')) { event.preventDefault(); event.target.click(); }
  });
  document.addEventListener('input', (event) => {
    if (event.target.id === 'composer-input' || event.target.id === 'new-prompt') {
      state.draft = event.target.value;
      const send = phone.querySelector('[data-action="send"]');
      if (send) { const pause = state.run === 'running' && !state.draft; send.innerHTML = icon(pause ? 'pause' : 'up'); send.classList.toggle('pause',pause); send.setAttribute('aria-label',pause ? '暂停运行' : state.run === 'running' ? '排队发送' : '发送消息'); }
    }
    if (event.target.id === 'session-search') document.querySelector('#sheet-search-results').innerHTML = Inkstone.sessionRows(event.target.value);
    if (event.target.id === 'settings-search') {
      const matches = Inkstone.settingsGroups.flatMap(([,items])=>items).filter((title)=>title.toLowerCase().includes(event.target.value.toLowerCase()));
      document.querySelector('#settings-results').innerHTML = matches.length ? matches.map((title)=>row('sliders',title,'','settings-section',title)).join('') : '<div class="empty-state"><p>没有找到这项设置。</p></div>';
    }
  });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientY < bounds.top || event.clientX < bounds.left || event.clientX > bounds.right) closeSheet(); } });
  dialog.addEventListener('close', () => { currentSheet = ''; });
  window.addEventListener('resize', positionSheet);
  new ResizeObserver(positionSheet).observe(device);
  window.addEventListener('popstate',()=>{ closeSheet(); const route=location.hash.slice(1); state.route=pages[route] ? route : 'sessions'; render(); });
  const route = location.hash.slice(1);
  if (pages[route]) state.route = route;
  const face = new URLSearchParams(location.search).get('face');
  if (face === 'ink') document.documentElement.dataset.face = 'ink';
  render();
})();
