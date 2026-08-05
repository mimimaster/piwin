/**
 * Desktop-only display language preference.
 *
 * This stays in the renderer because it affects presentation only; it must not
 * alter shared host configuration, model data, or transcript content.
 */
export type DesktopLocale = 'zh-CN' | 'en';

const DESKTOP_LOCALE_KEY = 'piwin.desktop.locale';
const DEFAULT_DESKTOP_LOCALE: DesktopLocale = 'zh-CN';

export type DesktopCopy = {
  settings: string;
  general: string;
  advanced: string;
  language: string;
  languageDescription: string;
  chinese: string;
  english: string;
  backToWorkspace: string;
  localConfiguration: string;
  configurationRoot: string;
  savedLocally: string;
  workspace: string;
  sessions: string;
  newSession: string;
  searchSessions: string;
  close: string;
  ready: string;
  offline: string;
  betaFeature: string;
  knowledgeCenter: string;
  titlebar: {
    collapseSidebar: string;
    expandSidebar: string;
    shellNavigation: string;
    back: string;
    forward: string;
    dragWindow: string;
    tools: string;
    more: string;
    moreTools: string;
    sessions: string;
    skills: string;
    collapseWorkspacePanel: string;
    expandWorkspacePanel: string;
    switchToDarkTheme: string;
    switchToLightTheme: string;
  };
  sidebar: {
    archived: string;
    pinSession: string;
    unpinSession: string;
    restoreSession: string;
    deleteSessionPermanently: string;
    sessionActions: string;
    projects: string;
    displayOptions: string;
    customizeSidebar: string;
    customize: string;
    ordering: string;
    updated: string;
    lastUpdated: string;
    alphabetical: string;
    groupBy: string;
    dateTime: string;
    none: string;
    flatList: string;
    filters: string;
    openWorkspaceFolder: string;
    openWorkspaceFolderAction: string;
    generalChat: string;
    newConversationInProject: (projectName: string) => string;
    showLess: string;
    seeAll: (count: number) => string;
    conversations: string;
    noGeneralConversations: string;
    resizeSidebar: string;
    resizeSidebarHint: string;
  };
  composer: {
    dropFiles: string;
    textOnlyModelWarning: string;
    openModelSettings: string;
    removeCommentAttachment: string;
    removeAttachment: string;
    typeYourAnswer: string;
    chooseOption: string;
    agentPlaceholder: string;
    planPlaceholder: string;
    askPlaceholder: string;
    attachFiles: string;
    exitAgentMode: (mode: string) => string;
    model: string;
    send: string;
    sendShortcut: string;
    sendSteerMessage: string;
    sendSteerHint: string;
    stop: string;
    stopping: string;
    hostConnecting: string;
    hostStatus: (mode: string, isMock: boolean) => string;
    hostTooltip: (mode: string, isMock: boolean, ready: boolean, transport?: string) => string;
    shortcutHint: string;
  };
  interruption: {
    agentWaiting: string;
    answerInComposer: string;
    selectOrCustomPlaceholder: string;
    cancelQuestion: string;
    continue: string;
    approvalRequired: string;
    allowForSession: string;
    allowOnce: string;
    allowForProject: string;
    deny: string;
    expandDetails: string;
    collapseDetails: string;
  };
  appearance: {
    pageTitle: string;
    pageDescription: string;
    chatSettings: string;
    chatSettingsDescription: string;
    verboseAgentChat: string;
    verboseAgentChatDescription: string;
    conversationWidth: string;
    conversationWidthDescription: string;
    default: string;
    narrow: string;
    wide: string;
    appearance: string;
    appearanceDescription: string;
    system: string;
    light: string;
    dark: string;
    lightTheme: string;
    darkTheme: string;
    preset: string;
    background: string;
    foreground: string;
    accent: string;
    typography: string;
    typographyDescription: string;
    assistantTextSize: string;
    assistantTextSizeDescription: string;
    small: string;
    large: string;
    codeBlockSize: string;
    codeBlockSizeDescription: string;
    codeWrap: string;
    codeWrapDescription: string;
    interactionRendering: string;
    interactionRenderingDescription: string;
    toolCallDensity: string;
    toolCallDensityDescription: string;
    compact: string;
    comfortable: string;
    detailed: string;
    workDetailsDefault: string;
    workDetailsDefaultDescription: string;
    auto: string;
    always: string;
    collapsed: string;
    codeFirstMode: string;
    codeFirstModeDescription: string;
    resetDefaults: string;
    uiThemes: string;
    uiThemesDescription: string;
  };
};

/**
 * Desktop-only interface copy. Host responses, package manifests, model names,
 * paths, and user-authored data intentionally stay outside this catalog.
 */
