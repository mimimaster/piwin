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
      models: string;
      sessions: string;
      rules: string;
      skills: string;
      tools: string;
      web: string;
      extensions: string;
      prompts: string;
      automation: string;
      agents: string;
      pets: string;
    };
    provider: {
      search: string;
      configuredHeading: string;
      empty: string;
      addProvider: string;
      addProviderTitle: string;
      providerNameField: string;
      providerNamePlaceholder: string;
      providerTypeField: string;
      default: string;
      models: (count: number) => string;
      selectOrAdd: string;
      keysDescription: string;
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
  };
};

const COPY_BY_LOCALE: Record<DesktopLocale, DesktopCopy> = {
  'zh-CN': {
    settings: '设置',
    general: '通用',
    advanced: '高级',
    language: '语言',
    languageDescription: '更改 piwin Desktop 的界面语言。',
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
    offline: 'piwin 未连接',
    betaFeature: 'Beta 功能',
    knowledgeCenter: '知识中心',
  },
  en: {
    settings: 'Settings',
    general: 'General',
    advanced: 'Advanced',
    language: 'Language',
    languageDescription: 'Change the display language for piwin Desktop.',
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
      confirm: isChinese ? '确认' : 'Confirm',
      delete: isChinese ? '删除' : 'Delete',
      disable: isChinese ? '停用' : 'Disable',
      enable: isChinese ? '启用' : 'Enable',
      install: isChinese ? '安装' : 'Install',
      loading: isChinese ? '加载中…' : 'Loading…',
      refresh: isChinese ? '刷新' : 'Refresh',
      remove: isChinese ? '移除' : 'Remove',
      save: isChinese ? '保存' : 'Save',
      saving: isChinese ? '保存中…' : 'Saving…',
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
        models: isChinese ? '模型' : 'Models',
        sessions: isChinese ? '会话' : 'Sessions',
        rules: isChinese ? '规则' : 'Rules',
        skills: 'Skills',
        tools: 'MCP',
        web: isChinese ? 'Web 工具' : 'Web tools',
        extensions: isChinese ? '扩展' : 'Extensions',
        prompts: isChinese ? '提示词模板' : 'Prompt templates',
        automation: isChinese ? '自动化' : 'Automation',
        agents: isChinese ? '子代理' : 'Sub-agents',
        pets: isChinese ? '伙伴' : 'Companion',
      },
      provider: {
        search: isChinese ? '搜索模型平台…' : 'Search providers…',
        configuredHeading: isChinese ? '已配置' : 'Configured',
        empty: isChinese ? '尚未配置提供商，点击下方添加。' : 'No providers yet — add one below.',
        addProvider: isChinese ? '添加' : 'Add',
        addProviderTitle: isChinese ? '添加提供商' : 'Add provider',
        providerNameField: isChinese ? '提供商名称' : 'Provider name',
        providerNamePlaceholder: isChinese ? '例如 OpenAI' : 'e.g. OpenAI',
        providerTypeField: isChinese ? '提供商类型' : 'Provider type',
        default: isChinese ? '默认' : 'Default',
        models: (count) =>
          isChinese ? `${count} 个模型` : `${count} ${count === 1 ? 'model' : 'models'}`,
        selectOrAdd: isChinese
          ? '选择左侧提供商，或点击添加。'
          : 'Select a provider on the left, or add one.',
        keysDescription: isChinese
          ? '密钥保存在环境变量或钥匙串中，绝不写入配置。'
          : 'Keys stay in env / keychain — never store raw secrets in config.',
        setDefault: isChinese ? '设为默认' : 'Set default',
        providerId: isChinese ? '提供商 ID' : 'Provider ID',
        displayName: isChinese ? '显示名称' : 'Display name',
        protocol: isChinese ? '协议' : 'Protocol',
        baseUrl: 'Base URL',
        baseUrlDescription: isChinese
          ? '用于模型发现和请求的自定义服务地址。'
          : 'Custom provider endpoint used for model discovery and requests.',
        apiKeyLabel: isChinese ? 'API 密钥' : 'API key',
        apiKeyPlaceholder: isChinese
          ? '粘贴 API 密钥（本地无密钥可留空）'
          : 'Paste API key (leave empty for local no-auth)',
        apiKeyStoredPlaceholder: isChinese
          ? '••••••••  已保存，留空保持不变'
          : '••••••••  saved — leave blank to keep',
        apiKeyStoredKeychain: isChinese
          ? '密钥已保存在本机钥匙串，不会写入配置文件。'
          : 'Key is stored in the local keychain — not written to config.',
        apiKeyStoredEnv: (envName) =>
          isChinese
            ? `当前使用环境变量 ${envName}（进程内需已导出）。`
            : `Using env var ${envName} (must be exported in the process).`,
        apiKeyPasteHint: isChinese
          ? '直接粘贴 API 密钥后点「获取模型列表」或「保存」。密钥进本机钥匙串，不会写入配置文件。'
          : 'Paste your API key, then Fetch models or Save. Keys go to the local keychain — never into config files.',
        apiKeyEnvironment: isChinese ? 'API Key 环境变量' : 'API key environment variable',
        apiKeyEnvironmentDescription: isChinese
          ? '填写环境变量名（不写入配置）。本地无密钥服务可留空。切勿粘贴原始密钥。'
          : 'Environment variable name only — never paste a raw secret. Leave empty for local no-auth endpoints.',
        keychainReference: isChinese ? '钥匙串引用（可选）' : 'Keychain reference (optional)',
        showKeychain: isChinese ? '使用钥匙串引用…' : 'Use keychain reference…',
        hideKeychain: isChinese ? '隐藏钥匙串引用' : 'Hide keychain reference',
        detect: isChinese ? '检测' : 'Test',
        detecting: isChinese ? '检测中…' : 'Testing…',
        detectOk: (count) =>
          isChinese ? `连接成功，发现 ${count} 个模型` : `Connected — found ${count} models`,
        detectFail: isChinese ? '连接失败' : 'Connection failed',
        keyManager: isChinese ? '密钥管理' : 'Key manager',
        keyManagerTitle: (name) => (isChinese ? `${name} API 密钥管理` : `${name} API keys`),
        keyManagerHint: isChinese
          ? '多个密钥每行一个；请求使用第一行。密钥存入本机钥匙串。'
          : 'One key per line; the first line is used for requests. Keys stay in the local keychain.',
        keyManagerAdd: isChinese ? '添加' : 'Add',
        requestHeaders: isChinese ? '请求头' : 'Request headers',
        requestHeadersHint: isChinese
          ? '可选。用于网关自定义头（如 HTTP-Referer）。不会覆盖协议鉴权头。'
          : 'Optional. Custom gateway headers (e.g. HTTP-Referer). Does not override protocol auth headers.',
        headerName: isChinese ? '名称' : 'Name',
        headerValue: isChinese ? '值' : 'Value',
        addHeader: isChinese ? '添加请求头' : 'Add header',
        apiAddress: isChinese ? 'API 地址' : 'API address',
        endpointPreview: isChinese ? '预览' : 'Preview',
        advanced: isChinese ? '高级' : 'Advanced',
        saveProvider: isChinese ? '保存' : 'Save',
        ultraThinking: isChinese ? 'Ultra 思考' : 'Ultra thinking',
        ultraThinkingDescription: isChinese
          ? '为产品提供 Ultra 档位。OpenAI 兼容请求映射为 xhigh；Anthropic 兼容请求映射为 max。'
          : 'Adds the product-only Ultra stop. OpenAI-compatible requests map to xhigh; Anthropic-compatible requests map to max.',
        enableUltra: isChinese ? '启用 Ultra' : 'Enable Ultra',
        removeProviderTitle: isChinese ? '移除提供商？' : 'Remove provider?',
        removeProviderDescription: isChinese
          ? '该提供商配置将从产品配置中移除。'
          : 'The provider configuration will be removed from product config.',
        deleteProvider: isChinese ? '删除提供商' : 'Delete provider',
        modelsHeading: isChinese ? '模型' : 'Models',
        modelsEmpty: isChinese
          ? '暂无模型。获取列表或手动添加。'
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
        contextUnset: isChinese ? '未设置上下文' : 'Context unset',
        outputUnset: isChinese ? '未设置输出' : 'Output unset',
        runtimeLimits: isChinese
          ? '运行时限制按模型单独设置。'
          : 'Runtime limits are explicit per model.',
        modelId: isChinese ? '模型 ID' : 'Model ID',
        modelDisplayName: isChinese ? '模型名称' : 'Model name',
        contextLimit: isChinese ? '上下文 token 上限' : 'Context token limit',
        outputLimit: isChinese ? '最大输出 token 数' : 'Max output tokens',
        tooltipMarkdown: isChinese ? '提示 Markdown' : 'Tooltip markdown',
        discoveryLabel: isChinese ? '获取模型列表' : 'Fetch model list',
        discoveryTitle: isChinese ? '发现模型' : 'Discover models',
        discoveryTitleFor: (name) => (isChinese ? `${name} 模型` : `${name} models`),
        discoveryDescription: isChinese
          ? '从该提供商获取模型 ID，然后为每个模型配置运行时限制。'
          : 'Fetch model IDs from this provider, then configure runtime limits per model.',
        discoveryKeyHint: isChinese
          ? '关闭此弹窗，在提供商页粘贴 API 密钥后重试；本地无密钥服务请把密钥栏留空并保存。'
          : 'Close this dialog, paste an API key on the provider form, then retry. For local no-auth endpoints, leave the key blank and save.',
        searchDiscovered: isChinese ? '搜索模型 ID 或名称' : 'Search model ID or name',
        fetching: isChinese ? '正在获取模型…' : 'Fetching models…',
        configured: isChinese ? '已配置' : 'configured',
        new: isChinese ? '新增' : 'new',
        noMatchingModels: isChinese ? '没有匹配的模型。' : 'No matching models found.',
        selectedModels: (selected, newModels) =>
          isChinese
            ? `已选 ${selected} 个 · 新增 ${newModels} 个`
            : `${selected} selected · ${newModels} new`,
        importSelected: isChinese ? '导入所选模型' : 'Import selected',
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
