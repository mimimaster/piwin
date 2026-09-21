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
  hostTarget: {
    title: string;
    description: string;
    endpointLabel: string;
    endpointPlaceholder: string;
    tokenLabel: string;
    tokenPlaceholder: string;
    connect: string;
    connecting: string;
    useThisMac: string;
    instanceId: (id: string) => string;
    invalidEndpoint: string;
  };
  hostGate: {
    chooserTitle: string;
    chooserDescription: string;
    chooseSidecar: string;
    chooseAttach: string;
    connectTitle: string;
    connectDescription: string;
    rootLockNote: string;
  };
  mobileAccess: {
    title: string;
    description: string;
    listenLabel: string;
    listenDescription: string;
    advertisedLabel: string;
    advertisedPlaceholder: string;
    generate: string;
    generating: string;
    copyUri: string;
    copied: string;
    devices: string;
    noDevices: string;
    revoke: string;
    lastSeen: (at: string) => string;
    sidecarOnly: string;
    invalidAdvertised: string;
    pairingExpires: (at: string) => string;
  };
  backToWorkspace: string;
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
  extensionDeploymentRolledBack: string;
  extensionDeploymentRestartRequired: string;
  extensionDeploymentSuperseded: string;
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
    images: string;
    videos: string;
    flashcards: string;
    knowledge: string;
    archived: string;
    working: string;
    backendServiceActive: string;
    waitingOnYou: string;
    completed: string;
    /** Click the green check to clear the completion attention marker. */
    dismissCompleted: string;
    dismissFailed: string;
    failedAttention: string;
    pinSession: string;
    unpinSession: string;
    restoreSession: string;
    restoreFromPack: string;
    offloaded: string;
    missingPack: string;
    deleteSessionPermanently: string;
    sessionActions: string;
    projects: string;
    noRepo: string;
    recentProjects: string;
    noRecentProjects: string;
    allProjects: string;
    projectPickerDescription: string;
    searchProjects: string;
    noMatchingProjects: string;
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
    repoWorktreeGroup: (repoName: string, worktreeCount: number) => string;
    newConversationInProject: (projectName: string) => string;
    removeProjectFromSidebar: string;
    collapseProjects: string;
    expandProjects: string;
    collapseProject: string;
    expandProject: string;
    pinned: string;
    collapsePinned: string;
    expandPinned: string;
    conversations: string;
    collapseConversations: string;
    expandConversations: string;
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
    attachmentPreparing: string;
    attachmentPreparingGif: string;
    attachmentRetry: string;
    attachmentRemove: string;
    attachmentFailedLabel: string;
    attachmentFailureConnectionHint: string;
    attachmentFailureTooLarge: string;
    attachmentFailureDialogTitle: string;
    attachmentFailureDialogBody: (count: number) => string;
    attachmentFailureRetrySend: string;
    attachmentFailureSendRest: string;
    attachmentFailureBack: string;
    attachmentRetryOnly: string;
    attachmentSendBlocked: (count: number) => string;
    attachmentRetryUnavailable: string;
    attachmentSourceMissing: string;
    attachmentUnsupportedType: (label: string) => string;
    typeYourAnswer: string;
    chooseOption: string;
    agentPlaceholder: string;
    chatPlaceholder: string;
    planPlaceholder: string;
    askPlaceholder: string;
    goalPlaceholder: string;
    attachFiles: string;
    exitAgentMode: (mode: string) => string;
    model: string;
    send: string;
    sendShortcut: string;
    sendSteerMessage: string;
    sendSteerHint: string;
    steer: string;
    steerUnavailable: string;
    queueFollowUp: string;
    queueFollowUpHint: string;
    queuedMessagesLabel: string;
    queuedTitle: string;
    queuedCount: (count: number) => string;
    queuedHint: string;
    editQueuedMessage: string;
    editQueuedMessageHint: string;
    saveQueuedMessage: string;
    cancelQueuedEdit: string;
    queuedEditingBadge: string;
    queuedEditTitle: string;
    queuedEditHint: string;
    queuedEditSaveHint: string;
    queuedEditPlaceholder: string;
    queuedMediaOnly: string;
    queuedAttachments: (count: number) => string;
    steerQueuedMessage: string;
    removeQueuedMessage: string;
    pause: string;
    pausing: string;
    continueRun: string;
    discardPause: string;
    stop: string;
    stopping: string;
    stopJob: string;
    viewJobLogsTitle: (label: string) => string;
    hostConnecting: string;
    hostStatus: (mode: string, isMock: boolean) => string;
    hostTooltip: (mode: string, isMock: boolean, ready: boolean, transport?: string) => string;
    shortcutHint: string;
    promptHistoryTitle: string;
    promptHistoryEmpty: string;
    branchUnknown: string;
    branchNotRepo: string;
    branchMenuLabel: string;
    branchLoading: string;
    branchEmpty: string;
    branchSearchPlaceholder: string;
    branchSearchEmpty: string;
    branchTooltip: (branch: string) => string;
    branchDirtyTooltip: (branch: string) => string;
    branchCheckoutTitle: string;
    branchCheckoutConfirm: (branch: string) => string;
    branchCheckoutDirtyConfirm: (branch: string) => string;
    branchCheckoutAction: string;
    branchOccupiedInWorktree: (folderName: string) => string;
    branchOccupiedConfirmTitle: string;
    branchOccupiedConfirm: (branch: string, folderName: string) => string;
    branchOccupiedAction: string;
    branchOccupiedToast: (folderName: string) => string;
    branchOccupiedUnreachable: (path: string) => string;
    branchCheckoutBlockedByLocalChanges: string;
    branchCheckoutFailed: string;
    runtimeTargetGroupLabel: string;
    runtimeLocalLabel: string;
    runtimeLocalTooltip: string;
    runtimeAttachedLabel: string;
    runtimeAttachedTooltip: (host: string | null) => string;
    runtimeAttachAction: string;
    foregroundReplaceTitle: string;
    foregroundReplaceDescription: string;
    foregroundReplaceConfirm: string;
    foregroundReplaceCancel: string;
    busyOtherClientTitle: string;
    busyOtherClient: string;
    busyQueue: string;
    busyReplace: string;
    busyDismiss: string;
    foregroundMismatchFinished: string;
    foregroundMismatchChanged: string;
    supersededByNewPrompt: string;
    sessionBodyBusy: string;
    permissionAlreadyResolved: string;
    requestDuplicateKey: string;
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
    queuedRemaining: (count: number) => string;
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
    themeLibrary: string;
    themeLibraryDescription: string;
    themeLibraryLoading: string;
    themeLibraryFallback: string;
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
    customFonts: string;
    customFontsDescription: string;
    sansFont: string;
    sansFontDescription: string;
    monoFont: string;
    monoFontDescription: string;
    serifFont: string;
    serifFontDescription: string;
    uploadFont: string;
    uploadFontHint: string;
    deleteFont: string;
    setAsSans: string;
    setAsMono: string;
    setAsSerif: string;
    uploadedFonts: string;
    noUploadedFonts: string;
    defaultFont: string;
    resetFonts: string;
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
    queuedRemaining: (count: number) => string;
  };
  settings: {
    application: string;
    agent: string;
    integrations: string;
    system: string;
    personalization: string;
    backToWorkspace: string;
    configuredLocally: string;
    remoteHostViewOnly: string;
    remoteSavedOnHost: string;
    remoteSettingsViewOnly: string;
    remoteSettingsSaveBlocked: string;
    domainConflict: string;
    notesConflict: string;
    todoConflict: string;
    nav: {
      general: string;
      notifications: string;
      models: string;
      oauth: string;
      hooks: string;
      extensions: string;
      agent: string;
      knowledge: string;
      session: string;
      permissions: string;
      appearance: string;
      vision: string;
      imageGeneration: string;
      artifact: string;
      artifactPlayground: string;
      sessions: string;
      coldStorage: string;
      runtime: string;
      archive: string;
      rules: string;
      skills: string;
      tools: string;
      web: string;
      codeSearch: string;
      plugins: string;
      prompts: string;
      automation: string;
      agents: string;
      subagents: string;
      pets: string;
      usage: string;
      shortcuts: string;
      animations: string;
    };
    web: {
      searchRoute: string;
      searchRouteDescription: string;
      nativeSearchFirst: string;
      externalSearchFirst: string;
      nativeSearchOnly: string;
      externalSearchOnly: string;
      previewRequestFailed: string;
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
      apiKeyEnvironment: string;
      apiKeyEnvironmentDescription: string;
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
      nativeSearch: string;
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
      editRoute: string;
      saveRoute: string;
      addModel: string;
      saveHint: string;
      removeModel: string;
      noModels: string;
      discoveryError: string;
      modelsHeading: string;
    };
    videoGeneration: {
      pageTitle: string;
      pageDescription: string;
      provider: string;
      apiEndpoint: string;
      apiKey: string;
      apiKeyStoredKeychain: string;
      apiKeyStoredEnv: (envName: string) => string;
      apiKeyUnset: string;
      apiStyle: string;
      apiStyleHint: string;
      requestPath: string;
      requestPathHint: string;
      timeout: string;
      timeoutUnitSeconds: string;
      pollInterval: string;
      pollIntervalUnitSeconds: string;
      modelId: string;
      modelLabel: string;
      modelDescription: string;
      setDefault: string;
      editRoute: string;
      saveRoute: string;
      addModel: string;
      removeModel: string;
      noModels: string;
      modelsHeading: string;
      recognizedModels: string;
      suggestedModels: string;
      suggestionAddsVideoModel: string;
      modelSuggestPlaceholder: string;
      modelSuggestLoading: string;
      modelSuggestEmpty: string;
    };
  };
};