export type DesktopTranslator = {
  common: {
    add: string;
    apply: string;
    cancel: string;
    close: string;
    confirm: string;
    delete: string;
    disable: string;
    enable: string;
    install: string;
    loading: string;
    refresh: string;
    remove: string;
    save: string;
    saving: string;
  };
  interruption: {
    agentWaiting: string;
    answerInComposer: string;
    selectOrCustomPlaceholder: string;
    cancelQuestion: string;
    continue: string;
    approvalRequired: string;
    allowForSession: string;
    allowOnce: string;
    allowForProject: string;
    deny: string;
    expandDetails: string;
    collapseDetails: string;
  };
  settings: {
    application: string;
    agent: string;
    integrations: string;
    system: string;
    personalization: string;
    backToWorkspace: string;
    configuredLocally: string;
    nav: {
      general: string;
      appearance: string;
      permissions: string;
      models: string;
      vision: string;
      imageGeneration: string;
      artifact: string;
      sessions: string;
      runtime: string;
      rules: string;
      skills: string;
      tools: string;
      web: string;
      extensions: string;
      plugins: string;
      prompts: string;
      automation: string;
      agents: string;
      subagents: string;
      pets: string;
      usage: string;
      shortcuts: string;
    };
    provider: {
      search: string;
      configuredHeading: string;
      empty: string;
      addProvider: string;
      addProviderTitle: string;
      addProviderDesc: string;
      providerNameField: string;
      providerNamePlaceholder: string;
      providerTypeField: string;
      default: string;
      models: (count: number) => string;
      selectOrAdd: string;
      connectionHint: string;
      setDefault: string;
      providerId: string;
      displayName: string;
      protocol: string;
      baseUrl: string;
      baseUrlDescription: string;
      apiKeyLabel: string;
      apiKeyPlaceholder: string;
      apiKeyStoredPlaceholder: string;
      apiKeyStoredKeychain: string;
      apiKeyStoredEnv: (envName: string) => string;
      apiKeyPasteHint: string;
      enableProvider: string;
      providerEnabledHint: string;
      providerDisabledHint: string;
      searchPlaceholder: string;
      filterAll: string;
      filterOn: string;
      filterOff: string;
      noProviders: string;
      noMatchingProviders: string;
      addProviderHint: string;
      statusOk: string;
      statusFail: string;
      statusOff: string;
      testConnection: string;
      testing: string;
      testOk: (count: number, duration: number) => string;
      saveAndAdd: string;
      providerName: string;
      modelsWithCount: (count: number) => string;
      apiKeyEnvironment: string;
      apiKeyEnvironmentDescription: string;
      keychainReference: string;
      showKeychain: string;
      hideKeychain: string;
      detect: string;
      detecting: string;
      detectOk: (count: number) => string;
      detectFail: string;
      keyManager: string;
      keyManagerTitle: (name: string) => string;
      keyManagerHint: string;
      keyManagerAdd: string;
      requestHeaders: string;
      requestHeadersHint: string;
      headerName: string;
      headerValue: string;
      addHeader: string;
      apiAddress: string;
      connectionEdit: string;
      connectionDefaultEndpoint: string;
      endpointPreview: string;
      advanced: string;
      saveProvider: string;
      ultraThinking: string;
      ultraThinkingDescription: string;
      enableUltra: string;
      removeProviderTitle: string;
      removeProviderDescription: string;
      deleteProvider: string;
      modelsHeading: string;
      modelsEmpty: string;
      fetchModelList: string;
      discover: string;
      addModel: string;
      addModelTitle: string;
      addModelAction: string;
      modelIdPlaceholder: string;
      modelNamePlaceholder: string;
      modelGroupName: string;
      modelGroupPlaceholder: string;
      modelTooltipLabel: string;
      modelTooltipPlaceholder: string;
      contextUnset: string;
      outputUnset: string;
      runtimeLimits: string;
      modelId: string;
      modelDisplayName: string;
      contextLimit: string;
      outputLimit: string;
      tooltipMarkdown: string;
      discoveryLabel: string;
      discoveryTitle: string;
      discoveryTitleFor: (name: string) => string;
      discoveryDescription: string;
      discoveryKeyHint: string;
      searchDiscovered: string;
      fetching: string;
      configured: string;
      new: string;
      noMatchingModels: string;
      selectedModels: (selected: number, newModels: number) => string;
      importSelected: string;
    };
    imageGeneration: {
      pageTitle: string;
      pageDescription: string;
      provider: string;
      apiEndpoint: string;
      apiKey: string;
      apiKeyStoredKeychain: string;
      apiKeyStoredEnv: (envName: string) => string;
      apiKeyUnset: string;
      requestPath: string;
      requestPathHint: string;
      timeout: string;
      timeoutUnitSeconds: string;
      modelId: string;
      modelLabel: string;
      modelDescription: string;
      discoverModels: string;
      discoveringModels: string;
      setDefault: string;
      addModel: string;
      removeModel: string;
      noModels: string;
      discoveryError: string;
      modelsHeading: string;
    };
  };
};

