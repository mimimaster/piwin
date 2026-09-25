/* Local prototype controller and interaction dispatcher. */
(() => {
  const I = Inkstone;
  const { state, escape, icon, pages, sheets, scenes } = I;
  const phone = document.querySelector('.device > .phone') || document.querySelector('#phone');
  const dialog = document.querySelector('#sheet');
  const device = document.querySelector('#device');
  const savedForms = new Map();
  let currentSheet = '', previousFocus = null, toastTimer;

  function toast(msg) {
    const el = document.querySelector('#toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function positionSheet() {
    const b = device.getBoundingClientRect(), inset = window.innerWidth <= 700 ? 0 : 6;
    dialog.style.setProperty('--dialog-width', `${b.width - inset * 2}px`);
    dialog.style.setProperty('--dialog-left', `${b.left + inset}px`);
    dialog.style.setProperty('--dialog-bottom', `${Math.max(0, window.innerHeight - b.bottom + inset)}px`);
    dialog.style.setProperty('--dialog-max-height', `${Math.max(280, b.height - 76)}px`);
  }

  function paintSheet() {
    const s = sheets[currentSheet];
    if (!s) return;
    document.querySelector('#sheet-content').innerHTML = `<div class="sheet-grab"></div><div class="sheet-head"><h2 id="sheet-title">${s.title}</h2><button class="icon-button" data-action="close-sheet" aria-label="关闭">${icon('close')}</button></div><div class="sheet-body">${s.render()}</div>`;
    const v = savedForms.get(currentSheet);
    if (v) dialog.querySelectorAll('input[name],textarea[name]').forEach((input) => { if (v[input.name] !== undefined) input.value = v[input.name]; });
    positionSheet();
  }

  function openSheet(key) {
    if (!sheets[key]) { toast('演示入口暂未定义'); return; }
    if (!dialog.open) previousFocus = document.activeElement;
    currentSheet = key; paintSheet();
    if (!dialog.open) dialog.showModal();
  }

  function closeSheet() {
    if (dialog.open) dialog.close();
    currentSheet = '';
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  function sceneForRoute() {
    if (state.route === 'chat') return state.sessionId === 'reconnect' ? 2 : 1;
    const map = { sessions: 0, new: 0, activity: 3, tasks: 4, review: 5, workbench: 6, workspace: 6, knowledge: 7, 'wiki-detail': 7, cards: 8, desk: 9, settings: 9, 'settings-detail': 9, connect: 9, library: 9, automations: 9, walkthrough: 5, voice: 10 };
    return map[state.route] ?? 0;
  }

  function render() {
    const scroller = phone.querySelector('.screen-scroll'), scrollPos = scroller?.scrollTop || 0, prevRoute = phone.dataset.route;
    let content = pages[state.route] ? pages[state.route]() : pages.sessions();
    if (state.liveMini && state.route !== 'voice') {
      content = content.replace('</header>', `</header><div class="live-capsule" role="region" aria-label="Live 悬浮小部件"><button class="capsule-body" data-action="expand-live" aria-label="返回全屏 Live"><i class="dot running"></i><span class="capsule-text"><strong>Live · ${state.muted ? '已静音' : '我在听'}</strong><small>${state.muted ? '轻点麦克风开麦' : '“把刚才的恢复方案整理一下…”'}</small></span></button><div class="capsule-controls"><button class="capsule-btn ${state.muted ? 'is-muted' : ''}" data-action="toggle-live-mute" aria-label="${state.muted ? '取消静音' : '静音'}">${icon(state.muted ? 'close' : 'mic')}</button><button class="capsule-btn" data-action="expand-live" aria-label="全屏 Live">${icon('expand')}</button><button class="capsule-btn capsule-hangup" data-action="end-live" aria-label="结束 Live">${icon('close')}</button></div></div>`);
    }
    phone.innerHTML = content;
    phone.dataset.route = state.route;
    if (prevRoute === state.route) phone.querySelector('.screen-scroll')?.scrollTo(0, scrollPos);
    else if (state.route === 'chat') { const s = phone.querySelector('.screen-scroll'); if (s) s.scrollTop = s.scrollHeight; }
    const sceneIdx = Math.max(0, sceneForRoute()), scene = scenes[sceneIdx];
    document.querySelector('#scene-nav').innerHTML = scenes.map(([r, t], i) => `<button class="scene-link ${i === sceneIdx ? 'active' : ''}" data-action="nav-scene" data-value="${r}"><span class="scene-index">${String(i + 1).padStart(2, '0')}</span><span>${t}</span><span class="scene-arrow">↗</span></button>`).join('');
    document.querySelector('#scene-number').textContent = `${String(sceneIdx + 1).padStart(2, '0')} / 11`;
    document.querySelector('#scene-caption').textContent = scene[1];
    document.querySelector('#scene-notes').innerHTML = `<div class="note-rule"></div><div class="eyebrow">DESIGN NOTE / ${String(sceneIdx + 1).padStart(2, '0')}</div><h2>${scene[2]}</h2><p>${scene[3]}</p><div class="note-item"><b>${scene[4]}</b><p>${scene[5]}</p></div><div class="note-item"><b>${scene[6]}</b><p>${scene[7]}</p></div><span class="note-tag">Inkstone 纸墨 · 拇指工学</span><div class="note-bottom">桌面同构 · 离线自包含<br>PROTOTYPE GEMINI INCREMENTAL</div>`;
    document.querySelectorAll('[data-action="theme"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === document.documentElement.dataset.face)));
    if (dialog.open) positionSheet();
  }

  function navigate(route) {
    if (route === 'interrupt') { state.sessionId = 'reconnect'; route = 'chat'; }
    if (!pages[route]) return;
    closeSheet(); state.from[route] = state.route; state.route = route;
    if (location.hash !== `#${route}`) history.pushState(null, '', `#${route}`);
    render();
  }

  function theme(f) {
    document.documentElement.dataset.face = f;
    document.querySelector('meta[name="theme-color"]').content = f === 'ink' ? '#191714' : '#f8f6f0';
    render();
  }

  function online() {
    if (!state.offline) return true;
    toast('处于断线快照模式。草稿保存在本地，连回 Host 后可发送。');
    return false;
  }

  const actions = {
    navigate, sheet: openSheet, 'close-sheet': closeSheet, theme, compact: () => device.classList.toggle('compact'),
    'nav-scene': (t) => { if (t === 'interrupt' || t === 'chat:reconnect') { state.sessionId = 'reconnect'; navigate('chat'); } else if (t.startsWith('chat:')) { state.sessionId = t.split(':')[1]; navigate('chat'); } else navigate(t); },
    'open-session': (id) => { state.sessionId = id; navigate('chat'); },
    'session-menu': (id) => { state.menuSession = id; openSheet('session-menu'); },
    pane: (p) => { state.pane = p; render(); },
    'toggle-project': (n) => { state.collapsed = state.collapsed.includes(n) ? state.collapsed.filter((x) => x !== n) : [...state.collapsed, n]; render(); },
    'new-in-project': (p) => { state.freshProject = p; state.freshTarget = '项目'; navigate('new'); },
    'fresh-target': (t) => { state.freshTarget = t; render(); },
    'choose-project': (p) => { state.freshProject = p; closeSheet(); render(); toast(`已选项目：${p}`); },
    'trust-project': () => { closeSheet(); render(); toast('项目已标记为信任'); },
    'choose-model': (m) => { state.model = m; render(); if (dialog.open) paintSheet(); },
    'choose-thinking': (t) => { state.thinking = t; render(); if (dialog.open) paintSheet(); },
    'choose-run-mode': (m) => { state.runMode = m; render(); if (dialog.open) paintSheet(); },
    'choose-scheme': (s) => { state.scheme = s; render(); if (dialog.open) paintSheet(); },
    scope: (v) => { state.scope = v; render(); if (dialog.open) paintSheet(); },
    permission: (d, btn) => {
      if (!online()) return;
      const allowBtn = btn || document.querySelector('#seal-allow') || document.querySelector('[data-value="approved"]');
      if (allowBtn && d === 'approved') {
        allowBtn.classList.add('stamping');
        setTimeout(() => { allowBtn.classList.remove('stamping'); state.permission = d; closeSheet(); render(); toast(`已落印批准 · ${{ once: '仅本次', session: '本次会话', project: '此项目' }[state.scope]}`); }, 220);
        return;
      }
      state.permission = d; closeSheet(); render(); toast(d === 'approved' ? `已落印批准 · ${{ once: '仅本次', session: '本次会话', project: '此项目' }[state.scope]}` : '已拒绝执行');
    },
    answer: (v) => { if (!v) { state.question = 'dismissed'; render(); toast('已取消问题'); return; } state.question = 'answered'; state.answer = v; render(); toast(`已选择：${v}`); },
    candidate: (c) => { state.candidate = c; render(); toast(c === 'merged' ? '已合入候选变更至主工作树' : '已交还主代理继续处理'); },
    'plan-gate': (c) => { state.freshPlan = c; render(); toast(c === 'agents' ? '已派发至子代理探索' : '已在当前会话执行'); },
    'retry-failure': () => { state.failure = 'retrying'; render(); toast('正在重试…'); setTimeout(() => { state.failure = 'resolved'; render(); }, 1000); },
    toggle: (prop) => { state[prop] = !state[prop]; render(); },
    'toggle-run': () => { state.run = state.run === 'running' ? 'paused' : 'running'; render(); toast(state.run === 'running' ? '已继续运行' : '已暂停运行'); },
    'confirm-stop-run': () => { state.run = 'paused'; closeSheet(); render(); toast('已停止全部运行'); },
    send: () => {
      if (!online()) return;
      const text = state.draft.trim();
      if (!text) { if (state.run === 'running') { state.run = 'paused'; render(); toast('已暂停 Agent 运行'); } else if (state.run === 'paused') { state.run = 'running'; render(); toast('继续运行'); } return; }
      if (state.run === 'running') { state.queue.push({ session: state.sessionId, text, steer: false }); state.draft = ''; render(); toast('已加入发送队列'); return; }
      if (!state.sent[state.sessionId]) state.sent[state.sessionId] = [];
      state.sent[state.sessionId].push(text); state.draft = ''; render(); toast('消息已发送至 Host');
    },
    'edit-queue': (idx) => { const e = state.queue.splice(Number(idx), 1)[0]; if (e) { state.draft = e.text; render(); toast('已取回草稿'); } },
    'steer-queue': (idx) => { if (state.queue[idx]) { state.queue[idx].steer = true; render(); toast('已改为调整任务'); } },
    'cancel-queue': (idx) => { state.queue.splice(Number(idx), 1); render(); toast('已移除排队消息'); },
    'start-session': () => {
      const text = (document.querySelector('#new-prompt')?.value || state.draft).trim() || '新会话';
      const id = `fresh-${Date.now()}`;
      state.created.push({ id, title: text.slice(0, 16), mode: state.freshTarget === '项目' ? 'code' : 'chat', project: state.freshProject, tree: 'main', kind: 'fresh', prompt: text, time: '刚刚' });
      state.sessionId = id; state.draft = ''; navigate('chat'); toast('新会话已开启');
    },
    attach: (n) => { state.attachments.push(n); closeSheet(); render(); toast(`已附加：${n}`); },
    'remove-attachment': (idx) => { state.attachments.splice(Number(idx), 1); render(); },
    'detach-comment': (idx) => { if (state.comments[idx]) state.comments[idx].attached = false; render(); },
    'add-context': (txt) => { state.attachments.push(txt); navigate('chat'); toast('已加入砚台上下文'); },
    prefill: (txt) => { state.draft = txt; render(); },
    'prefill-goal': (txt) => { state.draft = txt; state.goalArmed = true; render(); },
    'disarm-goal': () => { state.goalArmed = false; render(); },
    'stop-goal': () => { state.goal = null; render(); toast('已结束 Goal 模式'); },
    'use-dictation': () => { const t = document.querySelector('#dictation-text')?.value || ''; state.draft = t; closeSheet(); navigate('chat'); toast('语音已转入砚台'); },
    'shrink-live': () => { state.liveMini = true; navigate(state.from['voice'] || 'chat'); toast('已收缩为悬浮小部件 · 可边说边工作'); },
    'expand-live': () => { navigate('voice'); },
    'toggle-live-mute': () => { state.muted = !state.muted; render(); toast(state.muted ? '已静音' : '我在听，你慢慢说'); },
    'end-live': () => { state.liveMini = false; state.handover = true; navigate('chat'); toast('Live 已结束 · 交接卡已放入会话'); },
    'mute-voice': () => { state.muted = !state.muted; render(); },
    'end-voice': () => { state.muted = false; state.liveMini = false; state.handover = true; navigate('chat'); toast('已生成交接卡并返回会话'); },
    'handover-draft': () => { state.draft = '把刚才的恢复方案整理一下，先列计划，不要开始修改。'; state.handover = false; render(); toast('已填入砚台草稿'); },
    'handover-send': () => {
      state.handover = false; if (!state.sent[state.sessionId]) state.sent[state.sessionId] = [];
      state.sent[state.sessionId].push('把刚才的恢复方案整理一下，先列计划，不要开始修改。'); render(); toast('交接指令已送达');
    },
    'open-tool': (t) => { state.tool = t; navigate('workspace'); },
    'open-subagent': (a) => { state.subagent = a; navigate('tasks'); },
    'open-doc': (d) => { state.doc = d; navigate('walkthrough'); },
    'cancel-subagent': (id) => { state.cancelled.push(id); render(); toast(`已取消子代理 ${id}`); },
    'submit-intervene': () => { const txt = document.querySelector('#intervene-input')?.value.trim(); if (txt) { state.queue.push({ session: state.sessionId, text: `[介入] ${txt}`, steer: true }); closeSheet(); render(); toast('介入要求已追加'); } },
    'open-comment': (loc) => { state.commentTarget = loc; openSheet('comment'); },
    'submit-comment': () => {
      const [file, line] = state.commentTarget.split(':'), text = document.querySelector('#comment-input')?.value.trim();
      if (text) { state.comments.push({ id: Date.now(), file, line: Number(line), text, attached: true }); closeSheet(); render(); toast('批注已放入砚台'); }
    },
    'remove-comment': (id) => { state.comments = state.comments.filter((c) => c.id !== Number(id)); render(); },
    'toggle-file': (f) => { state.openFiles = state.openFiles.includes(f) ? state.openFiles.filter((x) => x !== f) : [...state.openFiles, f]; render(); },
    'toggle-seen': (f) => { state.reviewed = state.reviewed.includes(f) ? state.reviewed.filter((x) => x !== f) : [...state.reviewed, f]; render(); },
    'mark-all-reviewed': () => { state.reviewed = ['session-index.ts', 'draft-store.ts', 'session-index.test.ts']; render(); toast('已全部标记看过'); },
    'knowledge-tab': (t) => { state.knowledgeTab = t; render(); },
    'wiki-category': (c) => { state.wikiCategory = c; render(); },
    'open-wiki': (id) => { state.wiki = id; navigate('wiki-detail'); },
    'toggle-mount': (m) => { state.mounts = state.mounts.includes(m) ? state.mounts.filter((x) => x !== m) : [...state.mounts, m]; render(); if (dialog.open) paintSheet(); },
    'flip-card': () => { state.cardFlipped = !state.cardFlipped; render(); },
    'rate-card': (r) => { state.studied += 1; state.cardFlipped = false; render(); toast(`评分「${r}」已同步至 Host`); },
    'next-card': () => { state.browsed += 1; state.cardFlipped = false; render(); },
    'reset-study': () => { state.studied = 0; state.cardFlipped = false; render(); },
    'study-mode': (m) => { state.studyMode = m === '计划复习' ? 'review' : 'browse'; state.cardFlipped = false; render(); },
    'set-study-mode': (m) => { state.studyMode = m; state.cardFlipped = false; navigate('cards'); },
    'submit-produce-cards': () => { closeSheet(); navigate('cards'); toast('已生成 3 张新卡片'); },
    'toggle-pin': (id) => { state.pinned = state.pinned.includes(id) ? state.pinned.filter((x) => x !== id) : [...state.pinned, id]; closeSheet(); render(); },
    'archive-session': (id) => { state.archived.push(id); closeSheet(); navigate('sessions'); toast('会话已归档'); },
    'restore-archive': () => { state.archived = []; render(); toast('已恢复归档会话'); },
    'fork-session': (id) => {
      const src = I.session(id), forkId = `fork-${Date.now()}`;
      state.created.push({ id: forkId, title: `${I.title(id)} · 分支`, mode: src.mode, project: src.project, tree: src.tree, kind: 'forked', from: id, time: '刚刚' });
      state.sessionId = forkId; closeSheet(); navigate('chat'); toast('已开启独立分支');
    },
    'export-session': () => { closeSheet(); toast('已导出会话 Markdown'); },
    'toggle-notify': (k) => { state.notify[k] = !state.notify[k]; paintSheet(); },
    'open-settings': (s) => { state.settingsSection = s; navigate('settings-detail'); },
    'save-demo': (msg) => { closeSheet(); toast(msg || '配置已保存'); },
    disconnect: () => { state.offline = true; closeSheet(); render(); toast('已模拟断线'); },
    reconnect: () => { state.offline = false; closeSheet(); render(); toast('Host 已重新连接'); },
    'pair-demo': () => { state.offline = false; closeSheet(); navigate('sessions'); toast('已接入示例 Host'); },
    'copy-report': () => { toast('报告已复制'); },
    'copy-response': () => { toast('回复已复制'); },
    'dismiss-done': (id) => { state.dismissed.push(id); render(); },
    branch: (delta) => { state.branchIndex = Math.max(1, Math.min(2, state.branchIndex + Number(delta))); render(); },
  };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const act = actions[btn.dataset.action];
    if (act) act(btn.dataset.value || '', btn);
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'composer-input') state.draft = e.target.value; });
  window.addEventListener('resize', positionSheet);
  new ResizeObserver(positionSheet).observe(device);
  window.addEventListener('popstate', () => { closeSheet(); let r = location.hash.slice(1); if (r === 'interrupt') { state.sessionId = 'reconnect'; r = 'chat'; } if (pages[r]) { state.route = r; render(); } });
  let initRoute = location.hash.slice(1);
  if (initRoute === 'interrupt') { state.sessionId = 'reconnect'; initRoute = 'chat'; }
  if (pages[initRoute]) state.route = initRoute;
  const face = new URLSearchParams(location.search).get('face');
  if (face === 'ink') document.documentElement.dataset.face = 'ink';
  render();
})();
