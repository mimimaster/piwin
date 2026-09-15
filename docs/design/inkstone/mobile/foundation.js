/* Shared presentation helpers and deliberately fictional prototype state. */
const Inkstone = (() => {
  const state = {
    route: 'sessions', from: {}, pane: '项目', activityTab: '需要你', knowledgeTab: '维基', wikiCategory: '全部', libraryFilter: '全部', marketTab: '扩展', marketFilter: '全部', reviewFilter: '全部', extensionTab: '技能',
    sessionId: 'memory', menuSession: 'memory', tool: '文件', doc: 'plan', subagent: 'test-runner', wiki: 'host-authority', source: 'docs', settingsSection: '模型配置', scheme: '审阅交付', terminalTab: 'zsh',
    model: 'Claude Sonnet', thinking: '中', runMode: '自动', goalArmed: false, goal: null,
    run: 'running', offline: false, hostName: '书房的 Mac Studio', scope: 'once',
    permission: 'pending', question: 'pending', answer: '', candidate: 'pending', candidateChoice: '', failure: 'failed', freshPlan: 'pending', cancelled: [],
    draft: '', attachments: [], mounts: ['piwin 文档'], queue: [], comments: [], commentTarget: '', reviewed: ['draft-store.ts'], openFiles: ['session-index.ts'],
    sent: {}, created: [], thinkingOpen: false, workOpen: false, branchIndex: 2, handover: false,
    pinned: ['memory', 'hostdoc'], archived: [], titles: {}, collapsed: ['piwin-docs'], dismissed: [], freshTarget: '项目', freshProject: 'piwin',
    cardFlipped: false, studied: 0, browsed: 0, studyMode: 'review', muted: false, liveLines: 2, liveMini: false,
    notify: { approval: true, question: true, failure: true, done: false }, codeWrap: true, visionDelegate: true, embedding: false,
    note: '把每次对话当成一张纸。\n\n状态在页边，内容在中央。\n朱色只留给真正需要我动手的地方。',
  };
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#${name}"></use></svg>`;
  const iconButton = (name, label, action, value = '', extra = '') => `<button class="icon-button ${extra}" data-action="${action}" data-value="${escape(value)}" aria-label="${escape(label)}">${icon(name)}</button>`;
  const dot = (status) => `<i class="dot ${status}" aria-hidden="true"></i>`;
  const pill = (text, tone = '') => `<span class="pill ${tone}">${text}</span>`;
  const row = (name, title, subtitle, action, value = '', trailing = '') => `<button class="list-row" data-action="${action}" data-value="${escape(value)}">${icon(name)}<span class="grow"><strong>${title}</strong>${subtitle ? `<small>${subtitle}</small>` : ''}</span><span class="trailing">${trailing || icon('chevr')}</span></button>`;
  const toggleRow = (title, subtitle, action, checked) => `<button class="list-row" role="switch" aria-checked="${checked}" data-action="${action}"><span class="grow"><strong>${title}</strong>${subtitle ? `<small>${subtitle}</small>` : ''}</span><span class="switch"></span></button>`;
  const header = (title, subtitle = '', back = '', right = '') => `<header class="topbar">${back ? iconButton('chevr', '返回', 'navigate', back, 'back-button') : '<span class="brand-seal">砚</span>'}<div class="topbar-title"><h2>${title}</h2>${subtitle ? `<small>${subtitle}</small>` : ''}</div>${right}</header>`;
  const heading = (title, subtitle = '') => `<div class="screen-heading"><h1>${title.replace('\n', '<br>')}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>`;
  const tabs = (items, selected, action) => `<div class="tabs">${items.map((item) => `<button data-action="${action}" data-value="${item}" class="${selected === item ? 'active' : ''}" aria-pressed="${selected === item}">${item}</button>`).join('')}</div>`;
  const segmented = (items, selected, action, label) => `<div class="segmented" role="group" aria-label="${label}">${items.map(([value, count]) => `<button data-action="${action}" data-value="${value}" aria-pressed="${selected === value}">${value}${count !== undefined ? `<small>${count}</small>` : ''}</button>`).join('')}</div>`;
  const chips = (items, selected, action) => `<div class="chip-row">${items.map(([value, count]) => `<button class="chip" data-action="${action}" data-value="${value}" aria-pressed="${selected === value}">${value}${count !== undefined ? `<small>${count}</small>` : ''}</button>`).join('')}</div>`;
  const fullButton = (title, action, value = '', extra = '') => `<button class="full-button ${extra}" data-action="${action}" data-value="${escape(value)}">${title}</button>`;
  const field = (label, name, value = '', type = 'text') => `<label class="field">${label}<input name="${name}" type="${type}" value="${escape(value)}" autocomplete="off"></label>`;
  const offlineBanner = () => state.offline ? '<div class="banner-offline"><span>连接中断 · 显示 09:38 的快照，草稿仍可写</span><button data-action="reconnect">重新连接</button></div>' : '';

  // Sessions mirror the desktop sidebar: chat-mode conversations and project → worktree → session trees.
  const sessionData = [
    { id: 'memory', title: '让会话拥有记忆', mode: 'code', project: 'piwin', tree: 'main', kind: 'memory', time: '刚刚' },
    { id: 'reconnect', title: '修复移动端重连', mode: 'code', project: 'piwin', tree: 'feat/mobile-reconnect', worktree: true, kind: 'reconnect', time: '26 分钟' },
    { id: 'theme', title: 'Inkstone · 桌面主题', mode: 'code', project: 'piwin', tree: 'main', kind: 'delivered', time: '1 小时', snippet: '走查报告已就绪 · 4 个文件' },
    { id: 'deps', title: '升级 Pi 依赖', mode: 'code', project: 'piwin', tree: 'main', kind: 'error', time: '昨天' },
    { id: 'docsite', title: '文档站换肤', mode: 'code', project: 'piwin-docs', tree: 'main', kind: 'delivered', time: '3 天前', snippet: '已交付 · 6 个文件' },
    { id: 'scratch', title: '润色一封英文邮件', mode: 'chat', kind: 'plain', day: '今天', time: '08:12', snippet: '语气保持礼貌，句子更短' },
    { id: 'hostdoc', title: 'Host 的边界与职责', mode: 'chat', kind: 'plain', day: '昨天', time: '昨天', snippet: '引用 2 处知识库 · piwin 文档' },
    { id: 'reading', title: '周末读书笔记', mode: 'chat', kind: 'plain', day: '更早', time: '周四', snippet: '已记下 5 条便签' },
    { id: 'trip', title: '十月京都行程', mode: 'chat', kind: 'plain', day: '更早', time: '9月8日', snippet: '四天 · 不赶路的版本' },
  ];
  const sessions = () => sessionData.concat(state.created);
  const session = (id) => sessions().find((item) => item.id === id) || sessionData[0];
  const title = (id) => state.titles[id] || session(id).title;
  const status = (id) => {
    const item = session(id);
    if (id === 'memory') return state.run === 'running' ? { dot: 'running', text: state.candidate === 'pending' ? '工作中 · 1 份交付待审阅' : '正在补全恢复路径测试', short: '正在工作' } : state.run === 'paused' ? { dot: 'paused', text: '已暂停 · 等你继续', short: '已暂停', tone: 'tone-lamp' } : { dot: 'done', text: '本轮已完成 · 走查报告就绪', short: '等你的下一笔' };
    if (id === 'reconnect') return state.permission === 'pending' ? { dot: 'waiting', text: '等你批准 1 项操作', short: '等待批准', tone: 'tone-zhu' } : state.question === 'pending' ? { dot: 'waiting', text: 'Agent 在问你 1 个问题', short: '等你回答', tone: 'tone-zhu' } : { dot: 'running', text: state.permission === 'denied' ? '已拒绝测试 · 改用静态检查' : '正在验证重连不重复发送', short: '正在工作' };
    if (id === 'deps') return state.failure === 'failed' ? { dot: 'failed', text: '运行失败 · 供应商限流 429', short: '运行失败', tone: 'tone-crimson' } : { dot: 'running', text: '正在从失败的步骤重试', short: '正在重试' };
    if (item.kind === 'fresh') return state.freshPlan === 'pending' ? { dot: 'waiting', text: '计划已写好 · 选择执行方式', short: '等你选择', tone: 'tone-zhu' } : { dot: 'running', text: state.freshPlan === 'agents' ? '子代理执行中' : '按计划执行中', short: '正在工作' };
    if (item.kind === 'forked') return { dot: 'done', text: `分支 · 源自「${title(item.from)}」`, short: '新的分支' };
    if (state.sent[id]?.length) return { dot: 'running', text: 'Agent 正在回应', short: '正在工作' };
    return { dot: 'done', text: item.snippet || '已完成', short: '已完成' };
  };
  const freshSession = () => state.created.find((item) => item.kind === 'fresh');
  const attention = () => [
    state.permission === 'pending' && { key: 'permission', session: 'reconnect', label: '等待批准' },
    state.question === 'pending' && { key: 'question', session: 'reconnect', label: '等你回答' },
    state.candidate === 'pending' && { key: 'candidate', session: 'memory', label: '交付待审阅' },
    freshSession() && state.freshPlan === 'pending' && { key: 'plan', session: freshSession().id, label: '选择执行方式' },
    state.failure === 'failed' && { key: 'failure', session: 'deps', label: '运行失败' },
  ].filter(Boolean);
  const subagents = () => [
    { id: 'test-runner', mono: '测', role: '测试 · 补全恢复路径', status: state.cancelled.includes('test-runner') ? 'cancelled' : state.run === 'running' ? 'running' : 'paused', line: state.cancelled.includes('test-runner') ? '已取消 · 已完成的测试保留在工作树' : state.run === 'running' ? '运行 session-index.test.ts · 第 3 / 5 步' : '已暂停在第 3 步', time: '1:32', model: 'Claude Sonnet · 低', tree: 'wt/test-runner', steps: [3, 5] },
    { id: 'doc-writer', mono: '文', role: '文档 · 同步恢复说明', status: 'done', line: state.candidate === 'pending' ? '已交付候选变更 · 等你审阅' : state.candidate === 'merged' ? '已合入主工作树' : '已交还主代理处理', time: '2:05', model: 'Claude Haiku', tree: 'wt/doc-writer', steps: [4, 4] },
    { id: 'explorer', mono: '探', role: '探索 · 梳理草稿存储', status: 'done', line: '报告已收回主会话 · 无文件改动', time: '0:48', model: 'Claude Sonnet · 关', tree: '只读 · 不建工作树', steps: [3, 3] },
  ];
  const nav = (selected) => `<nav class="bottom-nav" aria-label="手机主导航">${[['sessions', 'panel', '会话'], ['activity', 'bell', '动态'], ['knowledge', 'book', '知识'], ['desk', 'desk', '案头']].map(([route, name, label]) => { const count = route === 'activity' ? attention().length : 0; return `<button class="${route === selected ? 'active' : ''}" data-action="navigate" data-value="${route}" ${route === selected ? 'aria-current="page"' : ''}>${icon(name)}<span>${label}</span>${count ? `<b class="nav-counter">${count}</b>` : ''}</button>`; }).join('')}</nav>`;
  const back = (route, fallback) => state.from[route] || fallback;

  // [route, caption, heading, lead, note title, note, note title, note]
  const scenes = [
    ['sessions', '会话 · 对话与项目', '一张侧栏，折成两页。', '和桌面侧栏一样分成「对话」与「项目」。没有工作区的闲谈平铺成一叠纸；项目下是工作树与会话的枝干。', '先看正在进行的', '需要你的事收成一条朱色细条；桌面上正在跑的工作只占一张续接卡。列表从第一屏就开始，不再被 Host 卡片和筛选挤到下面。', '改版 · 去掉三组筛选', '旧版的「全部 / 进行中 / 置顶」被分栏取代：置顶是每页的第一组，进行中看状态点，跨会话的待决去「动态」。'],
    ['chat:memory', '对话 · 转录与砚台', '正文居中，过程折起。', '思考、工具链、计划、异步子代理、交付审阅都在转录里就地出现；页面顶端不再挂一排状态胶囊。', '砚台上方一行小签', '计划进度、编排方案与后台任务、知识库挂载、上下文占用收成砚台上方的一行小签。砚台只留 +、模型·思考、权限、语音与发送。', '工作中也能说话', 'Host 正在跑时发送，会先问排队、中断并发送或取消；排好的消息可以编辑，也可以改为「调整当前任务」。'],
    ['chat:reconnect', '批准与提问', '需要你时，砚台让位。', '权限请求出现在砚台的位置，读完就在拇指下落印；Agent 的提问排在其后，选项在上、自定义回答在砚台。', '范围与桌面一致', '仅这一次、本次会话、此项目三档；默认只放行这一次。展开详情可看触发原因与授权对象。', '一条接一条', '同一会话有多条待决时标出「还有 1 条」。批准后的印章留在转录里，回看时知道谁在何时允许了什么。'],
    ['activity', '动态 · 跨会话待决', '只在需要你时，来敲门。', '手机最常做的事，是在别处处理一件卡住的事。所有会话的批准、提问、交付审阅、执行方式与失败汇到这一页。', '分三格', '需要你 / 进行中 / 已完成。卡片可以就地落印或选择，也能一键回到原会话读上下文。', '和通知同一个口径', '推送只发「需要你」里的事件；安静完成的工作留在「已完成」，不打断你。'],
    ['tasks', '子代理与后台任务', '远处的工作，看得见。', '异步子代理在转录里只占一张卡；任务页才展开每个角色的模型、工作树、步骤与交付。', '交付先审阅', '审阅交付方案下，候选变更附带审查项；可以合入，也可以交还主代理处理。并行探索会并排给出候选方案。', '随时介入', '追加要求在子代理当前步骤完成后应用；取消不会丢弃已经完成的工作树内容。'],
    ['review', '变更与审阅', '在掌心，细读一笔。', '文件先给全貌，逐个展开统一差异；看过的打勾，进度在顶部一眼可见。', '批注回到砚台', '行内批注不另存一处，而是作为附件放进砚台，随下一条消息一起交给 Agent。', '检查点', '每一轮文件改动都有检查点。恢复到某一轮之前只撤回文件，对话完整保留。'],
    ['workbench', '工作台', '把右侧面板，摊成一页。', '桌面右侧的侧聊、浏览器、文件、终端、任务、变更，在手机上是一页带摘要的工具目录，每个工具独占一页。', '先看摘要再点开', '每格写着此刻状态：变更行数、运行中的子代理、终端退出码、浏览器地址。', '诚实的边界', '终端展示 Host 输出与后台程序；命令回到对话由 Agent 执行。浏览器可选取元素放进砚台。'],
    ['knowledge', '知识中心', '笔记、文件夹与维基，一处。', '与桌面一样合并为知识中心：维基词条、信源（便签库、维基库与入库文件夹）、闪卡复习三栏。', '挂载到对话', '在砚台 + 里把知识库挂到当前会话；回复里的引用角标可以点开读原文。', '入库状态可读', '可用、入库中、部分失败、找不到文件夹、未配置向量模型——每种状态都给出下一步。'],
    ['cards', '闪卡复习', '把碎片时间，留给理解。', '纸卡、翻面和四档复习反馈。计划复习与随便看看分开；评分按钮上直接写出下次出现的时间。', '浏览与复习', '随便看看只有翻面与下一张；计划复习翻面后才出现评分。', '进度仍属于 Host', '手机与桌面、CLI 读写同一份卡片和学习记录，没有另一套手机调度器。'],
    ['desk', '案头与设置', '自己的工具，自己的主机。', '案头合并了旧版的资料架与设置入口：Host、资料库、扩展与插件、自动化、用量，以及与桌面同构的四组设置。', '设置分组与桌面一致', '应用、Agent、集成、系统四组；外观与这台手机的通知单独提前。', '离线草稿', '断线可读快照、写草稿，不能批准或执行；恢复连接后由你确认发送。'],
    ['voice', 'Live 与随手说', '让一句话，接上思路。', '语音转文字与 Live 分开。先看识别文字，再决定放进砚台；Live 结束后生成一张交接卡回到会话。', '随手说，认真落笔', '转写可以编辑、附图、挂知识库，再发给当前会话。', '收缩为小部件 · 边说边工作', '点击右上角可收缩为悬浮小部件，在浏览项目与对话时保持通话、波形与静音控制。'],
  ];
  return { state, escape, icon, iconButton, dot, pill, row, toggleRow, header, heading, tabs, segmented, chips, fullButton, field, offlineBanner, sessions, session, title, status, attention, subagents, freshSession, nav, back, scenes, pages: {}, sheets: {} };
})();