const COPY_BY_LOCALE: Record<DesktopLocale, DesktopCopy> = {
  'zh-CN': {
    settings: '设置',
    general: '通用',
    advanced: '高级',
    language: '语言',
    languageDescription: '切换界面显示语言。',
    chinese: '简体中文',
    english: 'English',
    backToWorkspace: '返回工作区',
    localConfiguration: '本地配置',
    configurationRoot: '配置根目录',
    savedLocally: '已保存在本地',
    workspace: '工作区',
    sessions: '会话',
    newSession: '新会话',
    searchSessions: '搜索会话',
    close: '关闭',
    ready: 'piwin 就绪',
    offline: 'piwin 已断开',
    betaFeature: 'Beta 功能',
    knowledgeCenter: '知识中心',
    titlebar: {
      collapseSidebar: '收起左边栏',
      expandSidebar: '展开左边栏',
      shellNavigation: '界面导航',
      back: '上一步',
      forward: '下一步',
      dragWindow: '拖动窗口',
      tools: '工具',
      more: '更多',
      moreTools: '更多工具',
      sessions: '会话',
      skills: 'Skills',
      collapseWorkspacePanel: '收起右侧工作面板',
      expandWorkspacePanel: '展开右侧工作面板',
      switchToDarkTheme: '切换到深色主题',
      switchToLightTheme: '切换到浅色主题',
    },
    sidebar: {
      archived: '已归档',
      pinSession: '置顶会话',
      unpinSession: '取消置顶',
      restoreSession: '恢复会话',
      deleteSessionPermanently: '永久删除会话',
      sessionActions: '会话操作',
      projects: '项目',
      displayOptions: '显示选项',
      customizeSidebar: '自定义侧边栏',
      customize: '自定义',
      ordering: '排序',
      updated: '最近更新',
      lastUpdated: '最后更新',
      alphabetical: '按字母排序 (A-Z)',
      groupBy: '分组方式',
      dateTime: '日期 / 时间',
      none: '无',
      flatList: '无分组列表',
      filters: '筛选',
      openWorkspaceFolder: '打开工作区文件夹',
      openWorkspaceFolderAction: '打开工作区文件夹…',
      generalChat: '通用 Chat（快速开始）',
      newConversationInProject: (projectName) => `在 ${projectName} 中新建会话`,
      showLess: '收起',
      seeAll: (count) => `查看全部 (${count})`,
      conversations: '会话',
      noGeneralConversations: '暂无通用会话',
      resizeSidebar: '调整侧边栏宽度',
      resizeSidebarHint: '拖动调整宽度，双击恢复默认。',
    },
    composer: {
      dropFiles: '拖放文件或图片以添加上下文',
      textOnlyModelWarning: '当前模型不支持图像。请切换到 Vision 模型，或开启视觉委派。',
      openModelSettings: '模型设置',
      removeCommentAttachment: '移除评论附件',
      removeAttachment: '移除附件',
      typeYourAnswer: '输入你的回答',
      chooseOption: '选择上方选项以继续',
      agentPlaceholder: '规划、搜索或构建任何内容',
      planPlaceholder: '描述你希望制定的计划…',
      askPlaceholder: '询问有关此项目的任何问题…',
      attachFiles: '添加文件和上下文',
      exitAgentMode: (mode) => `退出 ${mode} 模式`,
      model: '模型',
      send: '发送',
      sendShortcut: '发送 (Enter)',
      sendSteerMessage: '发送 Steer 消息',
      sendSteerHint: '发送（进入队列 / Steer）',
      stop: '停止',
      stopping: '正在停止…',
      hostConnecting: 'Host：正在连接…',
      hostStatus: (mode, isMock) => `Host：${mode}${isMock ? '（模拟）' : ''}`,
      hostTooltip: (mode, isMock, ready, transport) =>
        `Host 模式：${mode}${isMock ? '（模拟）' : '（实时）'}｜状态：${ready ? '就绪' : '正在连接'}${transport ? `｜传输：${transport}` : ''}`,
      shortcutHint: '↵ 发送 · ⇧↵ 换行 · / 命令 · @ 提及 · ↑/↓ 历史记录 · Esc 中断',
    },
    interruption: {
      agentWaiting: 'Agent 正等待你的回答',
      answerInComposer: '在下方输入框中回答',
      selectOrCustomPlaceholder: '选择上方选项，或在此输入自定义回答...',
      cancelQuestion: '取消问题',
      continue: '继续',
      approvalRequired: '需要你的批准',
      allowForSession: '允许本次会话',
      allowOnce: '仅允许这一次',
      allowForProject: '允许此项目',
      deny: '拒绝',
      expandDetails: '展开详情',
      collapseDetails: '收起详情',
    },
    appearance: {
      pageTitle: '外观',
      pageDescription: '配置 Agent 的视觉主题和显示偏好。',
      chatSettings: 'Chat Settings',
      chatSettingsDescription: '调整 Chat 显示和对话宽度。',
      verboseAgentChat: 'Verbose Agent Chat',
      verboseAgentChatDescription:
        '显示并保留中间 thinking steps。关闭后仅隐藏显示，不会删除 transcript。',
      conversationWidth: '对话宽度',
      conversationWidthDescription: '设置 conversation panel 的最大宽度。',
      default: 'Default',
      narrow: 'Narrow',
      wide: 'Wide',
      appearance: 'Appearance',
      appearanceDescription: '选择 Light、Dark，或跟随系统设置。',
      system: 'System',
      light: 'Light',
      dark: 'Dark',
      lightTheme: 'Light Theme',
      darkTheme: 'Dark Theme',
      preset: 'Preset',
      background: 'Background',
      foreground: 'Foreground',
      accent: 'Accent',
      typography: '字体与排印',
      typographyDescription: '调整助手文本和代码块的字体大小与换行策略。',
      assistantTextSize: '助手文本大小',
      assistantTextSizeDescription: '助手回答的字体大小。',
      small: '小',
      large: '大',
      codeBlockSize: '代码块大小',
      codeBlockSizeDescription: '代码和 Tool output 中的等宽字体大小。',
      codeWrap: '代码自动换行',
      codeWrapDescription: '代码块自动换行，而非水平滚动。',
      interactionRendering: '交互与渲染',
      interactionRenderingDescription:
        '自定义 Tool call 详细度、工作详情展开策略和 Artifact 动态渲染。',
      toolCallDensity: 'Tool call 密度',
      toolCallDensityDescription: '调整 Tool call 显示的详细程度。',
      compact: '紧凑',
      comfortable: '适中',
      detailed: '详细',
      workDetailsDefault: '工作详情默认展开',
      workDetailsDefaultDescription: '控制 assistant message 中工作详情的默认展开方式。',
      auto: '自动',
      always: '始终展开',
      collapsed: '默认收起',
      codeFirstMode: '代码优先',
      codeFirstModeDescription: 'Artifact 默认展示源代码，并提供 Preview 切换。',
      resetDefaults: '重置 Appearance 默认值',
      uiThemes: '界面主题',
      uiThemesDescription: '选择、应用或安装 piwin UI appearance themes。',
    },
  },
  en: {
    settings: 'Settings',
    general: 'General',
    advanced: 'Advanced',
    language: 'Language',
    languageDescription: 'Change the application display language.',
    chinese: 'Simplified Chinese',
    english: 'English',
    backToWorkspace: 'Back to workspace',
    localConfiguration: 'Local configuration',
    configurationRoot: 'Configuration root',
    savedLocally: 'Saved locally',
    workspace: 'Workspace',
    sessions: 'Sessions',
    newSession: 'New session',
    searchSessions: 'Search sessions',
    close: 'Close',
    ready: 'piwin ready',
    offline: 'piwin disconnected',
    betaFeature: 'Beta feature',
    knowledgeCenter: 'Knowledge Center',
    titlebar: {
      collapseSidebar: 'Collapse sidebar',
      expandSidebar: 'Expand sidebar',
      shellNavigation: 'Shell navigation',
      back: 'Back',
      forward: 'Forward',
      dragWindow: 'Drag window',
      tools: 'Tools',
      more: 'More',
      moreTools: 'More tools',
      sessions: 'Sessions',
      skills: 'Skills',
      collapseWorkspacePanel: 'Collapse workspace panel',
      expandWorkspacePanel: 'Expand workspace panel',
      switchToDarkTheme: 'Switch to dark theme',
      switchToLightTheme: 'Switch to light theme',
    },
    sidebar: {
      archived: 'Archived',
      pinSession: 'Pin session',
      unpinSession: 'Unpin session',
      restoreSession: 'Restore session',
      deleteSessionPermanently: 'Delete session permanently',
      sessionActions: 'Session actions',
      projects: 'Projects',
      displayOptions: 'Display options',
      customizeSidebar: 'Customize sidebar',
      customize: 'Customize',
      ordering: 'Ordering',
      updated: 'Updated',
      lastUpdated: 'Last updated',
      alphabetical: 'Alphabetical (A-Z)',
      groupBy: 'Group by',
      dateTime: 'Date / Time',
      none: 'None',
      flatList: 'Flat list',
      filters: 'Filters',
      openWorkspaceFolder: 'Open workspace folder',
      openWorkspaceFolderAction: 'Open Workspace Folder…',
      generalChat: 'General Chat (Quick Start)',
      newConversationInProject: (projectName) => `New conversation in ${projectName}`,
      showLess: 'Show less',
      seeAll: (count) => `See all (${count})`,
      conversations: 'Conversations',
      noGeneralConversations: 'No general conversations',
      resizeSidebar: 'Resize sidebar',
      resizeSidebarHint: 'Drag to resize. Double-click to reset.',
    },
    composer: {
      dropFiles: 'Drop files or images here to add context',
      textOnlyModelWarning:
        'This text-only model cannot analyze images. Switch to a Vision model or enable vision delegation.',
      openModelSettings: 'Model settings',
      removeCommentAttachment: 'Remove comment attachment',
      removeAttachment: 'Remove attachment',
      typeYourAnswer: 'Type your answer',
      chooseOption: 'Choose an option above to continue',
      agentPlaceholder: 'Plan, search, build anything',
      planPlaceholder: 'Describe what you want planned…',
      askPlaceholder: 'Ask anything about this project…',
      attachFiles: 'Attach files, add context',
      exitAgentMode: (mode) => `Exit ${mode} mode`,
      model: 'Model',
      send: 'Send',
      sendShortcut: 'Send (Enter)',
      sendSteerMessage: 'Send steer message',
      sendSteerHint: 'Send (queue / Steer)',
      stop: 'Stop',
      stopping: 'Stopping…',
      hostConnecting: 'Host: Connecting…',
      hostStatus: (mode, isMock) => `Host: ${mode}${isMock ? ' (mock)' : ''}`,
      hostTooltip: (mode, isMock, ready, transport) =>
        `Host Mode: ${mode}${isMock ? ' (Mock)' : ' (Live)'} | Status: ${ready ? 'Ready' : 'Connecting'}${transport ? ` | Transport: ${transport}` : ''}`,
      shortcutHint: '↵ Send · ⇧↵ New line · / Commands · @ Mention · ↑/↓ History · Esc Stop',
    },
    interruption: {
      agentWaiting: 'Agent is waiting for your answer',
      answerInComposer: 'Answer in the composer below',
      selectOrCustomPlaceholder: 'Select an option above, or type your response here...',
      cancelQuestion: 'Cancel question',
      continue: 'Continue',
      approvalRequired: 'Approval required',
      allowForSession: 'Allow for this session',
      allowOnce: 'Allow once',
      allowForProject: 'Allow for this project',
      deny: 'Deny',
      expandDetails: 'Expand details',
      collapseDetails: 'Collapse details',
    },
    appearance: {
      pageTitle: 'Appearance',
      pageDescription: "Configure the Agent's visual theme and display preferences.",
      chatSettings: 'Chat Settings',
      chatSettingsDescription: 'Tune Chat display and conversation width.',
      verboseAgentChat: 'Verbose Agent Chat',
      verboseAgentChatDescription: 'Display and preserve intermediate thinking steps.',
      conversationWidth: 'Conversation Width',
      conversationWidthDescription: 'Configure the maximum width of the conversation panel.',
      default: 'Default',
      narrow: 'Narrow',
      wide: 'Wide',
      appearance: 'Appearance',
      appearanceDescription: 'Select light, dark, or inherit system settings.',
      system: 'System',
      light: 'Light',
      dark: 'Dark',
      lightTheme: 'Light Theme',
      darkTheme: 'Dark Theme',
      preset: 'Preset',
      background: 'Background',
      foreground: 'Foreground',
      accent: 'Accent',
      typography: 'Typography',
      typographyDescription:
        'Adjust font sizes and line wrapping for assistant text and code blocks.',
      assistantTextSize: 'Assistant text size',
      assistantTextSizeDescription: 'Font size for assistant responses.',
      small: 'Small',
      large: 'Large',
      codeBlockSize: 'Code block size',
      codeBlockSizeDescription: 'Monospace font size for code and Tool output.',
      codeWrap: 'Code wrap',
      codeWrapDescription: 'Wrap code blocks instead of scrolling horizontally.',
      interactionRendering: 'Interaction & Rendering',
      interactionRenderingDescription:
        'Customize Tool call details, work section expansion, and Artifact live rendering.',
      toolCallDensity: 'Tool call density',
      toolCallDensityDescription: 'Adjust how much detail is shown for Tool calls.',
      compact: 'Compact',
      comfortable: 'Comfortable',
      detailed: 'Detailed',
      workDetailsDefault: 'Work details default',
      workDetailsDefaultDescription:
        'Control the default expansion of work details in assistant messages.',
      auto: 'Auto',
      always: 'Always',
      collapsed: 'Collapsed',
      codeFirstMode: 'Code-first mode',
      codeFirstModeDescription: 'Display Artifact source first with a Preview toggle.',
      resetDefaults: 'Reset Appearance defaults',
      uiThemes: 'UI Themes',
      uiThemesDescription: 'Select, apply, or install piwin UI appearance themes.',
    },
  },
};

