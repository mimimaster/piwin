/* Knowledge center, flashcard spaced repetition, and live voice surfaces. */
(() => {
  const I = Inkstone;
  const { state, escape, icon, iconButton, dot, pill, row, header, heading, tabs, chips, fullButton, pages } = I;

  const wikiEntries = [
    { id: 'host-authority', cat: '架构', title: 'Host 唯一权威', date: '09.12', text: '状态与执行只归 Host。桌面、手机和 CLI 皆为无状态窗口，正文共享但阅读位置独立。', tags: ['架构', '核心'] },
    { id: 'session-boundary', cat: '架构', title: '会话恢复边界', date: '09.10', text: '断线恢复时，优先保证设备草稿不丢，随后同步 Host 最新会话树，绝不重发旧命令。', tags: ['架构', '恢复'] },
    { id: 'fsrs-study', cat: '策略', title: 'FSRS 闪卡调度', date: '09.08', text: '四档遗忘曲线算法在 Host 执行。手机只负责呈现正反面并回传评分，不自建调度器。', tags: ['策略', '卡片'] },
    { id: 'artifact-sandbox', cat: '交互', title: 'Artifact 安全沙箱', date: '09.04', text: '生成式 HTML 严格置于沙箱 iframe 与 CSP 约束下，外部静态资源默认阻断。', tags: ['交互', '安全'] },
  ];

  const wikiContent = {
    'host-authority': '<h3>Host 为什么是唯一权威？</h3><p>在 piwin 架构中，所有模型上下文、工具调用与会话历史都持久化在私有 Host 上。<button class="wikilink" data-action="open-wiki" data-value="session-boundary">会话恢复边界</button>指明设备只保留本地阅读刻度。</p><p>这保证了不论从桌面、手机或 CLI 接入，面对的都是同一份真实进度。</p>',
    'session-boundary': '<h3>会话恢复边界</h3><p>设备在弱网或断线状态下仍可输入草稿。重连后，客户端以幂等键向 Host 探活，先还原纸面，再由用户确认发出草稿。</p>',
    'fsrs-study': '<h3>FSRS 算法集成</h3><p>基于 Free Spaced Repetition Scheduler，每次评分（重来、较难、记得、轻松）实时预估下次复习间隔，并在 Host 上更新卡片记忆矩阵。</p>',
    'artifact-sandbox': '<h3>Artifact 沙箱隔离</h3><p>所有生成的网页、图表和交互卡片均运行在无特权子域。防止未受信模型输出注入脚本或泄露本地凭据。</p>',
  };

  pages.knowledge = () => {
    const cats = [['全部', wikiEntries.length], ['架构', 2], ['交互', 1], ['策略', 1]];
    const filtered = state.wikiCategory === '全部' ? wikiEntries : wikiEntries.filter((w) => w.cat === state.wikiCategory);
    const wikiPane = `${chips(cats, state.wikiCategory, 'wiki-category')}<div class="wiki-list">${filtered.map((item) => `<button class="wiki-row" data-action="open-wiki" data-value="${item.id}"><strong>${escape(item.title)}</strong><p>${escape(item.text)}</p><small>${item.cat} · ${item.date} · 引用 2 次</small></button>`).join('')}</div><div class="section-label">知识操作</div>${row('book', '从当前项目出卡', '选取 docs/ 目录生成闪卡', 'sheet', 'produce-cards')}${row('plus', '录入新维基条目', '将提炼的结论沉淀为词条', 'sheet', 'wiki-new')}`;
    const sources = [
      { name: '便签库', count: '14 条便签', st: '可用', dot: 'done', hint: '随手记与侧聊结论汇总' },
      { name: '维基库', count: '8 篇词条', st: '可用', dot: 'done', hint: '已建立向量索引' },
      { name: 'piwin 文档', count: '42 个文件', st: '已挂载', dot: 'done', hint: '~/Developer/piwin/docs' },
      { name: '本地参考库', count: '128 个文件', st: '入库中 64%', dot: 'running', hint: '嵌入向量构建中' },
    ];
    const sourcePane = `<div class="notice">${icon('alert')}<b>信源状态</b><span>所有文档均由 Host 构建向量索引，手机本地不跑解析。</span></div>${sources.map((s) => row('folder', s.name, `${s.count} · ${s.hint}`, 'sheet', 'source-detail', pill(`${dot(s.dot)}${s.st}`, s.dot === 'running' ? 'lamp' : 'pine'))).join('')}<div class="section-label">挂载与同步</div>${fullButton('管理当前会话挂载', 'sheet', 'mounts')}${fullButton('添加外部文件夹', 'sheet', 'workspace-picker', 'secondary')}`;
    const cardPane = `<div class="continue-card"><div class="spread"><span class="eyebrow">今日待复习</span>${pill(`${dot('running')}待过 12 张`)}</div><h3>碎片时间，加深记忆</h3><p>基于 Host 上的 FSRS 记忆曲线调度，同步桌面与手机学习进度。</p><div class="button-row">${fullButton('开始计划复习', 'navigate', 'cards')}${fullButton('随便看看', 'set-study-mode', 'browse', 'secondary')}</div></div><div class="section-label">最近掌握</div>${row('cards', 'Host 为什么是唯一权威？', '已掌握 · 下次复习 7 天后', 'navigate', 'cards')}${row('cards', '会话恢复幂等机制', '良好 · 下次复习 3 天后', 'navigate', 'cards')}`;
    const content = state.knowledgeTab === '维基' ? wikiPane : state.knowledgeTab === '信源' ? sourcePane : cardPane;
    return `${header('知识中心', '维基、信源与闪卡', 'sessions', iconButton('search', '搜索知识库', 'sheet', 'knowledge-search'))}${I.offlineBanner()}<div class="screen-scroll">${heading('留下的，皆成学问。', '在 Host 沉淀，随时在拇指下查阅')}${tabs(['维基', '信源', '闪卡'], state.knowledgeTab, 'knowledge-tab')}${content}</div>${I.nav('knowledge')}`;
  };

  pages['wiki-detail'] = () => {
    const entry = wikiEntries.find((e) => e.id === state.wiki) || wikiEntries[0];
    return `${header(escape(entry.title), `${entry.cat} · 词条`, 'knowledge', iconButton('more', '操作', 'sheet', 'wiki-menu'))}<div class="screen-scroll"><div class="notice">${icon('book')}<span>已挂载至当前会话 · 回复中可角标引用</span></div><article class="assistant-prose" style="margin:16px 0">${wikiContent[entry.id] || '<p>条目内容正在由 Host 整理中。</p>'}</article><div class="section-label">相关知识</div>${row('book', '会话恢复边界', '架构 · 2 处相互引用', 'open-wiki', 'session-boundary')}${fullButton('把本文加入砚台上下文', 'add-context', `@wiki/${entry.title}`)}${fullButton('基于本文出卡', 'sheet', 'produce-cards', 'secondary')}</div>`;
  };

  const cardQuestions = ['为什么会话状态\n应该属于 Host？', '断线以后，\n草稿应该如何发送？', 'Plan 与 Walkthrough\n有什么不同？'];
  const cardAnswers = ['因为桌面、手机和 CLI 需要读写同一份会话。Host 是执行与状态的唯一权威，设备只负责呈现与输入。', '先保留设备上的草稿。连接恢复后，先同步最新状态，再由用户确认发送，避免重复执行。', 'Plan 是结构化的内部步骤与执行状态；Walkthrough 是面向用户的交付验收报告。'];
  const cardIntervals = [['重来', '10分'], ['较难', '1天'], ['记得', '3天'], ['轻松', '7天']];

  pages.cards = () => {
    const idx = state.studyMode === 'review' ? state.studied : state.browsed;
    if (state.studied >= 12 && state.studyMode === 'review') {
      return `${header('知识卡片', '', 'knowledge')}<div class="screen-scroll"><div class="empty-state"><span class="brand-seal">砚</span><h2>今天的十二张，读完了。</h2><p>歇一会儿，让知识慢慢沉淀。</p></div>${fullButton('回到知识中心', 'navigate', 'knowledge')}${fullButton('重新体验这轮复习', 'reset-study', '', 'secondary')}</div>`;
    }
    return `${header('知识卡片', 'piwin · 架构与设计', 'knowledge', iconButton('more', '卡片选项', 'sheet', 'card-options'))}<div class="screen-scroll">${heading(state.studyMode === 'review' ? '今日，读懂一点。' : '随便翻翻。', state.studyMode === 'review' ? `待复习 ${Math.max(0, 12 - state.studied)} 张 · 进度随 Host 同步` : '浏览模式 · 不写入复习评分')}${tabs(['计划复习', '随便看看'], state.studyMode === 'review' ? '计划复习' : '随便看看', 'study-mode')}<div class="section-label"><span>架构 · Host</span><span class="mono">${String((idx % 3) + 1).padStart(2, '0')} / 12</span></div><button class="flashcard" data-action="flip-card" aria-label="${state.cardFlipped ? '查看问题' : '翻面查看答案'}"><span class="eyebrow">${state.cardFlipped ? 'ANSWER / 答案' : 'QUESTION / 问题'}</span>${state.cardFlipped ? `<p>${cardAnswers[idx % 3]}</p>` : `<h2>${cardQuestions[idx % 3].replace('\n', '<br>')}</h2>`}<span class="muted" style="font-size:11px">${state.cardFlipped ? '来自 docs/architecture.md' : '轻点纸面，翻看答案'} ↗</span></button>${state.cardFlipped ? (state.studyMode === 'review' ? `<p class="muted" style="font-size:12px;margin:20px 0 12px">这次记得怎么样？</p><div class="rating-grid">${cardIntervals.map(([label, interval]) => `<button data-action="rate-card" data-value="${label}">${label}<small>${interval}</small></button>`).join('')}</div>` : fullButton('下一张', 'next-card', '', 'secondary')) : fullButton('翻看答案', 'flip-card', '', 'secondary')}<div class="quote-note">${state.studyMode === 'review' ? '不用急着记住全部。每一次回想，都会留下新的痕迹。' : '只翻阅，不评分。遇到想再看的内容，可以留个记号。'}</div></div>`;
  };

  pages.voice = () => `${header('piwin Live', '移动语音 · 演示场景', I.back('voice', 'chat'), `${iconButton('pip', '收缩为小部件', 'shrink-live')}${iconButton('sliders', '语音设置', 'sheet', 'voice-settings')}`)}<div class="screen-scroll"><div class="live-stage"><span class="pill">${dot('running')}与当前会话连接</span><div class="live-orbit"><span class="brand-seal">砚</span></div><h2>${state.muted ? '安静一会儿。' : '我在听，你慢慢说。'}</h2><p>${escape(I.title(state.sessionId))} · piwin</p><div class="voice-bars" aria-hidden="true">${[1, 2, 4, 7, 5, 3, 8, 6, 4, 2, 5, 7, 3, 2, 1].map((level) => `<i style="--level:${state.muted ? 0 : level}"></i>`).join('')}</div><div class="quote-note" style="text-align:left">“把刚才的恢复方案整理一下，<br>先列计划，不要开始修改。”</div><p>演示转录 · 未使用麦克风</p><div class="live-controls"><button data-action="mute-voice" aria-label="${state.muted ? '取消静音' : '静音'}">${icon(state.muted ? 'close' : 'mic')}</button><button class="end-call" data-action="end-voice" aria-label="结束语音">${icon('close')}</button></div><p style="margin-top:17px">${state.muted ? '已静音' : '麦克风'}　　结束</p></div></div>`;
})();
