/* Shared presentation helpers and deliberately fictional prototype state. */
const Inkstone = (() => {
  const state = {
    route: 'sessions', sessionFilter: '全部', inboxFilter: '待处理', workspaceTab: '文件',
    model: 'Claude Sonnet', effort: '标准', mode: 'Auto', scheme: '单 Agent',
    run: 'running', permission: 'pending', planApproved: false, offline: false,
    draft: '', attachment: '', queue: '', messages: [], currentTitle: '让会话拥有记忆',
    cardFlipped: false, studied: 0, browsed: 0, freshSession: false, studyMode: 'review', reviewDone: false,
    muted: false, libraryFilter: '全部', pinned: false, archived: false,
    notifications: true, handoff: true, comment: '', note: '把每次对话当成一张纸。\n\n状态在页边，内容在中央。\n朱色只留给真正需要我动手的地方。',
    selectedProject: 'piwin', terminalInput: '', settingsSection: '模型配置', search: '',
  };
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#${name}"></use></svg>`;
  const iconButton = (name, label, action, value = '', extra = '') => `<button class="icon-button ${extra}" data-action="${action}" data-value="${escape(value)}" aria-label="${escape(label)}">${icon(name)}</button>`;
  const dot = (status) => `<i class="dot ${status}" aria-hidden="true"></i>`;
  const row = (name, title, subtitle, action, value = '', trailing = '') => `<button class="list-row" data-action="${action}" data-value="${escape(value)}">${icon(name)}<span class="grow"><strong>${title}</strong>${subtitle ? `<small>${subtitle}</small>` : ''}</span><span class="trailing">${trailing || icon('chevr')}</span></button>`;
  const header = (title, subtitle = '', back = '', right = '') => `<header class="topbar">${back ? iconButton('chevr', '返回', 'navigate', back, 'back-button') : '<span class="brand-seal">砚</span>'}<div class="topbar-title"><h2>${title}</h2>${subtitle ? `<small>${subtitle}</small>` : ''}</div>${right}</header>`;
  const nav = (selected) => `<nav class="bottom-nav" aria-label="手机主导航">${[['sessions','panel','会话'],['inbox','bulb','待办'],['shelf','cards','案头']].map(([route, name, title]) => `<button class="${route === selected ? 'active' : ''}" data-action="navigate" data-value="${route}" ${route === selected ? 'aria-current="page"' : ''}>${icon(name)}<span>${title}</span>${route === 'inbox' && ((state.permission === 'pending' ? 1 : 0) + (state.planApproved ? 0 : 1)) > 0 ? `<b class="nav-counter">${(state.permission === 'pending' ? 1 : 0) + (state.planApproved ? 0 : 1)}</b>` : ''}</button>`).join('')}</nav>`;
  const heading = (title, subtitle = '') => `<div class="screen-heading"><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>`;
  const tabs = (items, selected, action) => `<div class="tabs">${items.map((item) => `<button data-action="${action}" data-value="${item}" class="${selected === item ? 'active' : ''}" aria-pressed="${selected === item}">${item}</button>`).join('')}</div>`;
  const fullButton = (title, action, value = '', extra = '') => `<button class="full-button ${extra}" data-action="${action}" data-value="${escape(value)}">${title}</button>`;
  const field = (label, name, value = '', type = 'text') => `<label class="field">${label}<input name="${name}" type="${type}" value="${escape(value)}" autocomplete="off"></label>`;
  const sessionRows = (query = '') => {
    const sessions = [
      [state.currentTitle, state.run === 'running' ? '正在整理会话索引' : '等待继续', state.run === 'running' ? 'running' : 'done', '刚刚'],
      ['Inkstone · 桌面主题', '设计稿已更新 · 4 个文件', 'done', '12 分钟'],
      ['修复移动端重连', state.permission === 'pending' ? '等你批准 1 项操作' : '已处理权限请求', state.permission === 'pending' ? 'waiting' : 'done', '26 分钟'],
      ['Host 的边界与职责', '一份关于架构的讨论', 'background', '昨天'],
    ].filter(([title,,status]) => title.toLowerCase().includes(query.toLowerCase()) && (state.sessionFilter !== '进行中' || status === 'running') && (state.sessionFilter !== '置顶' || title === state.currentTitle));
    if (!sessions.length) return '<div class="empty-state"><h2>这一页还是空的</h2><p>换个关键词，或开始一段新对话。</p></div>';
    return sessions.map(([title, subtitle, status, time]) => `<div class="session-item">${dot(status)}<button class="session-open" data-action="open-session" data-value="${escape(title)}"><strong>${escape(title)}${state.pinned && title === state.currentTitle ? ' · 置顶' : ''}</strong><small>${subtitle}<span>· ${time}</span></small></button>${iconButton('more', `${title}的更多操作`, 'sheet', 'session-menu')}</div>`).join('');
  };
  const scenes = [
    ['sessions','会话与项目','从这里继续','一根墨线，连起桌面与掌心。项目、会话和运行状态都在熟悉的位置。','续接的入口','把桌面上正在进行的工作放在第一张纸条，一次点击就回到同一个会话。','安静的导航','会话、待办、案头三个入口。进入对话后收起主导航，把空间还给正文。'],
    ['chat','对话与砚台','思路，不被打断','批注回到行内，过程折入墨线。底部的砚台始终在拇指够得到的位置。','同一块砚','附件、模型、思考强度、运行模式和语音都有入口。工作中可暂停，也可把下一句话排队。','阅读优先','正文 15–16 px，元数据降噪；不把手机做成缩小的 IDE。'],
    ['inbox','待办与批准','只在需要你时','把等待批准、执行失败和完成交付汇集到一页。先读上下文，再落印。','每次批准都有边界','显示命令、目录和本次作用范围。允许一次是默认值，其他授权另行展开。','建议 · 集中决策','在手机上处理待办后返回原会话；桌面继续执行，不重复启动任务。'],
    ['plan','计划与子代理','远处的工作，看得见','用同一根墨线表达计划步骤、子代理进度和执行依赖。','计划与报告分开','这里是正在执行的结构化计划；交付后的走查报告在独立阅读页。','随时介入','可检视子代理、追加要求、暂停主任务。明确每个动作作用于哪段工作。'],
    ['review','变更与审阅','在掌心，细读一笔','文件清单先给全貌，统一差异给细节。移动审阅不依赖并排窗口。','逐行展开','增删保留符号与行号，长代码横向滚动。点新增行可写一条审阅意见。','建议 · 轻审阅','记录已看过的变更、把意见带回对话。应用、提交和发布始终是不同的动作。'],
    ['workspace','文件与工作区','把检视器，摊成一页','文件、终端输出、浏览器、画布、文档、笔记和侧聊都在会话的工作区里。','按需展开','横向标签切换单个检视器；返回后仍然是刚才的对话。','诚实的能力边界','终端展示 Host 输出快照；远程输入与浏览器控制标为移动端扩展提议。'],
    ['shelf','案头与资料库','把值得留下的，收好','资料、知识卡片、自动化和设置归于案头。工具退后，常用内容在前。','沿用桌面入口','资料库保留图片、视频与收藏；卡片保留浏览和计划复习两种流程。','不另建一套知识中心','保留现有卡片工作台，不把已下线的知识中心重新包装成现成功能。'],
    ['cards','知识卡片','把碎片时间，留给理解','纸卡、翻面和四档复习反馈。手机适合读一张，也适合把今天待复习的过一遍。','浏览与复习','随便看看只有翻面与下一张；计划复习翻面后才出现评分。','进度仍属于 Host','演示的是同一份卡片和学习记录。这里没有另一套手机调度器。'],
    ['settings','设置与连接','自己的工具，自己的主机','继承桌面设置分组，改成一级目录加二级页面。手机外观与 Host 配置区分说明。','纸与墨，同样完整','切换主题会覆盖每个页面、弹层、代码和砚台，而不只换一个背景。','建议 · 离线草稿','断线可阅读快照和写草稿，不能批准或执行；恢复连接后由用户确认发送。'],
    ['voice','语音与随手记','让一句话，接上思路','语音转文字与 Live 分开。先看识别文字，再决定发送或排队。','随手说，认真落笔','语音内容进入砚台，可编辑、附图、指定项目，再发给当前会话。','移动 Live 提议','全屏会话有静音、返回和结束。所有音频与连接状态仅为原型演示。'],
  ];
  return { state, escape, icon, iconButton, dot, row, header, nav, heading, tabs, fullButton, field, sessionRows, scenes, pages: {}, sheets: {} };
})();
