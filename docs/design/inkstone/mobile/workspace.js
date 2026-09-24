/* Workbench overview, subagents, review, and desk/settings destinations. */
(() => {
  const I = Inkstone;
  const { state, escape, icon, iconButton, dot, pill, row, header, heading, tabs, fullButton, field, pages } = I;

  const diffFiles = [
    { file: 'session-index.ts', path: 'packages/session/src', add: 24, del: 6, tag: 'M', code: [['', 41, 'async restoreSession(id) {'], ['remove', 42, '−  return createSession(id);'], ['add', 42, '+  const saved = await store.get(id);'], ['add', 43, '+  if (!saved) return createSession(id);'], ['add', 44, '+  return hydrateSession(saved);'], ['', 45, '}']] },
    { file: 'draft-store.ts', path: 'packages/session/src', add: 18, del: 0, tag: 'A', code: [['add', 1, '+export class DraftStore {'], ['add', 2, '+  private drafts = new Map<string, string>();'], ['add', 3, '+  get(id) { return this.drafts.get(id) || ""; }'], ['add', 4, '+  set(id, val) { this.drafts.set(id, val); }'], ['add', 5, '+}']] },
    { file: 'session-index.test.ts', path: 'packages/session/test', add: 6, del: 6, tag: 'M', code: [['', 18, 'it("restores drafts on reconnect", async () => {'], ['remove', 19, '−  const s = await restoreSession("foo");'], ['add', 19, '+  const s = await restoreSession("foo", { keepDraft: true });'], ['', 20, '  expect(s.draft).toBe("hello");'], ['', 21, '});']] },
  ];

  pages.workbench = () => {
    const tools = [
      { id: '变更', icon: 'git', title: '变更与差异', meta: '3 个文件 · +48 −12', tag: 'diff', action: 'navigate', val: 'review' },
      { id: '任务', icon: 'fork', title: '子代理与任务', meta: `${I.subagents().filter((a) => a.status === 'running').length} 运行中 · ${state.scheme}`, tag: 'agents', action: 'navigate', val: 'tasks' },
      { id: '终端', icon: 'term', title: '终端输出', meta: 'zsh · 退出码 0 · 快照', tag: 'zsh', action: 'open-tool', val: '终端' },
      { id: '浏览器', icon: 'globe', title: 'Host 浏览器', meta: 'localhost:5173 · 预览', tag: 'web', action: 'open-tool', val: '浏览器' },
      { id: '文件', icon: 'folder', title: '项目文件', meta: '3 个打开 · 2 个修改', tag: 'fs', action: 'open-tool', val: '文件' },
      { id: '画布', icon: 'panelr', title: 'Artifact 画布', meta: '会话记忆 · 1 份就绪', tag: 'html', action: 'open-tool', val: '画布' },
      { id: '文档', icon: 'file', title: '项目文档', meta: 'session-memory.md', tag: 'md', action: 'open-tool', val: '文档' },
      { id: '笔记', icon: 'edit', title: '随手记', meta: '3 点想法 · 关联会话', tag: 'note', action: 'open-tool', val: '笔记' },
      { id: '侧聊', icon: 'chat', title: '侧聊', meta: '正文共享，视图独立', tag: 'side', action: 'open-tool', val: '侧聊' },
    ];
    return `${header('工作台', `${escape(I.title(state.sessionId))} · 工具目录`, 'chat', iconButton('plus', '快捷操作', 'sheet', 'workspace-menu'))}<div class="screen-scroll">${heading('右侧面板，摊成一页。', '每个工具独占一屏，操作结论可随时带回砚台')}<div class="tool-grid">${tools.map((t) => `<button class="tool-tile" data-action="${t.action}" data-value="${t.val}">${icon(t.icon)}<strong>${t.title}</strong><small>${t.meta}</small><kbd>${t.tag}</kbd></button>`).join('')}</div><div class="section-label">后台服务</div>${row('term', 'pnpm dev', '本地开发服务 · 端口 5173 · 运行 14 分钟', 'open-tool', '终端')}${row('globe', 'Chrome Headless', '浏览器自动化驱动 · 内存 118MB', 'open-tool', '浏览器')}</div>`;
  };

  pages.tasks = () => {
    const agents = I.subagents();
    const paused = state.run === 'paused';
    return `${header('子代理与任务', `${escape(state.scheme)} · 编排`, I.back('tasks', 'chat'), iconButton('sliders', '编排方案', 'sheet', 'scheme'))}<div class="screen-scroll">${heading('远处的工作，看得见。', '异步子代理独立工作树，交付方案先审阅')}<div class="continue-card compact"><div class="spread"><span class="eyebrow">编排方案 · ${escape(state.scheme)}</span>${pill(`${dot(paused ? 'paused' : 'running')}${paused ? '已暂停' : '执行中'}`)}</div><p>主代理等待子代理交付成果；随时可追加要求或取消。</p><div class="button-row">${fullButton(paused ? '继续运行' : '暂停全部', 'toggle-run')}${fullButton('追加要求', 'sheet', 'intervene', 'secondary')}</div></div>${state.candidate === 'pending' ? `<div class="section-label">待审阅交付</div>${I.candidateCard(false)}` : ''}<div class="section-label">活动子代理</div>${agents.map((agent) => `<article class="card" style="margin-bottom:10px"><div class="spread"><span class="pill"><span class="monogram ${agent.status}">${agent.mono}</span>${agent.id}</span><span class="mono muted" style="font-size:11px">${agent.time}</span></div><h3 class="card-title" style="margin:8px 0 4px">${agent.role}</h3><p style="font-size:12px;color:var(--t2)">${agent.line}</p><div class="step-bar">${Array.from({ length: agent.steps[1] }).map((_, i) => `<i class="${i < agent.steps[0] ? 'on' : i === agent.steps[0] && agent.status === 'running' ? 'now' : ''}"></i>`).join('')}</div><div class="card-foot"><span class="mono" style="font-size:11px">${agent.tree} · ${agent.model}</span><button class="text-link" data-action="sheet" data-value="subagent-output">工作记录 ${icon('chevr')}</button></div><div class="button-row">${fullButton('追加要求', 'sheet', 'intervene')}${agent.status === 'running' ? fullButton('取消', 'cancel-subagent', agent.id, 'secondary') : ''}</div></article>`).join('')}<div class="section-label">后台守护程序</div>${row('term', 'pnpm dev', 'Vite Dev Server · 5173', 'open-tool', '终端')}${row('clock', '定时检查依赖更新', '每周一 10:00 执行', 'navigate', 'automations')}</div>`;
  };

  pages.review = () => {
    const isReviewed = (f) => state.reviewed.includes(f);
    return `${header('变更与审阅', `${diffFiles.length} 个文件 · +48 −12`, I.back('review', 'chat'), iconButton('more', '审阅选项', 'sheet', 'review-options'))}<div class="screen-scroll">${heading('在掌心，细读一笔。', '看过的打勾，点击新增代码行直接留下批注')}<div class="spread" style="margin:12px 0 6px"><span class="pill pine">已审阅 ${state.reviewed.length} / ${diffFiles.length}</span><span class="mono muted" style="font-size:11px">检查点 #3</span></div><div class="mini-progress pine"><span style="width:${(state.reviewed.length / diffFiles.length) * 100}%"></span></div>${diffFiles.map((df) => {
      const open = state.openFiles.includes(df.file);
      const comments = state.comments.filter((c) => c.file === df.file);
      return `<div class="diff-card"><div class="diff-heading"><button class="grow row" data-action="toggle-file" data-value="${df.file}"><span style="color:var(--ochre);font-weight:700">${df.tag}</span><code>${df.file}</code><span class="pm" style="margin-left:auto"><span class="plus">+${df.add}</span> <span class="minus">−${df.del}</span></span></button><button class="seen-box ${isReviewed(df.file) ? 'on' : ''}" data-action="toggle-seen" data-value="${df.file}" aria-label="标记看过">${isReviewed(df.file) ? '✓' : ''}</button></div>${open ? `<div class="diff-lines">${df.code.map(([type, no, text]) => `<div class="diff-line ${type} ${type === 'add' ? 'commentable' : ''}" ${type === 'add' ? `data-action="open-comment" data-value="${df.file}:${no}" role="button" tabindex="0"` : ''}><em>${no}</em>${escape(text)}</div>`).join('')}${comments.map((c) => `<div class="line-comment"><code>L${c.line}</code><span>${escape(c.text)}</span><button data-action="remove-comment" data-value="${c.id}">删除</button></div>`).join('')}</div>` : ''}</div>`;
    }).join('')}<div class="notice">${icon('alert')}<b>检查点机制</b><span>回滚只会撤回文件修改，对话记录与思考树完整保留。</span></div><div class="button-row">${fullButton('将批注带入砚台', 'navigate', 'chat')}${fullButton('全部标记为看过', 'mark-all-reviewed', '', 'secondary')}</div></div>`;
  };

  const inspectors = {
    '文件': () => `${heading('项目文件', 'piwin / main')}${row('folder', 'packages/session', '会话内核与草稿存储', 'sheet', 'folder')}${row('folder', 'apps/desktop', '桌面端主界面', 'sheet', 'folder')}${row('folder', 'docs/design', 'Inkstone 设计规范', 'sheet', 'folder')}${row('file', 'session-index.ts', 'packages/session/src · 已修改', 'sheet', 'file')}${row('file', 'draft-store.ts', 'packages/session/src · 新增', 'sheet', 'file')}`,
    '终端': () => `${heading('终端输出', 'Host · zsh · 只读快照')}<div class="pill">${dot('done')}退出码 0</div><pre class="terminal"><span class="muted">~/Developer/piwin</span>\n$ pnpm --filter @piwin/session test\n\n RUN  v3.0.5\n<span class="green"> ✓ session-index.test.ts (8)</span>\n<span class="green"> ✓ draft-store.test.ts (6)</span>\n\n Test Files  2 passed (2)\n      Tests  14 passed (14)\n   Duration  1.42s\n<span class="muted">输出快照 · 09:38:12</span></pre>${fullButton('让 Agent 执行下一条命令', 'sheet', 'terminal-command', 'secondary')}`,
    '变更': () => `${heading('本轮变更', '3 个文件 · +48 −12')}${fullButton('打开完整统一差异审阅', 'navigate', 'review')}`,
    '浏览器': () => `${heading('Host 浏览器', 'localhost:5173 · 预览快照')}<div class="note-paper"><span class="eyebrow">PIWIN / INKSTONE</span><h3 style="margin-top:20px">一张纸，一块砚。</h3><p>让思路有安放的地方。</p><hr><p>会话 · 动态 · 知识 · 案头</p><span class="pill pine" style="margin-top:20px">示例页面快照</span></div>${fullButton('把页面截图加入对话', 'add-context', '浏览器页面快照', 'secondary')}`,
    '画布': () => `${heading('Artifact 画布', '阅读预览 · 安全沙箱')}<div class="note-paper"><span class="eyebrow">SESSION MEMORY / 01</span><h3 style="margin-top:20px">一份安静的记忆</h3><p>会话内容交给 Host，阅读位置留在设备。</p><hr><div class="spread"><span class="pill">Host · 会话</span>→<span class="pill">设备 · 视图</span></div></div>${fullButton('查看 Artifact 源码', 'sheet', 'artifact-source', 'secondary')}`,
    '文档': () => `${heading('会话记忆设计', 'session-memory.md · 阅读模式')}<article class="note-paper"><span class="eyebrow">设计规范 / 2026.09</span><h3 style="margin-top:18px">恢复的是思路，也是上下文。</h3><p>同一个会话可以在不同的设备继续。手机带走的是观察和输入的能力，执行仍然留在 Host。</p></article>${fullButton('引用此文档到会话', 'add-context', 'session-memory.md', 'secondary')}`,
    '笔记': () => `${heading('随手记', '与当前会话关联')}<label class="field">移动端随手记<textarea id="note-editor" rows="7">${escape(state.note)}</textarea></label>${fullButton('保存笔记', 'save-note', '', 'secondary')}${fullButton('把笔记放入砚台草稿', 'add-context', state.note, 'subtle')}`,
    '侧聊': () => `${heading('另起一页，问个细节', '关联当前会话 · 不打断主线')}<div class="quote-note">“Host 记住会话本身，设备记住你阅读的位置。”</div><div class="user-message">为什么阅读位置不也放在 Host？</div><div class="assistant-prose" style="margin-top:16px"><p>因为两台设备可能正在读不同的地方。正文共享，视图独立，就不会相互干扰。</p></div>${fullButton('把侧聊结论带回主会话', 'add-context', '侧聊结论：正文共享，视图独立', 'secondary')}`,
  };

  pages.workspace = () => `${header('工具详情', `${state.tool} · 当前会话`, 'workbench', iconButton('grid', '工作台目录', 'navigate', 'workbench'))}<div class="screen-scroll">${inspectors[state.tool] ? inspectors[state.tool]() : inspectors['文件']()}</div>`;

  const settingsGroups = [
    ['应用', [['通用与外观', 'gear', '外观主题与桌面接入'], ['权限与安全', 'shield', 'Auto / Ask / YOLO 三态规则']]],
    ['Agent', [['模型配置', 'bulb', 'Claude · OpenAI · 自定义 API'], ['OAuth 登录', 'key', 'Codex 与 Gemini 账号凭据'], ['Hooks', 'bolt', '会话生命周期自动化检查'], ['智能体策略', 'fork', '子代理编排方案与沙箱']]],
    ['集成', [['技能与扩展', 'puzzle', 'Skills · MCP · 插件市场'], ['网络搜索与抓取', 'globe', 'DuckDuckGo · 网页抓取'], ['知识库与向量', 'book', '向量索引与词条库']]],
    ['系统', [['会话与运行时', 'term', '恢复策略与阅读断点保留'], ['冷存储', 'archive', '离线备份包与快照'], ['用量统计', 'chart', 'Token 输入输出统计'], ['归档管理', 'folder', '已归档历史会话恢复']]],
  ];

  pages.desk = () => {
    return `${header('案头', '主机、资料与设置', '', iconButton('search', '搜索设置', 'sheet', 'settings-search'))}${I.offlineBanner()}<div class="screen-scroll">${heading('一方小案头。', '收下成果，也留住灵感。')}<button class="host-card" data-action="sheet" data-value="host"><span class="host-monogram">书</span><span class="grow"><strong>${escape(state.hostName)}</strong><small>${state.offline ? '连接中断 · 快照模式' : '已连接 · 2 台设备在线'}</small></span>${dot(state.offline ? 'waiting' : 'done')}</button><div class="shelf-grid">${[['image', '资料库', '图片 · 视频 · 收藏', 'library'], ['book', '知识中心', '维基 · 信源 · 闪卡', 'knowledge'], ['refresh', '自动化', '2 条定时任务', 'automations'], ['chart', '用量统计', '最近 30 天用量', 'settings-detail', '用量统计']].map(([iconName, title, subtitle, route, arg]) => `<button class="shelf-tile" data-action="${route === 'settings-detail' ? 'open-settings' : 'navigate'}" data-value="${arg || route}">${icon(iconName)}<strong>${title}</strong><small>${subtitle}</small></button>`).join('')}</div><div class="section-label">设置分类</div>${settingsGroups.map(([grp, items]) => `<div class="group-label"><span>${grp}</span><span>${items.length}</span></div>${items.map(([title, iconName, subtitle]) => row(iconName, title, subtitle, 'open-settings', title)).join('')}`).join('')}<div class="section-label">快捷随手记</div>${fullButton(`${icon('mic')} 说一句，存为便签`, 'sheet', 'dictation', 'secondary')}</div>${I.nav('desk')}`;
  };

  const settingsContent = {
    '通用与外观': () => `<div class="face-switch" style="width:100%;margin:12px 0"><button style="flex:1" data-action="theme" data-value="paper" aria-pressed="${document.documentElement.dataset.face === 'paper'}">纸 · Paper</button><button style="flex:1" data-action="theme" data-value="ink" aria-pressed="${document.documentElement.dataset.face === 'ink'}">墨 · Ink</button></div>${row('globe', '私有 Host', '书房的 Mac Studio', 'navigate', 'connect')}${row('bell', '移动端通知偏好', '重要事件敲门 · 免打扰', 'sheet', 'notifications')}`,
    '权限与安全': () => `<div class="scope-options" role="group">${['Auto', 'Ask', 'YOLO'].map((m) => `<button data-action="choose-mode" data-value="${m}" aria-pressed="${state.runMode === m}">${m}</button>`).join('')}</div><p class="hint" style="margin:8px 0">Auto：按规则询问。Ask：每次询问。YOLO：跳过询问。</p>${row('file', '权限规则', 'permissions.json', 'sheet', 'rules')}${row('folder', '项目可信状态', 'piwin · 已信任', 'sheet', 'trust')}`,
    '模型配置': () => `${row('bulb', 'Anthropic Claude', 'Claude Sonnet / Opus', 'sheet', 'provider')}${row('bulb', 'OpenAI', '自定义 API 密钥', 'sheet', 'provider')}${fullButton('切换默认模型', 'sheet', 'model', 'secondary')}`,
    'OAuth 登录': () => `${row('key', 'OpenAI Codex', '未登录 · 由 Host 管理凭据', 'sheet', 'oauth')}${row('key', 'Google Gemini', '未登录', 'sheet', 'oauth')}`,
    'Hooks': () => `${row('bolt', '会话完成自动运行检查', 'session:end → pnpm typecheck', 'sheet', 'hook')}`,
    '智能体策略': () => `${row('fork', '子代理编排方案', '当前：' + state.scheme, 'sheet', 'scheme')}${row('panelr', 'Artifact 沙箱渲染', '已启用', 'sheet', 'artifact-settings')}`,
    '技能与扩展': () => `${tabs(['技能', 'MCP', '扩展'], state.extensionTab, 'extension-tab')}${row('puzzle', 'karpathy-guidelines', '已启用 · 极简编码准则', 'sheet', 'skill-detail')}${row('globe', 'GitHub MCP', '已连接 · 8 个工具', 'sheet', 'mcp')}`,
    '网络搜索与抓取': () => `${row('search', '网络搜索', 'DuckDuckGo · 优先', 'sheet', 'web-search')}${row('globe', '网页抓取', 'Supermarkdown', 'sheet', 'web-fetch')}`,
    '知识库与向量': () => `${row('book', '向量嵌入服务', 'Host 本地向量索引 · 就绪', 'sheet', 'knowledge-model')}`,
    '会话与运行时': () => `${row('term', '会话恢复策略', '自动压缩 · 恢复草稿与阅读位置', 'sheet', 'session-policy')}`,
    '冷存储': () => `${row('archive', '归档包管理', '2 个离线备份包', 'sheet', 'cold-storage')}`,
    '用量统计': () => `<div class="metric-grid"><div><strong>2.8M</strong><small>Token 输入</small></div><div><strong>428k</strong><small>Token 输出</small></div><div><strong>36</strong><small>会话数</small></div></div><div class="usage-chart">${[30, 55, 45, 80, 62, 95, 68].map((h) => `<span style="--height:${h}%"></span>`).join('')}</div>`,
    '归档管理': () => `${row('archive', '已归档会话 · 3 篇', '随时可恢复至会话列表', 'restore-archive', '')}`,
  };

  pages['settings-detail'] = () => `${header(escape(state.settingsSection), '设置 · 偏好', 'desk')}<div class="screen-scroll">${heading(escape(state.settingsSection))}${settingsContent[state.settingsSection] ? settingsContent[state.settingsSection]() : '<p>配置正在读取…</p>'}</div>`;

  pages.library = () => `${header('资料库', 'Host 媒体资产', 'desk', iconButton('plus', '生成', 'sheet', 'media-new'))}<div class="screen-scroll">${heading('留下的，都在这里。', '图片、视频与收藏')}${tabs(['全部', '图片', '视频', '收藏'], state.libraryFilter, 'library-filter')}<div class="asset-grid">${[['image', '纸面外壳', '1440 × 900', 'ink'], ['image', '墨面外壳', '1440 × 900', ''], ['file', '恢复走查演示', '00:24', 'video']].map(([iconName, title, meta, cls]) => `<button class="asset-item" data-action="sheet" data-value="asset"><span class="asset-thumb ${cls}"></span><strong>${title}</strong><small>${meta}</small></button>`).join('')}</div></div>`;

  pages.automations = () => `${header('自动化', 'Host 定时运行', 'desk', iconButton('plus', '新建', 'sheet', 'automation-new'))}<div class="screen-scroll">${heading('小事，按时发生。', 'Host 定时触发，手机随时审阅')}${row('refresh', '每日复盘未完工作', '每天 09:00 · 待办汇总', 'sheet', 'automation-edit', '已启用')}${row('git', '每周依赖安全走查', '每周一 10:00 · piwin', 'sheet', 'automation-edit', '已暂停')}</div>`;

  pages.walkthrough = () => `${header('报告', 'Inkstone · 桌面主题', 'chat', iconButton('copy', '复制报告', 'copy-report'))}<div class="screen-scroll">${heading('纸与墨，\n终于有了同一种语气。', '交付验收报告 · 4 个文件验证记录')}<article class="assistant-prose"><p>已统一纸墨主题语义、会话节点、砚台与权限印章。</p><div class="command">✓ session restore 8 tests\n✓ draft persistence 6 tests\n✓ typecheck green</div></article>${fullButton('回到会话', 'navigate', 'chat')}</div>`;

  pages.connect = () => `${header('私有 Host', '配对与连接', 'desk')}<div class="screen-scroll"><div class="empty-state"><span class="brand-seal">砚</span><h2>连回自己的书案。</h2><p>项目、模型与会话归 Host，手机是随身窗口。</p></div><button class="host-card" data-action="pair-demo"><span class="host-monogram">书</span><span class="grow"><strong>${escape(state.hostName)}</strong><small>已配对 · ${state.offline ? '离线' : '可连接'}</small></span>${dot(state.offline ? 'waiting' : 'done')}</button>${fullButton('扫描桌面接入码', 'sheet', 'pairing')}${fullButton('手动输入连接地址', 'sheet', 'manual-connect', 'secondary')}</div>`;

  Inkstone.inspectors = inspectors;
})();