const COPY_BY_LOCALE: Record<DesktopLocale, DesktopCopy> = {
  'zh-CN': {
    settings: '设置',
    general: '通用',
    advanced: '高级',
    language: '语言',
    languageDescription: '',
    chinese: '简体中文',
    english: 'English',
    hostTarget: {
      title: '远程 Host',
      description: '连接到一台独立运行的 Host。清空后使用本机 sidecar。',
      endpointLabel: 'WebSocket 地址',
      endpointPlaceholder: 'ws://127.0.0.1:8787',
      tokenLabel: 'Token',
      tokenPlaceholder: '未配置访问密码/Token 时可留空',
      connect: '连接',
      connecting: '正在连接…',
      useThisMac: '使用本机',
      instanceId: (id) => `hostInstanceId：${id}`,
      invalidEndpoint: '请输入 ws:// 或 wss:// 地址',
    },
    hostGate: {
      chooserTitle: '选择 Host',
      chooserDescription: '用本机内置服务，或连接已在运行的独立 Host。',
      chooseSidecar: '使用本机',
      chooseAttach: '连接已有 Host',
      connectTitle: '连接 Host',
      connectDescription: '先启动目标 Host，再填入地址。',
      rootLockNote: '同一数据目录只能有一个 Host 实例。',
    },
    mobileAccess: {
      title: '手机接入',
      description: '让本机 sidecar 监听配对。远程 Host 不能打开这个开关；手机必须连到这个进程。',
      listenLabel: '允许手机接入',
      listenDescription: '绑定 127.0.0.1:8787。移动设备请使用 Tailscale 或 SSH 隧道转发该端口。',
      advertisedLabel: '手机可达地址',
      advertisedPlaceholder: 'ws://127.0.0.1:8787 或 wss://mac.tailnet.ts.net:8787',
      generate: '生成配对码',
      generating: '正在生成…',
      copyUri: '复制 URI',
      copied: '已复制',
      devices: '已配对设备',
      noDevices: '还没有配对设备',
      revoke: '撤销',
      lastSeen: (at) => `最后活跃：${at}`,
      sidecarOnly: '手机接入只在本机 sidecar 上可用。请先点「使用本机」。',
      invalidAdvertised: '请输入 ws:// 或 wss:// 地址',
      pairingExpires: (at) => `配对码有效至 ${at}`,
    },
    backToWorkspace: '返回工作区',
    configurationRoot: '配置根目录',
    savedLocally: '已保存在本地',
    workspace: '工作区',
    sessions: '会话',
    newSession: 'New Agent',
    searchSessions: '搜索',
    close: '关闭',
    ready: 'piwin 就绪',
    offline: 'piwin 已断开',
    betaFeature: 'Beta 功能',
    knowledgeCenter: '知识中心',
    extensionDeploymentRolledBack: '扩展部署已回滚。',
    extensionDeploymentRestartRequired: '扩展部署已保存，但需重启 Host 后才能完全生效。',
    extensionDeploymentSuperseded: '该次扩展部署已被更新的扩展配置覆盖。',
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
      images: '图片',
      videos: '视频',
      flashcards: '闪卡',
      knowledge: '知识中心',
      archived: '已归档',
      working: '会话正在工作',
      backendServiceActive: '后台服务运行中',
      waitingOnYou: '等待你的确认',
      completed: '会话已完成',
      dismissCompleted: '会话已完成 · 点击确认',
      dismissFailed: '关闭失败提示',
      failedAttention: '会话运行失败',
      pinSession: '置顶会话',
      unpinSession: '取消置顶',
      restoreSession: '恢复会话',
      restoreFromPack: '从包恢复…',
      offloaded: '已转储',
      missingPack: '包缺失',
      deleteSessionPermanently: '永久删除会话',
      sessionActions: '会话操作',
      projects: '项目',
      noRepo: 'No Repo',
      recentProjects: '最近项目',
      noRecentProjects: '暂无最近项目',
      allProjects: '全部项目',
      projectPickerDescription: '搜索并切换到最近打开的项目。',
      searchProjects: '搜索项目',
      noMatchingProjects: '没有匹配的项目',
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
      repoWorktreeGroup: (repoName, worktreeCount) =>
        `${repoName}（仓库 · ${worktreeCount} 个 worktree）`,
      newConversationInProject: (projectName) => `在 ${projectName} 中新建会话`,
      removeProjectFromSidebar: '从侧栏移除项目',
      collapseProjects: '收起项目列表',
      expandProjects: '展开项目列表',
      collapseProject: '收起项目',
      expandProject: '展开项目',
      pinned: '置顶',
      collapsePinned: '收起置顶列表',
      expandPinned: '展开置顶列表',
      conversations: '对话',
      collapseConversations: '收起会话列表',
      expandConversations: '展开会话列表',
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
      attachmentPreparing: '准备中…',
      attachmentPreparingGif: '提取 GIF 首帧…',
      attachmentRetry: '重试',
      attachmentRemove: '移除',
      attachmentFailedLabel: '保存失败',
      attachmentFailureConnectionHint: 'Host 连接失败',
      attachmentFailureTooLarge: '图片太大，无法保存。请使用 10MB 以内的截图。',
      attachmentFailureDialogTitle: '部分附件保存失败',
      attachmentFailureDialogBody: (count) =>
        `${count} 个附件未能保存。可以重试，或不带失败附件发送其余内容。`,
      attachmentFailureRetrySend: '重试并发送',
      attachmentFailureSendRest: '仅发送其余内容',
      attachmentFailureBack: '返回',
      attachmentRetryOnly: '重试附件',
      attachmentSendBlocked: (count) =>
        count === 1
          ? '1 个附件保存失败——请重试或移除后再发送。'
          : `${count} 个附件保存失败——请重试或移除后再发送。`,
      attachmentRetryUnavailable: '无法重试该附件——请移除后重新添加。',
      attachmentSourceMissing: '附件已不可用——请移除后重新添加。',
      attachmentUnsupportedType: (label) => `不支持的附件类型: ${label}`,
      typeYourAnswer: '输入你的回答',
      chooseOption: '选择上方选项以继续',
      agentPlaceholder: '规划、搜索或构建任何内容',
      chatPlaceholder: '问任何问题，或粘贴内容开始对话…',
      planPlaceholder: '描述你希望制定的计划…',
      askPlaceholder: '询问有关此项目的任何问题…',
      goalPlaceholder: '设定目标与验收标准并自主运行…',
      attachFiles: '添加文件和上下文',
      exitAgentMode: (mode) => `退出 ${mode} 模式`,
      model: '模型',
      send: '发送',
      sendShortcut: '发送 (Enter)',
      sendSteerMessage: '调整当前任务',
      sendSteerHint: '当前步骤完成后调整方向 (⌘↵)',
      steer: '调整',
      steerUnavailable: '当前没有可调整的运行。等生成开始后再试。',
      queueFollowUp: '加入后续队列',
      queueFollowUpHint: '加入下一轮 (Enter) · 当前步骤后调整方向 (⌘↵)',
      queuedMessagesLabel: '后续消息队列',
      queuedTitle: '接下来',
      queuedCount: (count) => `${count} 条等待中`,
      queuedHint: '当前任务结束后依次发送 · ⌘↵ 改为当前步骤后调整',
      editQueuedMessage: '编辑后续消息',
      editQueuedMessageHint: '在下方输入框中编辑（可增删图片）',
      saveQueuedMessage: '保存修改',
      cancelQueuedEdit: '取消编辑',
      queuedEditingBadge: '编辑中',
      queuedEditTitle: '编辑后续消息',
      queuedEditHint: '改文字、加图片 · ↵ 保存 · Esc 取消',
      queuedEditSaveHint: '保存回队列 (Enter)',
      queuedEditPlaceholder: '修改这条后续消息，或粘贴图片…',
      queuedMediaOnly: '（仅附件）',
      queuedAttachments: (count) => `${count} 个附件`,
      steerQueuedMessage: '改为调整当前任务（当前步骤完成后应用）',
      removeQueuedMessage: '移除后续消息',
      pause: '暂停',
      pausing: '正在暂停…',
      continueRun: '继续运行',
      discardPause: '放弃恢复',
      stop: '停止',
      stopping: '正在停止…',
      stopJob: '停止程序',
      viewJobLogsTitle: (label) => `查看「${label}」日志`,
      hostConnecting: 'Host：正在连接…',
      hostStatus: (mode, isMock) => `Host：${mode}${isMock ? '（模拟）' : ''}`,
      hostTooltip: (mode, isMock, ready, transport) =>
        `Host 模式：${mode}${isMock ? '（模拟）' : '（实时）'}｜状态：${ready ? '就绪' : '正在连接'}${transport ? `｜传输：${transport}` : ''}`,
      shortcutHint: '↵ 发送 · ⇧↵ 换行 · / 命令 · @ 提及 · ↑/↓ 历史 · Esc 停止',
      promptHistoryTitle: '最近 10 条发送记录',
      promptHistoryEmpty: '暂无历史发送记录',
      branchUnknown: '分支',
      branchNotRepo: '当前项目不是 git 仓库',
      branchMenuLabel: '切换分支',
      branchLoading: '加载分支…',
      branchEmpty: '没有本地分支',
      branchSearchPlaceholder: '搜索分支…',
      branchSearchEmpty: '没有匹配的分支',
      branchTooltip: (branch) => `当前分支：${branch}`,
      branchDirtyTooltip: (branch) => `当前分支：${branch}（有未提交更改）`,
      branchCheckoutTitle: '切换分支',
      branchCheckoutConfirm: (branch) => `切换到「${branch}」？`,
      branchCheckoutDirtyConfirm: (branch) =>
        `工作区有未提交更改。仍要切换到「${branch}」吗？若有冲突，git 可能会拒绝切换。`,
      branchCheckoutAction: '切换',
      branchOccupiedInWorktree: (folderName) => `已在 ${folderName}`,
      branchOccupiedConfirmTitle: '去那里工作',
      branchOccupiedConfirm: (branch, folderName) =>
        `「${branch}」已在工作区「${folderName}」检出。打开那个工作区继续？`,
      branchOccupiedAction: '去那里工作',
      branchOccupiedToast: (folderName) => `该分支已在工作区「${folderName}」检出`,
      branchOccupiedUnreachable: (path) => `该工作区路径不可用：${path}`,
      branchCheckoutBlockedByLocalChanges:
        '工作区有未提交更改，无法切换分支。请先提交或贮藏后再试。',
      branchCheckoutFailed: '无法切换分支。',
      runtimeTargetGroupLabel: '运行位置',
      runtimeLocalLabel: '本机',
      runtimeLocalTooltip: '在本机运行（This Mac）',
      runtimeAttachedLabel: '已连接的 Host',
      runtimeAttachedTooltip: (host) =>
        host ? `会话在 ${host} 的 Host 上运行` : '会话在已连接的 Host 上运行',
      runtimeAttachAction: '连接已有 Host',
      foregroundReplaceTitle: '会话正在处理',
      foregroundReplaceDescription: '另一端正在处理这个会话，发送会中断当前任务',
      foregroundReplaceConfirm: '中断并发送',
      foregroundReplaceCancel: '取消',
      busyOtherClientTitle: '另一端正在处理',
      busyOtherClient: '这个会话已经有任务在跑。可以排队、中断后发送，或取消。',
      busyQueue: '排队',
      busyReplace: '中断并发送',
      busyDismiss: '取消',
      foregroundMismatchFinished: '当前任务已经结束，请再发送一次',
      foregroundMismatchChanged: '会话任务已切换，请再发送一次',
      supersededByNewPrompt: '任务被另一台设备发送的新消息中断',
      sessionBodyBusy: '这个会话正在整理或删除，请稍后再发',
      permissionAlreadyResolved: '这条权限已经在另一端处理过了',
      requestDuplicateKey: '这次操作的幂等键和内容对不上，不要盲目重试',
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
      queuedRemaining: (count) => `还有 ${count} 条待审批`,
    },
    appearance: {
      pageTitle: '外观',
      pageDescription: '配置 Agent 的视觉主题和显示偏好。',
      chatSettings: '聊天显示',
      chatSettingsDescription: '',
      verboseAgentChat: '完整思考过程',
      verboseAgentChatDescription: '关闭仅隐藏显示，不删除记录。',
      conversationWidth: '对话宽度',
      conversationWidthDescription: '',
      default: '默认',
      narrow: '紧凑',
      wide: '宽松',
      appearance: '色彩模式',
      appearanceDescription: '',
      system: '跟随系统',
      light: '浅色',
      dark: '深色',
      lightTheme: '浅色主题',
      darkTheme: '深色主题',
      themeLibrary: '主题包',
      themeLibraryDescription: '壁纸等资产可选，可随时移除。',
      themeLibraryLoading: '正在加载主题…',
      themeLibraryFallback: '若自定义图片资源不可用，将自动使用基础主题配色。',
      preset: '预设',
      background: '背景色',
      foreground: '前景色',
      accent: '强调色',
      typography: '字体与排印',
      typographyDescription: '',
      assistantTextSize: '助手文本大小',
      assistantTextSizeDescription: '',
      small: '小',
      large: '大',
      codeBlockSize: '代码块大小',
      codeBlockSizeDescription: '',
      codeWrap: '代码自动换行',
      codeWrapDescription: '',
      customFonts: '自定义字体',
      customFontsDescription: '支持上传本地 TTF/OTF/WOFF/WOFF2 字体文件并配置为系统字体。',
      sansFont: '界面字体 (Sans)',
      sansFontDescription: '应用主体界面与助手对话使用的字体。',
      monoFont: '代码/等宽字体 (Mono)',
      monoFontDescription: '代码块、命令行与检查器使用的等宽字体。',
      serifFont: '衬线字体 (Serif)',
      serifFontDescription: '卡片标题、知识库与排版展示使用的衬线字体。',
      uploadFont: '上传字体',
      uploadFontHint: '支持 .ttf, .otf, .woff, .woff2 文件',
      deleteFont: '删除',
      setAsSans: '设为界面字体',
      setAsMono: '设为代码字体',
      setAsSerif: '设为衬线字体',
      uploadedFonts: '已上传的字体',
      noUploadedFonts: '暂无上传的字体，点击上方按钮上传本地字体文件。',
      defaultFont: '默认字体',
      resetFonts: '恢复默认字体',
      interactionRendering: '交互与渲染',
      interactionRenderingDescription: '',
      toolCallDensity: '工具调用显示密度',
      toolCallDensityDescription: '',
      compact: '紧凑',
      comfortable: '适中',
      detailed: '详细',
      workDetailsDefault: '工作详情默认展开',
      workDetailsDefaultDescription: '',
      auto: '自动',
      always: '始终展开',
      collapsed: '默认收起',
      codeFirstMode: '代码优先',
      codeFirstModeDescription: '仅影响行内产物；画布仍在回复完成后自动展开。',
      resetDefaults: '恢复外观默认设置',
    },
  },
  en: {
    settings: 'Settings',
    general: 'General',
    advanced: 'Advanced',
    language: 'Language',
    languageDescription: '',
    chinese: 'Simplified Chinese',
    english: 'English',
    hostTarget: {
      title: 'Remote Host',
      description: 'Attach to a standalone Host. Clear the target to use this Mac’s sidecar.',
      endpointLabel: 'WebSocket URL',
      endpointPlaceholder: 'ws://127.0.0.1:8787',
      tokenLabel: 'Token',
      tokenPlaceholder: 'Leave empty if the Host has no door token',
      connect: 'Connect',
      connecting: 'Connecting…',
      useThisMac: 'Use this Mac',
      instanceId: (id) => `hostInstanceId: ${id}`,
      invalidEndpoint: 'Enter a ws:// or wss:// URL',
    },
    hostGate: {
      chooserTitle: 'Choose a Host',
      chooserDescription:
        'Use this Mac’s built-in Host, or attach to one that is already running.',
      chooseSidecar: 'Use this Mac',
      chooseAttach: 'Attach to existing Host',
      connectTitle: 'Connect to Host',
      connectDescription: 'Start the Host first, then enter its address.',
      rootLockNote: 'One data root can have only one live Host.',
    },
    mobileAccess: {
      title: 'Phone access',
      description:
        'Let this Mac’s sidecar listen for pairing. A remotely attached Host cannot open this switch; the phone must dial this process.',
      listenLabel: 'Allow phone access',
      listenDescription:
        'Binds 127.0.0.1:8787. For a physical phone, expose that port with Tailscale or an SSH tunnel.',
      advertisedLabel: 'Phone-reachable URL',
      advertisedPlaceholder: 'ws://127.0.0.1:8787 or wss://mac.tailnet.ts.net:8787',
      generate: 'Create pairing code',
      generating: 'Creating…',
      copyUri: 'Copy URI',
      copied: 'Copied',
      devices: 'Paired devices',
      noDevices: 'No paired devices yet',
      revoke: 'Revoke',
      lastSeen: (at) => `Last seen: ${at}`,
      sidecarOnly:
        'Phone access is only available on this Mac’s sidecar. Choose “Use this Mac” first.',
      invalidAdvertised: 'Enter a ws:// or wss:// URL',
      pairingExpires: (at) => `Pairing code expires ${at}`,
    },
    backToWorkspace: 'Back to workspace',
    configurationRoot: 'Configuration root',
    savedLocally: 'Saved locally',
    workspace: 'Workspace',
    sessions: 'Sessions',
    newSession: 'New Agent',
    searchSessions: 'Search',
    close: 'Close',
    ready: 'piwin ready',
    offline: 'piwin disconnected',
    betaFeature: 'Beta feature',
    knowledgeCenter: 'Knowledge Center',
    extensionDeploymentRolledBack: 'The extension deployment has been rolled back.',
    extensionDeploymentRestartRequired:
      'The extension deployment has been saved, but the Host must be restarted before it can take full effect.',
    extensionDeploymentSuperseded:
      'This extension deployment was superseded by a newer extension configuration.',
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
      images: 'Images',
      videos: 'Videos',
      flashcards: 'Flashcards',
      knowledge: 'Knowledge',
      archived: 'Archived',
      working: 'Session is working',
      backendServiceActive: 'Backend service is active',
      waitingOnYou: 'Waiting for your confirmation',
      completed: 'Session completed',
      dismissCompleted: 'Session completed · click to dismiss',
      dismissFailed: 'Dismiss failure notice',
      failedAttention: 'Session failed',
      pinSession: 'Pin session',
      unpinSession: 'Unpin session',
      restoreSession: 'Restore session',
      restoreFromPack: 'Restore from pack…',
      offloaded: 'Offloaded',
      missingPack: 'Pack missing',
      deleteSessionPermanently: 'Delete session permanently',
      sessionActions: 'Session actions',
      projects: 'Projects',
      noRepo: 'No Repo',
      recentProjects: 'Recent projects',
      noRecentProjects: 'No recent projects',
      allProjects: 'All projects',
      projectPickerDescription: 'Search and switch to a recently opened project.',
      searchProjects: 'Search projects',
      noMatchingProjects: 'No matching projects',
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
      repoWorktreeGroup: (repoName, worktreeCount) =>
        `${repoName} (repo · ${worktreeCount} worktrees)`,
      newConversationInProject: (projectName) => `New conversation in ${projectName}`,
      removeProjectFromSidebar: 'Remove from sidebar',
      collapseProjects: 'Collapse project list',
      expandProjects: 'Expand project list',
      collapseProject: 'Collapse project',
      expandProject: 'Expand project',
      pinned: 'Pinned',
      collapsePinned: 'Collapse pinned list',
      expandPinned: 'Expand pinned list',
      conversations: 'Conversations',
      collapseConversations: 'Collapse conversation list',
      expandConversations: 'Expand conversation list',
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
      attachmentPreparing: 'Preparing…',
      attachmentPreparingGif: 'Preparing first frame…',
      attachmentRetry: 'Retry',
      attachmentRemove: 'Remove',
      attachmentFailedLabel: 'Save failed',
      attachmentFailureConnectionHint: 'Host connection failed',
      attachmentFailureTooLarge: 'Image is too large to save. Use a screenshot under 10 MB.',
      attachmentFailureDialogTitle: 'Some attachments failed to save',
      attachmentFailureDialogBody: (count) =>
        count === 1
          ? 'One attachment could not be saved. Retry it, or send the rest without it.'
          : `${count} attachments could not be saved. Retry them, or send the rest without them.`,
      attachmentFailureRetrySend: 'Retry and send',
      attachmentFailureSendRest: 'Send without them',
      attachmentFailureBack: 'Go back',
      attachmentRetryOnly: 'Retry attachments',
      attachmentSendBlocked: (count) =>
        count === 1
          ? 'One attachment failed to save — retry or remove it before sending.'
          : `${count} attachments failed to save — retry or remove them before sending.`,
      attachmentRetryUnavailable: 'Cannot retry this attachment — remove it and attach it again.',
      attachmentSourceMissing: 'Attachment is no longer available — remove it and attach it again.',
      attachmentUnsupportedType: (label) => `Unsupported attachment type: ${label}`,
      typeYourAnswer: 'Type your answer',
      chooseOption: 'Choose an option above to continue',
      agentPlaceholder: 'Plan, search, build anything',
      chatPlaceholder: 'Ask anything, or paste something to start…',
      planPlaceholder: 'Describe what you want planned…',
      askPlaceholder: 'Ask anything about this project…',
      goalPlaceholder: 'Set an objective & acceptance criteria to run autonomously…',
      attachFiles: 'Attach files, add context',
      exitAgentMode: (mode) => `Exit ${mode} mode`,
      model: 'Model',
      send: 'Send',
      sendShortcut: 'Send (Enter)',
      sendSteerMessage: 'Adjust current run',
      sendSteerHint: 'Adjust direction after the current step (⌘↵)',
      steer: 'Steer',
      steerUnavailable: 'No active run to adjust. Wait until generation starts.',
      queueFollowUp: 'Queue follow-up',
      queueFollowUpHint: 'Queue next turn (Enter) · Adjust after this step (⌘↵)',
      queuedMessagesLabel: 'Queued follow-up messages',
      queuedTitle: 'Up next',
      queuedCount: (count) => `${count} waiting`,
      queuedHint: 'Sent in order after this run · ⌘↵ to adjust after the current step',
      editQueuedMessage: 'Edit queued message',
      editQueuedMessageHint: 'Edit in the composer below (images welcome)',
      saveQueuedMessage: 'Save changes',
      cancelQueuedEdit: 'Cancel queued message edit',
      queuedEditingBadge: 'Editing',
      queuedEditTitle: 'Editing queued message',
      queuedEditHint: 'Change text, add images · ↵ save · Esc cancel',
      queuedEditSaveHint: 'Save back to the queue (Enter)',
      queuedEditPlaceholder: 'Rewrite this queued message, or paste an image…',
      queuedMediaOnly: '(attachments only)',
      queuedAttachments: (count) => `${count} attachment${count === 1 ? '' : 's'}`,
      steerQueuedMessage: 'Adjust current run after this step',
      removeQueuedMessage: 'Remove queued message',
      pause: 'Pause',
      pausing: 'Pausing…',
      continueRun: 'Continue run',
      discardPause: 'Discard pause',
      stop: 'Stop',
      stopping: 'Stopping…',
      stopJob: 'Stop program',
      viewJobLogsTitle: (label) => `View logs for ${label}`,
      hostConnecting: 'Host: Connecting…',
      hostStatus: (mode, isMock) => `Host: ${mode}${isMock ? ' (mock)' : ''}`,
      hostTooltip: (mode, isMock, ready, transport) =>
        `Host Mode: ${mode}${isMock ? ' (Mock)' : ' (Live)'} | Status: ${ready ? 'Ready' : 'Connecting'}${transport ? ` | Transport: ${transport}` : ''}`,
      shortcutHint: '↵ Send · ⇧↵ New line · / Commands · @ Mention · ↑/↓ History · Esc Stop',
      promptHistoryTitle: 'Last 10 prompts',
      promptHistoryEmpty: 'No prompt history yet',
      branchUnknown: 'branch',
      branchNotRepo: 'Not a git repository',
      branchMenuLabel: 'Switch branch',
      branchLoading: 'Loading branches…',
      branchEmpty: 'No local branches',
      branchSearchPlaceholder: 'Search branches…',
      branchSearchEmpty: 'No matching branches',
      branchTooltip: (branch) => `Current branch: ${branch}`,
      branchDirtyTooltip: (branch) => `Current branch: ${branch} (uncommitted changes)`,
      branchCheckoutTitle: 'Switch branch',
      branchCheckoutConfirm: (branch) => `Check out “${branch}”?`,
      branchCheckoutDirtyConfirm: (branch) =>
        `You have uncommitted changes. Still check out “${branch}”? Git may refuse if files conflict.`,
      branchCheckoutAction: 'Switch',
      branchOccupiedInWorktree: (folderName) => `Already in ${folderName}`,
      branchOccupiedConfirmTitle: 'Work there',
      branchOccupiedConfirm: (branch, folderName) =>
        `“${branch}” is already checked out in “${folderName}”. Open that workspace?`,
      branchOccupiedAction: 'Work there',
      branchOccupiedToast: (folderName) => `This branch is already checked out in “${folderName}”`,
      branchOccupiedUnreachable: (path) => `Workspace path is unavailable: ${path}`,
      branchCheckoutBlockedByLocalChanges:
        'Uncommitted changes would be overwritten. Commit or stash them, then try again.',
      branchCheckoutFailed: 'Could not switch branches.',
      runtimeTargetGroupLabel: 'Run location',
      runtimeLocalLabel: 'This Mac',
      runtimeLocalTooltip: 'This Mac (local)',
      runtimeAttachedLabel: 'Attached Host',
      runtimeAttachedTooltip: (host) =>
        host ? `Running on the Host at ${host}` : 'Running on an attached Host',
      runtimeAttachAction: 'Attach to existing Host',
      foregroundReplaceTitle: 'Session is busy',
      foregroundReplaceDescription:
        'Another client is working on this session. Sending will interrupt the current task.',
      foregroundReplaceConfirm: 'Interrupt and send',
      foregroundReplaceCancel: 'Cancel',
      busyOtherClientTitle: 'Another client is working',
      busyOtherClient:
        'This session already has a run. Queue your message, interrupt and send, or dismiss.',
      busyQueue: 'Queue',
      busyReplace: 'Interrupt and send',
      busyDismiss: 'Dismiss',
      foregroundMismatchFinished: 'That run already finished. Send again to start a new one.',
      foregroundMismatchChanged: 'The session run changed. Send again to start a new one.',
      supersededByNewPrompt: 'This run was interrupted by a new message from another device',
      sessionBodyBusy: 'This session is compacting or deleting. Wait, then send again.',
      permissionAlreadyResolved: 'That permission was already resolved on another client',
      requestDuplicateKey: 'This idempotency key does not match the command. Do not retry blindly.',
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
      queuedRemaining: (count) => `${count} more waiting for approval`,
    },
    appearance: {
      pageTitle: 'Appearance',
      pageDescription: "Configure the Agent's visual theme and display preferences.",
      chatSettings: 'Chat Settings',
      chatSettingsDescription: '',
      verboseAgentChat: 'Verbose Agent Chat',
      verboseAgentChatDescription: 'Off only hides them; history is kept.',
      conversationWidth: 'Conversation Width',
      conversationWidthDescription: '',
      default: 'Default',
      narrow: 'Narrow',
      wide: 'Wide',
      appearance: 'Appearance',
      appearanceDescription: '',
      system: 'System',
      light: 'Light',
      dark: 'Dark',
      lightTheme: 'Light Theme',
      darkTheme: 'Dark Theme',
      themeLibrary: 'Theme Library',
      themeLibraryDescription: 'Visual assets are optional and removable.',
      themeLibraryLoading: 'Loading themes…',
      themeLibraryFallback:
        'This theme uses token-only rendering when optional artwork is unavailable.',
      preset: 'Preset',
      background: 'Background',
      foreground: 'Foreground',
      accent: 'Accent',
      typography: 'Typography',
      typographyDescription: '',
      assistantTextSize: 'Assistant text size',
      assistantTextSizeDescription: '',
      small: 'Small',
      large: 'Large',
      codeBlockSize: 'Code block size',
      codeBlockSizeDescription: '',
      codeWrap: 'Code wrap',
      codeWrapDescription: '',
      customFonts: 'Custom Fonts',
      customFontsDescription: 'Upload local TTF/OTF/WOFF/WOFF2 fonts and assign them to font families.',
      sansFont: 'Interface Font (Sans)',
      sansFontDescription: 'Font used for assistant chat and main application UI.',
      monoFont: 'Code Font (Mono)',
      monoFontDescription: 'Monospace font used for code blocks, terminal, and inspector.',
      serifFont: 'Serif Font',
      serifFontDescription: 'Serif font used for headings, wiki articles, and cards.',
      uploadFont: 'Upload Font',
      uploadFontHint: 'Supports .ttf, .otf, .woff, .woff2 files',
      deleteFont: 'Delete',
      setAsSans: 'Set as Sans',
      setAsMono: 'Set as Mono',
      setAsSerif: 'Set as Serif',
      uploadedFonts: 'Uploaded Fonts',
      noUploadedFonts: 'No uploaded fonts yet. Click above to upload local font files.',
      defaultFont: 'Default Font',
      resetFonts: 'Reset to default fonts',
      interactionRendering: 'Interaction & Rendering',
      interactionRenderingDescription: '',
      toolCallDensity: 'Tool call density',
      toolCallDensityDescription: '',
      compact: 'Compact',
      comfortable: 'Comfortable',
      detailed: 'Detailed',
      workDetailsDefault: 'Work details default',
      workDetailsDefaultDescription: '',
      auto: 'Auto',
      always: 'Always',
      collapsed: 'Collapsed',
      codeFirstMode: 'Code-first mode',
      codeFirstModeDescription:
        'Inline artifacts only; explicit Canvas still auto-opens when the reply completes.',
      resetDefaults: 'Reset Appearance defaults',
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
      queuedRemaining: (count) =>
        isChinese ? `还有 ${count} 条待审批` : `${count} more waiting for approval`,
    },
    settings: {
      application: isChinese ? '应用' : 'Application',
      agent: 'Agent',
      integrations: isChinese ? '集成' : 'Integrations',
      system: isChinese ? '系统' : 'System',
      personalization: isChinese ? '个性化' : 'Personalization',
      backToWorkspace: isChinese ? '返回工作区' : 'Back to workspace',
      configuredLocally: isChinese ? '已保存在本地' : 'Saved locally',
      remoteHostViewOnly: isChinese ? '远程 Host · 只读' : 'Remote Host · View only',
      remoteSavedOnHost: isChinese ? '已保存到 Host' : 'Saved on Host',
      remoteSettingsViewOnly: isChinese
        ? '当前 Host 未开启远程配置修改权限。请连接具备写权限的 Host。'
        : 'This Host is not accepting remote settings writes. Connect to a Host that does.',
      remoteSettingsSaveBlocked: isChinese
        ? '当前 Host 未开启远程配置修改权限。'
        : 'This Host is not accepting remote settings writes.',
      domainConflict: isChinese
        ? '这部分设置已被另一端改过，请先重新加载再保存'
        : 'Another client changed this settings page. Reload it before saving again.',
      notesConflict: isChinese ? '这条笔记已被另一端改过' : 'Another client changed this note.',
      todoConflict: isChinese ? '待办已被另一端改过' : 'Another client changed these todos.',
      nav: {
        general: isChinese ? '通用与外观' : 'General & Appearance',
        notifications: isChinese ? '通知' : 'Notifications',
        models: isChinese ? '模型' : 'Models & Providers',
        oauth: isChinese ? 'OAuth 登录' : 'OAuth Login',
        hooks: 'Hooks',
        extensions: isChinese ? '技能与扩展' : 'Skills & Extensions',
        agent: isChinese ? '智能体策略' : 'Agent & Workflows',
        knowledge: isChinese ? '知识库' : 'Knowledge & Embeddings',
        web: isChinese ? '搜索与抓取' : 'Web Search & Fetch',
        codeSearch: isChinese ? '代码搜索' : 'Code Search',
        session: isChinese ? '会话' : 'Sessions & Runtime',
        permissions: isChinese ? '权限与安全' : 'Security & Permissions',
        appearance: isChinese ? '外观' : 'Appearance',
        vision: isChinese ? '视觉' : 'Vision',
        imageGeneration: isChinese ? '图像生成' : 'Image Generation',
        artifact: isChinese ? 'Artifact' : 'Artifact',
        artifactPlayground: isChinese ? 'Artifact 实验场' : 'Artifact Playground',
        sessions: 'Walkthrough',
        coldStorage: isChinese ? '冷存储' : 'Cold storage',
        runtime: isChinese ? '会话运行时' : 'Session Runtime',
        archive: isChinese ? '归档管理' : 'Archive Management',
        rules: isChinese ? '规则' : 'Rules',
        skills: 'Skills',
        tools: 'MCP',
        plugins: isChinese ? '插件' : 'Plugins',
        prompts: isChinese ? 'Prompt 模板' : 'Prompt templates',
        automation: isChinese ? '自动化' : 'Automation',
        agents: isChinese ? 'Agent' : 'Sub-agents',
        subagents: isChinese ? '子代理编排' : 'Orchestration',
        pets: isChinese ? '宠物' : 'Companion',
        usage: isChinese ? '用量统计' : 'Usage',
        shortcuts: isChinese ? '快捷键' : 'Shortcuts',
        animations: isChinese ? '动效' : 'Animations',
      },
      web: {
        searchRoute: isChinese ? '搜索路由' : 'Search route',
        searchRouteDescription: isChinese
          ? '每次请求仅使用一种搜索渠道；若失败不会静默切换至其他渠道重试。'
          : 'Each generation uses one search outlet; a completed or failed request is never silently retried through the other outlet.',
        nativeSearchFirst: isChinese ? '模型内置搜索优先' : 'Native search first',
        externalSearchFirst: isChinese ? '外部搜索优先（默认）' : 'External search first (default)',
        nativeSearchOnly: isChinese ? '仅模型内置搜索' : 'Native search only',
        externalSearchOnly: isChinese ? '仅外部搜索' : 'External search only',
        previewRequestFailed: isChinese
          ? '暂时无法计算搜索路由，已保留上一次成功的预览。'
          : 'Could not resolve the search route right now; the last successful preview is still shown.',
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
          ? '密钥保存在 Host（钥匙串或 Host 密钥库），绝不写入配置文件。'
          : 'Keys stay on the Host — never store raw secrets in config.',
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
          ? '密钥已保存在 Host，不会写入配置文件。新填的 Key 会更新到 Host。'
          : 'Key is stored on the Host — not written to config. Paste a new key to update it.',
        apiKeyStoredEnv: (envName) =>
          isChinese
            ? `当前使用环境变量 ${envName}（需在进程内导出）。`
            : `Using env var ${envName} (must be exported in the process).`,
        apiKeyEnvironment: isChinese ? 'API Key 环境变量名' : 'API key environment variable',
        apiKeyEnvironmentDescription: isChinese
          ? 'RPC/Worker 模式使用。填写变量名，不要粘贴密钥；填写后将改用该环境变量。'
          : 'For RPC/Worker mode. Enter the variable name, not the secret; setting it switches this provider to env auth.',
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
        discover: isChinese ? '拉取模型' : 'Fetch models',
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
        nativeSearch: isChinese ? '模型内置搜索' : 'Native search',
        contextLimit: isChinese ? 'Context 上限' : 'Context token limit',
        outputLimit: isChinese ? '最大输出' : 'Max output tokens',
        tooltipMarkdown: isChinese ? 'Tooltip Markdown' : 'Tooltip markdown',
        discoveryLabel: isChinese ? '获取模型列表' : 'Fetch model list',
        discoveryTitle: isChinese ? '拉取可用模型' : 'Fetch available models',
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
          ? '从已勾选「生图」的模型里选默认值，并在这里调协议、路径和超时。'
          : 'Pick a default from models tagged Image, and tune their API style, path, and timeout here.',
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
        editRoute: isChinese ? '配置协议' : 'Edit protocol',
        saveRoute: isChinese ? '保存协议' : 'Save protocol',
        addModel: isChinese ? '保存图片模型' : 'Save image model',
        saveHint: isChinese
          ? '选中只是填入 ID，要点「保存图片模型」才写入配置。'
          : 'Choosing only fills the ID — click “Save image model” to write it.',
        removeModel: isChinese ? '移除' : 'Remove',
        noModels: isChinese
          ? '还没有生图模型。先到「模型配置」给模型勾上「生图」。'
          : 'No image models yet. Tag a model with Image generation under Channels & chat.',
        modelsHeading: isChinese ? '图片生成模型' : 'Image generation models',
      },
      videoGeneration: {
        pageTitle: isChinese ? '视频生成' : 'Video Generation',
        pageDescription: isChinese
          ? '从已勾选「视频」的模型里选默认值，并在这里调协议、路径、超时和轮询。'
          : 'Pick a default from models tagged Video, and tune their API style, path, timeout, and polling here.',
        provider: isChinese ? '接口通道' : 'Provider',
        apiEndpoint: isChinese ? 'API 接口地址' : 'API endpoint',
        apiKey: isChinese ? 'API Key' : 'API key',
        apiKeyStoredKeychain: '••••••••',
        apiKeyStoredEnv: (envName) => (isChinese ? `环境变量 ${envName}` : `Env var ${envName}`),
        apiKeyUnset: isChinese ? '未配置' : 'Not configured',
        apiStyle: isChinese ? 'API 格式' : 'API style',
        apiStyleHint: isChinese
          ? '选择厂商的异步任务协议；实际请求由 Host adapter 处理。'
          : 'Select the vendor async-task protocol; the Host adapter handles the wire format.',
        requestPath: isChinese ? '创建任务路径' : 'Create-task path',
        requestPathHint: isChinese
          ? '追加到 provider 基址的创建任务路径，以 / 开头。'
          : 'Create-task path appended to the provider base URL, starting with /.',
        timeout: isChinese ? '任务超时时间' : 'Job timeout',
        timeoutUnitSeconds: isChinese ? '秒' : 'sec',
        pollInterval: isChinese ? '轮询间隔' : 'Poll interval',
        pollIntervalUnitSeconds: isChinese ? '秒' : 'sec',
        modelId: isChinese ? '模型 ID' : 'Model ID',
        modelLabel: isChinese ? '模型备注' : 'Model label',
        modelDescription: isChinese ? '模型介绍' : 'Model description',
        setDefault: isChinese ? '设为默认视频模型' : 'Set as default video model',
        editRoute: isChinese ? '配置协议' : 'Edit protocol',
        saveRoute: isChinese ? '保存协议' : 'Save protocol',
        addModel: isChinese ? '添加视频模型' : 'Add video model',
        removeModel: isChinese ? '移除' : 'Remove',
        noModels: isChinese
          ? '还没有视频模型。请先在「模型配置」里给对应模型勾选「视频」，并填写接口协议和请求路径。'
          : 'No video models yet. Tag a model with Video generation under Channels & chat, and set its API style and request path.',
        modelsHeading: isChinese ? '视频生成模型' : 'Video generation models',
        recognizedModels: isChinese ? '自动识别' : 'Recognized',
        suggestedModels: isChinese ? '建议' : 'Suggested',
        suggestionAddsVideoModel: isChinese
          ? '选择后会加入视频模型'
          : 'Selecting adds it to video models',
        modelSuggestPlaceholder: isChinese
          ? '输入模型 ID，或从发现结果中选择'
          : 'Enter a model ID, or choose from discovered models',
        modelSuggestLoading: isChinese ? '正在发现视频模型…' : 'Discovering video models…',
        modelSuggestEmpty: isChinese
          ? '未发现可识别或建议的视频模型，可直接输入任意模型 ID。'
          : 'No recognized or suggested video models. You can enter any model ID.',
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