export function getDesktopCopy(locale: DesktopLocale): DesktopCopy {
  return COPY_BY_LOCALE[locale];
}

export function getDesktopTranslator(locale: DesktopLocale): DesktopTranslator {
  const isChinese = locale === 'zh-CN';
  return {
    common: {
      add: isChinese ? '添加' : 'Add',
      apply: isChinese ? '应用' : 'Apply',
      cancel: isChinese ? '取消' : 'Cancel',
      close: isChinese ? '关闭' : 'Close',
      confirm: isChinese ? '确定' : 'Confirm',
      delete: isChinese ? '删除' : 'Delete',
      disable: isChinese ? '禁用' : 'Disable',
      enable: isChinese ? '启用' : 'Enable',
      install: isChinese ? '安装' : 'Install',
      loading: isChinese ? '加载中…' : 'Loading…',
      refresh: isChinese ? '刷新' : 'Refresh',
      remove: isChinese ? '移除' : 'Remove',
      save: isChinese ? '保存' : 'Save',
     saving: isChinese ? '保存中…' : 'Saving…',
   },
    interruption: {
      agentWaiting: isChinese ? 'Agent 正等待你的回答' : 'Agent is waiting for your answer',
      answerInComposer: isChinese ? '在下方输入框中回答' : 'Answer in the composer below',
      selectOrCustomPlaceholder: isChinese
        ? '选择上方选项，或在此输入自定义回答...'
        : 'Select an option above, or type your response here...',
      cancelQuestion: isChinese ? '取消问题' : 'Cancel question',
      continue: isChinese ? '继续' : 'Continue',
      approvalRequired: isChinese ? '需要你的批准' : 'Approval required',
      allowForSession: isChinese ? '允许本次会话' : 'Allow for this session',
      allowOnce: isChinese ? '仅允许这一次' : 'Allow once',
      allowForProject: isChinese ? '允许此项目' : 'Allow for this project',
      deny: isChinese ? '拒绝' : 'Deny',
      expandDetails: isChinese ? '展开详情' : 'Expand details',
      collapseDetails: isChinese ? '收起详情' : 'Collapse details',
    },
   settings: {
      application: isChinese ? '应用' : 'Application',
      agent: 'Agent',
      integrations: isChinese ? '集成' : 'Integrations',
      system: isChinese ? '系统' : 'System',
      personalization: isChinese ? '个性化' : 'Personalization',
      backToWorkspace: isChinese ? '返回工作区' : 'Back to workspace',
      configuredLocally: isChinese ? '已保存在本地' : 'Saved locally',
      nav: {
        general: isChinese ? '通用' : 'General',
        appearance: isChinese ? '外观' : 'Appearance',
        permissions: isChinese ? '权限' : 'Permissions',
        models: isChinese ? '模型' : 'Models',
        vision: isChinese ? '视觉' : 'Vision',
        imageGeneration: isChinese ? '图像生成' : 'Image Generation',
        artifact: isChinese ? 'Artifact' : 'Artifact',
        sessions: 'Walkthrough',
        runtime: isChinese ? '会话运行时' : 'Session Runtime',
        rules: isChinese ? '规则' : 'Rules',
        skills: 'Skills',
        tools: 'MCP',
        web: isChinese ? 'Web 工具' : 'Web tools',
        extensions: isChinese ? '扩展' : 'Extensions',
        plugins: isChinese ? '插件' : 'Plugins',
        prompts: isChinese ? 'Prompt 模板' : 'Prompt templates',
        automation: isChinese ? '自动化' : 'Automation',
        agents: isChinese ? 'Agent' : 'Sub-agents',
        subagents: isChinese ? '子代理配置' : 'Sub-agent profiles',
        pets: isChinese ? '宠物' : 'Companion',
        usage: isChinese ? '用量统计' : 'Usage',
        shortcuts: isChinese ? '快捷键' : 'Shortcuts',
      },
      provider: {
        search: isChinese ? '搜索提供商…' : 'Search providers…',
        configuredHeading: isChinese ? '已配置' : 'Configured',
        empty: isChinese ? '暂无提供商，点击下方添加。' : 'No providers yet — add one below.',
        addProvider: isChinese ? '添加提供商' : 'Add provider',
        addProviderTitle: isChinese ? '添加提供商' : 'Add provider',
        addProviderDesc: isChinese
          ? '选择要接入的模型服务商，或添加任意 OpenAI 兼容接口'
          : 'Pick a model vendor, or add any OpenAI-compatible endpoint',
        providerNameField: isChinese ? '提供商名称' : 'Provider name',
        providerNamePlaceholder: isChinese ? '例如 OpenAI' : 'e.g. OpenAI',
        providerTypeField: isChinese ? '提供商类型' : 'Provider type',
        default: isChinese ? '默认' : 'Default',
        models: (count) =>
          isChinese ? `${count} 个模型` : `${count} ${count === 1 ? 'model' : 'models'}`,
        selectOrAdd: isChinese
          ? '从左侧选择提供商，或点击添加。'
          : 'Select a provider on the left, or add one.',
        connectionHint: isChinese
          ? '密钥通过环境变量或钥匙串管理，绝不写入配置文件。'
          : 'Keys stay in env / keychain — never store raw secrets in config.',
        setDefault: isChinese ? '设为默认' : 'Set default',
        providerId: isChinese ? '提供商 ID' : 'Provider ID',
        displayName: isChinese ? '显示名称' : 'Display name',
        protocol: isChinese ? '协议' : 'Protocol',
        baseUrl: 'Base URL',
        baseUrlDescription: isChinese
          ? '用于模型发现和请求的自定义服务端点。'
          : 'Custom provider endpoint used for model discovery and requests.',
        apiKeyLabel: isChinese ? 'API 密钥' : 'API key',
        apiKeyPlaceholder: isChinese
          ? '粘贴 API 密钥（本地无鉴权服务可留空）'
          : 'Paste API key (leave empty for local no-auth)',
        apiKeyStoredPlaceholder: isChinese
          ? '••••••••  已保存 — 留空则不变'
          : '••••••••  saved — leave blank to keep',
        apiKeyStoredKeychain: isChinese
          ? '密钥已存入本机钥匙串，不会写入配置文件。'
          : 'Key is stored in the local keychain — not written to config.',
        apiKeyStoredEnv: (envName) =>
          isChinese
            ? `当前使用环境变量 ${envName}（需在进程内导出）。`
            : `Using env var ${envName} (must be exported in the process).`,
        apiKeyPasteHint: isChinese
          ? '粘贴 API 密钥后获取模型列表或保存。密钥存入本机钥匙串，绝不写入配置文件。'
          : 'Paste your API key, then Fetch models or Save. Keys go to the local keychain — never into config files.',
        enableProvider: isChinese ? '启用此提供商' : 'Enable provider',
        providerEnabledHint: isChinese ? '已加入全局模型列表' : 'Included in the global model list',
        providerDisabledHint: isChinese
          ? '停用后其模型不可被选择'
          : 'Models cannot be selected while disabled',
        searchPlaceholder: isChinese ? '搜索提供商或模型…' : 'Search providers or models…',
        filterAll: isChinese ? '全部' : 'All',
        filterOn: isChinese ? '已启用' : 'Enabled',
        filterOff: isChinese ? '已停用' : 'Disabled',
        noProviders: isChinese ? '暂无提供商' : 'No providers',
        noMatchingProviders: isChinese
          ? '没有匹配的提供商，试试调整搜索或筛选'
          : 'No matching providers. Try adjusting search or filters.',
        addProviderHint: isChinese
          ? '支持 OpenAI、Anthropic 等常见厂商，或任意 OpenAI 兼容接口'
          : 'Supports OpenAI, Anthropic, and any OpenAI-compatible endpoint',
        statusOk: isChinese ? '正常' : 'OK',
        statusFail: isChinese ? '连接失败' : 'Connection failed',
        statusOff: isChinese ? '已停用' : 'Disabled',
        testConnection: isChinese ? '测试连接' : 'Test connection',
        testing: isChinese ? '测试中…' : 'Testing…',
        testOk: (count, duration) =>
          isChinese
            ? `已连接 · ${count} 个模型 · ${duration}ms`
            : `Connected · ${count} models · ${duration}ms`,
        saveAndAdd: isChinese ? '添加并保存' : 'Add and save',
        providerName: isChinese ? '提供商名称' : 'Provider name',
        modelsWithCount: (count) =>
          isChinese ? `${count} 个模型` : `${count} model${count === 1 ? '' : 's'}`,
        apiKeyEnvironment: isChinese ? 'API Key 环境变量名' : 'API key environment variable',
        apiKeyEnvironmentDescription: isChinese
          ? '填写环境变量名，不写入配置文件。本地无鉴权端点可留空。切勿直接粘贴原始密钥。'
          : 'Environment variable name only — never paste a raw secret. Leave empty for local no-auth endpoints.',
        keychainReference: isChinese ? '钥匙串引用（可选）' : 'Keychain reference (optional)',
        showKeychain: isChinese ? '使用钥匙串引用…' : 'Use keychain reference…',
        hideKeychain: isChinese ? '隐藏钥匙串引用' : 'Hide keychain reference',
        detect: isChinese ? '检测' : 'Test',
        detecting: isChinese ? '检测中…' : 'Testing…',
        detectOk: (count) =>
          isChinese ? `连接成功 — 发现 ${count} 个模型` : `Connected — found ${count} models`,
        detectFail: isChinese ? '连接失败' : 'Connection failed',
        keyManager: isChinese ? '密钥管理' : 'Key manager',
        keyManagerTitle: (name) => (isChinese ? `${name} API 密钥管理` : `${name} API keys`),
        keyManagerHint: isChinese
          ? '多密钥每行一个；请求使用首行。密钥存入本机钥匙串。'
          : 'One key per line; the first line is used for requests. Keys stay in the local keychain.',
        keyManagerAdd: isChinese ? '添加' : 'Add',
        requestHeaders: isChinese ? '请求头' : 'Request headers',
        requestHeadersHint: isChinese
          ? '可选。用于网关自定义请求头（如 HTTP-Referer）。不会覆盖协议鉴权头。'
          : 'Optional. Custom gateway headers (e.g. HTTP-Referer). Does not override protocol auth headers.',
        headerName: isChinese ? '名称' : 'Name',
        headerValue: isChinese ? '值' : 'Value',
        addHeader: isChinese ? '添加请求头' : 'Add header',
        apiAddress: isChinese ? 'API 地址' : 'API address',
        connectionEdit: isChinese ? '编辑连接' : 'Edit connection',
        connectionDefaultEndpoint: isChinese ? '默认地址' : 'Default endpoint',
        endpointPreview: isChinese ? '预览' : 'Preview',
        advanced: isChinese ? '高级' : 'Advanced',
        saveProvider: isChinese ? '保存' : 'Save',
        ultraThinking: isChinese ? 'Ultra 思考' : 'Ultra thinking',
        ultraThinkingDescription: isChinese
          ? '新增 Ultra 思考档位。OpenAI 兼容请求映射为 xhigh；Anthropic 兼容请求映射为 max。'
          : 'Adds the product-only Ultra stop. OpenAI-compatible requests map to xhigh; Anthropic-compatible requests map to max.',
        enableUltra: isChinese ? '启用 Ultra' : 'Enable Ultra',
        removeProviderTitle: isChinese ? '移除提供商？' : 'Remove provider?',
        removeProviderDescription: isChinese
          ? '该提供商配置将从产品配置中移除。'
          : 'The provider configuration will be removed from product config.',
        deleteProvider: isChinese ? '删除提供商' : 'Delete provider',
        modelsHeading: isChinese ? '模型服务' : 'Model providers',
        modelsEmpty: isChinese
          ? '暂无模型，获取列表或手动添加。'
          : 'No models yet. Fetch the list or add one.',
        fetchModelList: isChinese ? '获取模型列表' : 'Fetch models',
        discover: isChinese ? '发现' : 'Discover',
        addModel: isChinese ? '手动添加模型' : 'Add model manually',
        addModelTitle: isChinese ? '添加模型' : 'Add model',
        addModelAction: isChinese ? '添加模型' : 'Add model',
        modelIdPlaceholder: isChinese ? '必填，例如 gpt-4.1' : 'Required, e.g. gpt-4.1',
        modelNamePlaceholder: isChinese ? '例如 GPT-4.1' : 'e.g. GPT-4.1',
        modelGroupName: isChinese ? '分组名称' : 'Group name',
        modelGroupPlaceholder: isChinese ? '例如 ChatGPT' : 'e.g. ChatGPT',
        modelTooltipLabel: isChinese ? '提示信息 (Tooltip)' : 'Tooltip (Markdown)',
        modelTooltipPlaceholder: isChinese
          ? '例如：擅长代码与多步推理'
          : 'e.g. Strong at coding and multi-step reasoning',
        contextUnset: isChinese ? '未设置' : 'Context unset',
        outputUnset: isChinese ? '未设置' : 'Output unset',
        runtimeLimits: isChinese
          ? '运行时限制按模型独立配置。'
          : 'Runtime limits are explicit per model.',
        modelId: isChinese ? '模型 ID' : 'Model ID',
        modelDisplayName: isChinese ? '模型名称' : 'Model name',
        contextLimit: isChinese ? 'Context 上限' : 'Context token limit',
        outputLimit: isChinese ? '最大输出' : 'Max output tokens',
        tooltipMarkdown: isChinese ? 'Tooltip Markdown' : 'Tooltip markdown',
        discoveryLabel: isChinese ? '获取模型列表' : 'Fetch model list',
        discoveryTitle: isChinese ? '发现模型' : 'Discover models',
        discoveryTitleFor: (name) => (isChinese ? `${name} 模型` : `${name} models`),
        discoveryDescription: isChinese
          ? '从该提供商获取模型 ID，然后为每个模型配置运行时限制。'
          : 'Fetch model IDs from this provider, then configure runtime limits per model.',
        discoveryKeyHint: isChinese
          ? '关闭后请在提供商页粘贴 API 密钥重试。本地无鉴权端点可将密钥栏留空并保存。'
          : 'Close this dialog, paste an API key on the provider form, then retry. For local no-auth endpoints, leave the key blank and save.',
        searchDiscovered: isChinese ? '搜索模型 ID 或名称' : 'Search model ID or name',
        fetching: isChinese ? '获取中…' : 'Fetching models…',
        configured: isChinese ? '已配置' : 'configured',
        new: isChinese ? '新增' : 'new',
        noMatchingModels: isChinese ? '无匹配模型。' : 'No matching models found.',
        selectedModels: (selected, newModels) =>
          isChinese
            ? newModels > 0
              ? `已选 ${selected} 个 · 新增 ${newModels} 个`
              : `已选 ${selected} 个 · 将补全已配置模型的元数据`
            : newModels > 0
              ? `${selected} selected · ${newModels} new`
              : `${selected} selected · will enrich already-configured models`,
        importSelected: isChinese ? '导入所选' : 'Import selected',
      },
      imageGeneration: {
        pageTitle: isChinese ? '图像生成' : 'Image Generation',
        pageDescription: isChinese
          ? '配置图像生成模型、接口地址与默认图片模型。'
          : 'Configure image generation models, API endpoints, and the default image model.',
        discoveryError: isChinese ? '模型发现失败。' : 'Model discovery failed.',
        provider: isChinese ? '接口通道' : 'Provider',
        apiEndpoint: isChinese ? 'API 接口地址' : 'API endpoint',
        apiKey: isChinese ? 'API Key' : 'API key',
        apiKeyStoredKeychain: '••••••••',
        apiKeyStoredEnv: (envName) => (isChinese ? `环境变量 ${envName}` : `Env var ${envName}`),
        apiKeyUnset: isChinese ? '未配置' : 'Not configured',
        requestPath: isChinese ? '自定义请求路径' : 'Custom request path',
        requestPathHint: isChinese
          ? '追加到 provider 基址的请求路径，以 / 开头。'
          : 'Request path appended to the provider base URL, starting with /.',
        timeout: isChinese ? '模型超时时间' : 'Model timeout',
        timeoutUnitSeconds: isChinese ? '秒' : 'sec',
        modelId: isChinese ? '模型 ID' : 'Model ID',
        modelLabel: isChinese ? '模型备注' : 'Model label',
        modelDescription: isChinese ? '模型介绍' : 'Model description',
        discoverModels: isChinese ? '获取模型' : 'Fetch models',
        discoveringModels: isChinese ? '获取中…' : 'Fetching…',
        setDefault: isChinese ? '设为默认图片模型' : 'Set as default image model',
        addModel: isChinese ? '添加图片模型' : 'Add image model',
        removeModel: isChinese ? '移除' : 'Remove',
        noModels: isChinese ? '尚未配置图片生成模型。' : 'No image generation models configured.',
        modelsHeading: isChinese ? '图片生成模型' : 'Image generation models',
      },
    },
  };
}

export function loadDesktopLocale(): DesktopLocale {
  try {
    const storedLocale = localStorage.getItem(DESKTOP_LOCALE_KEY);
    if (storedLocale === 'zh-CN' || storedLocale === 'en') {
      return storedLocale;
    }
  } catch {
    // Storage may be unavailable in private browsing or test environments.
  }

  return DEFAULT_DESKTOP_LOCALE;
}

export function saveDesktopLocale(locale: DesktopLocale): void {
  try {
    localStorage.setItem(DESKTOP_LOCALE_KEY, locale);
  } catch {
    // A display preference must never block rendering.
  }
}
