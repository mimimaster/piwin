import type { DesktopLocale } from './desktop-locale-id.js';
import type { DesktopTranslator } from './desktop-locale-translator-types.js';

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
      agent: isChinese ? '智能体' : 'Agent',
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
      notesConflict: isChinese ? '此笔记已被另一端修改' : 'Another client changed this note.',
      todoConflict: isChinese ? '待办事项已被另一端修改' : 'Another client changed these todos.',
      nav: {
        general: isChinese ? '通用与外观' : 'General & Appearance',
        notifications: isChinese ? '通知' : 'Notifications',
        models: isChinese ? '模型' : 'Models & Providers',
        oauth: isChinese ? 'OAuth 登录' : 'OAuth Login',
        hooks: isChinese ? '事件钩子' : 'Hooks',
        extensions: isChinese ? '技能与扩展' : 'Skills & Extensions',
        agent: isChinese ? '智能体策略' : 'Agent & Workflows',
        knowledge: isChinese ? '知识库' : 'Knowledge & Embeddings',
        web: isChinese ? '网页搜索' : 'Web Search & Fetch',
        codeSearch: isChinese ? '代码搜索' : 'Code Search',
        session: isChinese ? '会话' : 'Sessions & Runtime',
        permissions: isChinese ? '权限与安全' : 'Security & Permissions',
        appearance: isChinese ? '外观' : 'Appearance',
        vision: isChinese ? '视觉' : 'Vision',
        imageGeneration: isChinese ? '图像生成' : 'Image Generation',
        artifact: isChinese ? 'Artifact' : 'Artifact',
        artifactPlayground: isChinese ? 'Artifact 实验场' : 'Artifact Playground',
        sessions: isChinese ? '交付报告' : 'Walkthrough',
        coldStorage: isChinese ? '冷存储' : 'Cold storage',
        runtime: isChinese ? '会话运行时' : 'Session Runtime',
        archive: isChinese ? '归档管理' : 'Archive Management',
        rules: isChinese ? '规则' : 'Rules',
        skills: isChinese ? '技能' : 'Skills',
        tools: isChinese ? 'MCP 工具' : 'MCP',
        plugins: isChinese ? '插件' : 'Plugins',
        prompts: isChinese ? 'Prompt 模板' : 'Prompt templates',
        automation: isChinese ? '自动化' : 'Automation',
        agents: isChinese ? '子代理' : 'Sub-agents',
        agentBackends: isChinese ? '外部智能体' : 'External Agents',
        subagents: isChinese ? '子代理编排' : 'Orchestration',
        pets: isChinese ? '桌宠' : 'Companion',
        usage: isChinese ? '用量统计' : 'Usage',
        shortcuts: isChinese ? '快捷键' : 'Shortcuts',
        animations: isChinese ? '动效' : 'Animations',
      },
      web: {
        searchRoute: isChinese ? '搜索优先级' : 'Search route',
        searchRouteDescription: isChinese
          ? '一次 web_search 按顺序尝试：模型内置搜索、已启用搜索源、DuckDuckGo 兜底。成功即停。'
          : 'One web_search call tries built-in search, then your sources, then DuckDuckGo. It stops at the first success.',
        // Matches DEFAULT_SEARCH_ROUTE_POLICY ('native-first') in contracts.
        nativeSearchFirst: isChinese ? '模型内置搜索优先（默认）' : 'Native search first (default)',
        externalSearchFirst: isChinese ? '外部搜索优先' : 'External search first',
        nativeSearchOnly: isChinese ? '仅模型内置搜索' : 'Native search only',
        externalSearchOnly: isChinese ? '仅外部搜索' : 'External search only',
        previewRequestFailed: isChinese
          ? '暂时无法计算搜索优先级，已保留上一次成功的预览。'
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
          ? '多进程或容器部署时使用。填写变量名，不要粘贴密钥；填写后将改用该环境变量。'
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
        modelTooltipLabel: isChinese ? '提示信息 (Markdown)' : 'Tooltip (Markdown)',
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
        contextLimit: isChinese ? '上下文长度上限' : 'Context token limit',
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
          ? '从已勾选「图像生成」的模型中选择默认值，并在此配置协议、路径与超时。'
          : 'Pick a default from models tagged Image, and tune their API style, path, and timeout here.',
        discoveryError: isChinese ? '模型发现失败。' : 'Model discovery failed.',
        provider: isChinese ? '服务商' : 'Provider',
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
        setDefault: isChinese ? '设为默认图像模型' : 'Set as default image model',
        editRoute: isChinese ? '配置协议' : 'Edit protocol',
        saveRoute: isChinese ? '保存协议' : 'Save protocol',
        addModel: isChinese ? '保存图像模型' : 'Save image model',
        saveHint: isChinese
          ? '选中仅填入 ID，点击「保存图像模型」后才会写入配置。'
          : 'Choosing only fills the ID — click “Save image model” to write it.',
        removeModel: isChinese ? '移除' : 'Remove',
        noModels: isChinese
          ? '还没有图像生成模型。请先在「模型」中为模型启用「图像生成」。'
          : 'No image models yet. Tag a model with Image generation under Channels & chat.',
        modelsHeading: isChinese ? '图像生成模型' : 'Image generation models',
      },
      videoGeneration: {
        pageTitle: isChinese ? '视频生成' : 'Video Generation',
        pageDescription: isChinese
          ? '从已勾选「视频生成」的模型中选择默认值，并在此配置协议、路径、超时与轮询。'
          : 'Pick a default from models tagged Video, and tune their API style, path, timeout, and polling here.',
        provider: isChinese ? '服务商' : 'Provider',
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
          ? '还没有视频生成模型。请先在「模型」中为模型启用「视频生成」，并填写接口协议和请求路径。'
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

