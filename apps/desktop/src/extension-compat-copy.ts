/**
 * User-facing Pi Extension compatibility copy.
 * piwin loads extensions into the Agent Runtime; Pi TUI chrome is not bridged.
 */
export type ExtensionCompatCopy = {
  pageTitle: string;
  pageDescription: string;
  noticeTitle: string;
  body: string[];
  detailsSummary: string;
  supportedHeading: string;
  supported: string[];
  unsupportedHeading: string;
  unsupported: string[];
  privilege: string;
};

export function extensionCompatCopy(isChinese: boolean): ExtensionCompatCopy {
  if (isChinese) {
    return {
      pageTitle: 'Pi 扩展',
      pageDescription: '装进 Agent Runtime 的 TypeScript 模块，不是 Pi 终端插件。',
      noticeTitle: 'Pi 扩展只改 Agent，不改界面',
      body: [
        'piwin 把扩展加载到 Agent Runtime 里。能用：给模型加工具、拦截或改写工具调用、注入上下文，以及确认 / 选择 / 输入 / 通知。',
        '不能用：Pi 终端里的自定义界面、widget、主题、快捷键、编辑器、TUI 渲染，以及 Pi 的 /reload。这些调用会被忽略或报错，不会改 piwin 窗口。',
      ],
      detailsSummary: '支持边界',
      supportedHeading: '支持',
      supported: [
        'pi.registerTool：给模型增加可调用工具',
        'pi.on：生命周期和工具钩子（例如拦截 tool_call）',
        'ctx.ui.confirm / select / input / notify',
        '本地路径或 Git 安装；开关后在当前任务边界应用到 Agent',
      ],
      unsupportedHeading: '不支持',
      unsupported: [
        'ctx.ui.custom、widget、header / footer、状态栏',
        '主题切换、键盘快捷键、Pi CLI flag',
        '自定义 TUI 渲染（消息、工具结果、Markdown）',
        '编辑器读写、自动完成、Pi 终端专属流程（例如 !bash）',
        'Pi 原生 ctx.reload() / /reload（请用此页的应用到当前 Agent）',
        '扩展斜杠命令不会出现在输入框 / 菜单；知道命令名发给 Agent 后，Pi 仍可能执行',
      ],
      privilege: '扩展以你的系统权限运行。权限规则不是沙箱。只安装你信任的来源。',
    };
  }
  return {
    pageTitle: 'Pi Extensions',
    pageDescription: 'TypeScript modules loaded into the Agent Runtime, not Pi TUI plugins.',
    noticeTitle: 'Pi extensions change the Agent, not the UI',
    body: [
      'piwin loads extensions into the Agent Runtime. Supported: extra tools, tool-call intercepts, context injection, and confirm / select / input / notify.',
      "Not supported: Pi TUI chrome (custom components, widgets, themes, keybindings, editor, custom rendering) and Pi's /reload. Those calls are ignored or error; they do not change the piwin window.",
    ],
    detailsSummary: 'Support boundary',
    supportedHeading: 'Supported',
    supported: [
      'pi.registerTool: extra tools the model can call',
      'pi.on: lifecycle and tool hooks (including tool_call intercepts)',
      'ctx.ui.confirm / select / input / notify',
      'Install from a local path or Git; apply at the current-run boundary',
    ],
    unsupportedHeading: 'Not supported',
    unsupported: [
      'ctx.ui.custom, widgets, header / footer, status',
      'Theme switching, keyboard shortcuts, Pi CLI flags',
      'Custom TUI rendering for messages, tool results, or Markdown',
      'Editor APIs, autocomplete, Pi TUI-only flows such as !bash',
      'Native ctx.reload() / /reload (use Apply to current Agent on this page)',
      'Extension slash commands do not appear in the composer / menu; typing a known name may still reach Pi',
    ],
    privilege: 'Extensions run with your OS privileges. Permission rules are not a sandbox. Only install sources you trust.',
  };
}
