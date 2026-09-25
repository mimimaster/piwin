<script setup lang="ts">
import { ref, onMounted } from 'vue';

type DetectedOs = 'macos' | 'windows' | 'ios' | 'other';

const currentOs = ref<DetectedOs>('macos');
const copiedText = ref<string | null>(null);

onMounted(() => {
  if (typeof window !== 'undefined' && window.navigator) {
    const ua = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) {
      currentOs.value = 'ios';
    } else if (/win/.test(ua)) {
      currentOs.value = 'windows';
    } else if (/mac/.test(ua)) {
      currentOs.value = 'macos';
    } else {
      currentOs.value = 'other';
    }
  }
});

function copyToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      copiedText.value = text;
      setTimeout(() => {
        if (copiedText.value === text) {
          copiedText.value = null;
        }
      }, 2000);
    });
  }
}

const releasesUrl = 'https://github.com/mimimaster/piwin/releases';
const latestReleaseUrl = 'https://github.com/mimimaster/piwin/releases/latest';
const webview2Url = 'https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/';

interface FaqItem {
  question: string;
  answer: string;
}

const faqs: readonly FaqItem[] = [
  {
    question: 'macOS 首次打开提示“无法打开‘Piwin’，因为无法验证开发者”或“已损坏”？',
    answer:
      '这是由于 macOS Gatekeeper（门禁）对未在 Mac App Store 上架的开源自编译应用的默认安全拦截策略。你只需打开「终端 (Terminal)」应用，运行命令：xattr -cr /Applications/Piwin.app（页面上方提供了一键复制），清除隔离属性后即可正常双击启动。或者前往「系统设置」→「隐私与安全性」，在下方点击「仍要打开」。',
  },
  {
    question: 'Windows 启动时提示缺失 WebView2 Runtime 怎么办？',
    answer:
      'Piwin Windows 客户端基于微软 WebView2 内核提供极致轻量化渲染。Windows 11 系统出厂已默认内置该组件；部分精简版或 Windows 10 用户如遇提示缺失或启动白屏，请点击上方卡片中的「WebView2 运行时」官方链接下载 Evergreen Bootstrapper 独立安装包，安装仅需几秒即可恢复正常。',
  },
  {
    question: 'iOS 移动端何时上线？是否会有 Android（安卓）支持？',
    answer:
      'iOS 移动伴侣目前处于重点研发与封闭内测阶段，主要功能包括随身任务进度查看、关键指令安全授权与长任务推送。我们后续将优先通过 Apple TestFlight 开启公开测试邀请。Android 端规划在 iOS 稳定推出后视社区反馈推进，当前在手机或平板上可直接使用手机浏览器连接远端 Host 的 Web 端体验。',
  },
  {
    question: '桌面一体包与独立部署 Host 有何区别？',
    answer:
      '桌面一体包（macOS .dmg / Windows 安装包）内部已经集成了所有核心运行时环境（内置 Node 与轻量 Host Sidecar），双击即用，无需配置复杂的后台服务。如果你有性能强劲的云服务器、家用台式机或 NAS，也可以通过单独运行 Host 常驻后台，在外使用轻量薄壳模式或移动端随时接入。',
  },
  {
    question: '如何获取后续更新或版本升级？',
    answer:
      'Piwin 客户端已内置安全检查更新能力，当有新版本发布时会在设置面板给予提示；你也可以随时关注本站下载页或 GitHub Releases 页面下载最新安装包覆盖安装，所有配置与项目工作区都会安全保留。',
  },
];
</script>

<template>
  <div class="download-page">
    <!-- Hero 标头 -->
    <header class="download-hero">
      <div class="hero-badge">
        <span class="hero-badge-dot"></span>
        <span>全平台客户端 · 现已开放下载</span>
      </div>
      <h1 class="serif hero-title">下载 Piwin · 砚</h1>
      <p class="hero-subtitle">
        研墨沉淀，静水流深。专为个人打造的本地优先智能编程工作台，双击即跑，开箱即用。
      </p>
      <div class="hero-meta">
        <span class="meta-tag">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.5 7.5a.5.5 0 010 1H5.707l2.147 2.146a.5.5 0 01-.708.708l-3-3a.5.5 0 010-.708l3-3a.5.5 0 11.708.708L5.707 7.5H11.5z"/>
          </svg>
          最新稳定版 v0.1.0
        </span>
        <span class="meta-tag">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8z"/>
            <path d="M8 3.5a.5.5 0 01.5.5v3.25l2.5 1.5a.5.5 0 01-.5.866l-2.75-1.65A.5.5 0 017.5 7.5V4a.5.5 0 01.5-.5z"/>
          </svg>
          2026年9月更新
        </span>
        <span class="meta-tag">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M2.5 3.5a.5.5 0 01.5-.5h10a.5.5 0 01.5.5v9a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5v-9zM3 4v8h10V4H3z"/>
          </svg>
          双核驱动：Pi 内核 + Tauri 2
        </span>
      </div>
    </header>

    <!-- 主平台下载卡片（macOS, Windows, iOS） -->
    <section class="download-cards-grid">
      <!-- 1. macOS 卡片 -->
      <div
        class="platform-card"
        :class="{ 'card-highlight': currentOs === 'macos' }"
      >
        <div class="card-header">
          <div class="platform-icon-wrap icon-apple">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.88c.61-.74 1.02-1.77.91-2.8-.88.04-1.95.59-2.58 1.33-.55.64-1.03 1.68-.9 2.69 1 .08 2-.48 2.57-1.22z"/>
            </svg>
          </div>
          <div class="platform-header-text">
            <div class="platform-title-row">
              <h2 class="platform-name">macOS</h2>
              <span v-if="currentOs === 'macos'" class="user-os-badge">当前系统</span>
              <span v-else class="status-badge badge-official">首选推荐</span>
            </div>
            <span class="platform-version-pill">正式版 · v0.1.0 DMG</span>
          </div>
        </div>

        <!-- 版本限制说明 (强调) -->
        <div class="constraint-box">
          <div class="constraint-title">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
              <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
            </svg>
            <span>系统与版本要求 (版本限制)</span>
          </div>
          <ul class="constraint-list">
            <li><strong>最低版本要求：</strong>macOS 12.0 (Monterey) 或更高版本</li>
            <li><strong>推荐运行环境：</strong>macOS 13+ (Ventura) / 14+ (Sonoma) / 15+ (Sequoia)</li>
            <li><strong>硬件架构支持：</strong>Apple Silicon (M1/M2/M3/M4) 与 Intel 64 位芯片</li>
          </ul>
        </div>

        <!-- 下载行动区 -->
        <div class="download-action-group">
          <a
            :href="releasesUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="download-btn btn-primary"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <div class="btn-text-wrap">
              <span class="btn-title">下载 Apple Silicon 芯片版</span>
              <span class="btn-sub">M1 / M2 / M3 / M4 · aarch64.dmg</span>
            </div>
            <span class="btn-tag-accent">首选</span>
          </a>

          <a
            :href="releasesUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="download-btn btn-secondary"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <div class="btn-text-wrap">
              <span class="btn-title">下载 Intel 处理器版</span>
              <span class="btn-sub">Intel x86_64 · x64.dmg</span>
            </div>
          </a>
        </div>

        <!-- 首次安装提示 (Gatekeeper 绕过) -->
        <div class="gatekeeper-tip">
          <div class="tip-header">
            <span class="tip-dot"></span>
            <span class="tip-title">遇到“已损坏”或“无法验证开发者”提示？</span>
          </div>
          <p class="tip-desc">
            由于开源独立构建未签名认证，首次运行若受门禁拦截，请在终端执行清除隔离属性：
          </p>
          <div class="code-pill-row">
            <code>xattr -cr /Applications/Piwin.app</code>
            <button
              class="copy-pill-btn"
              type="button"
              @click="copyToClipboard('xattr -cr /Applications/Piwin.app')"
            >
              {{ copiedText === 'xattr -cr /Applications/Piwin.app' ? '已复制 ✓' : '复制命令' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 2. Windows 卡片 -->
      <div
        class="platform-card"
        :class="{ 'card-highlight': currentOs === 'windows' }"
      >
        <div class="card-header">
          <div class="platform-icon-wrap icon-windows">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4h-13.051M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.899"/>
            </svg>
          </div>
          <div class="platform-header-text">
            <div class="platform-title-row">
              <h2 class="platform-name">Windows</h2>
              <span v-if="currentOs === 'windows'" class="user-os-badge">当前系统</span>
              <span v-else class="status-badge badge-official">官方支持</span>
            </div>
            <span class="platform-version-pill">正式版 · v0.1.0 64-bit</span>
          </div>
        </div>

        <!-- 版本限制说明 (强调) -->
        <div class="constraint-box">
          <div class="constraint-title">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
              <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
            </svg>
            <span>系统与版本要求 (版本限制)</span>
          </div>
          <ul class="constraint-list">
            <li><strong>最低版本要求：</strong>Windows 10 64 位 (版本 1809 及以上)</li>
            <li><strong>推荐运行环境：</strong>Windows 11 64 位 (原生完美适配)</li>
            <li><strong>必要运行时依赖：</strong>需具备 Microsoft Edge WebView2 Runtime</li>
          </ul>
        </div>

        <!-- 下载行动区 -->
        <div class="download-action-group">
          <a
            :href="releasesUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="download-btn btn-primary"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <div class="btn-text-wrap">
              <span class="btn-title">下载 Windows 安装包 (.msi / .exe)</span>
              <span class="btn-sub">标准安装器 · 自动配置快捷方式</span>
            </div>
          </a>

          <a
            :href="releasesUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="download-btn btn-secondary"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <div class="btn-text-wrap">
              <span class="btn-title">下载 便携免安装版 (.zip)</span>
              <span class="btn-sub">解压即用 · 适合免安装运行</span>
            </div>
          </a>
        </div>

        <!-- Windows 依赖提示 -->
        <div class="gatekeeper-tip">
          <div class="tip-header">
            <span class="tip-dot tip-dot-pine"></span>
            <span class="tip-title">关于 WebView2 运行时依赖</span>
          </div>
          <p class="tip-desc">
            Windows 11 已自带该组件；若在 Windows 10 上启动提示缺失或白屏，请点击官方渠道一键安装：
          </p>
          <div class="tip-link-row">
            <a :href="webview2Url" target="_blank" rel="noopener noreferrer" class="link-with-arrow">
              前往微软官方下载 WebView2 运行时 ↗
            </a>
          </div>
        </div>
      </div>

      <!-- 3. iOS 卡片 (暂未上线) -->
      <div
        class="platform-card card-ios card-upcoming"
        :class="{ 'card-highlight-ios': currentOs === 'ios' }"
      >
        <div class="card-header">
          <div class="platform-icon-wrap icon-ios">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14zm-1-6h-3V8h-2v5H8l4 4 4-4z"/>
            </svg>
          </div>
          <div class="platform-header-text">
            <div class="platform-title-row">
              <h2 class="platform-name">iOS 移动伴侣</h2>
              <span class="status-badge badge-pending">暂未上线 · 研发中</span>
            </div>
            <span class="platform-version-pill pill-amber">TestFlight 内测筹备</span>
          </div>
        </div>

        <!-- 版本限制说明 (强调) -->
        <div class="constraint-box constraint-ios">
          <div class="constraint-title">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
              <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
            </svg>
            <span>适配系统与要求 (版本限制)</span>
          </div>
          <ul class="constraint-list">
            <li><strong>最低版本要求：</strong>iOS 16.0 及以上版本（支持 iPhone / iPad）</li>
            <li><strong>硬件设备建议：</strong>iPhone 11 及后续机型 (搭载 A13 仿生芯片及以上)</li>
            <li><strong>接入方式：</strong>配合运行中的桌面端/云端 Host 实例通过局域网或内网穿透配对</li>
          </ul>
        </div>

        <!-- 功能简介 -->
        <div class="ios-feature-capsules">
          <div class="ios-feature-item">
            <span class="ios-feature-icon">📱</span>
            <div class="ios-feature-desc">
              <b>随身任务进度看板</b>
              <span>随时随地查看桌面端 Agent 正在编写的文件与执行流程</span>
            </div>
          </div>
          <div class="ios-feature-item">
            <span class="ios-feature-icon">🛡️</span>
            <div class="ios-feature-desc">
              <b>安全拦截与一键确认</b>
              <span>高危命令或关键操作在手机上快速授权或一键驳回</span>
            </div>
          </div>
          <div class="ios-feature-item">
            <span class="ios-feature-icon">🔔</span>
            <div class="ios-feature-desc">
              <b>长程任务完工实时推送</b>
              <span>编译成功、代码重构完成或发生中断即刻振动提醒</span>
            </div>
          </div>
        </div>

        <!-- 禁用状态与通知按钮 -->
        <div class="download-action-group">
          <button type="button" disabled class="download-btn btn-disabled">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <div class="btn-text-wrap">
              <span class="btn-title">暂未上线 · 敬请期待</span>
              <span class="btn-sub">正在进行 TestFlight 审核与稳定性调优</span>
            </div>
          </button>

          <a
            href="https://github.com/mimimaster/piwin"
            target="_blank"
            rel="noopener noreferrer"
            class="download-btn btn-secondary"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
            </svg>
            <div class="btn-text-wrap">
              <span class="btn-title">Star 关注 GitHub 仓库</span>
              <span class="btn-sub">上线第一时间推送 Release 通知</span>
            </div>
            <span class="btn-arrow">↗</span>
          </a>
        </div>

        <div class="gatekeeper-tip">
          <div class="tip-header">
            <span class="tip-dot tip-dot-lamp"></span>
            <span class="tip-title">先行替代方案：Web 远端直连</span>
          </div>
          <p class="tip-desc">
            在 iOS 客户端上线前，你也可以在手机 Safari 浏览器中通过内网 IP 或 Tailscale 组网直接访问远端 Host 的 Web 端，界面完全自适应手机屏幕。
          </p>
        </div>
      </div>
    </section>

    <!-- 系统规格与版本限制全面对比表 -->
    <section class="download-matrix-section">
      <div class="section-header">
        <h2 class="serif section-title">平台版本限制与硬件要求对照</h2>
        <p class="section-desc">详细查阅不同平台下的最低系统版本、处理器架构与运行依赖：</p>
      </div>

      <div class="matrix-table-wrap">
        <table class="matrix-table">
          <thead>
            <tr>
              <th class="col-metric">指标维度</th>
              <th class="col-mac">macOS 桌面端</th>
              <th class="col-win">Windows 桌面端</th>
              <th class="col-ios">iOS 移动伴侣 (暂未上线)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="cell-label">最低操作系统版本</td>
              <td><span class="badge-req">macOS 12.0 (Monterey)</span></td>
              <td><span class="badge-req">Windows 10 64位 (1809+)</span></td>
              <td><span class="badge-pending-req">iOS 16.0 及以上 (暂未上线)</span></td>
            </tr>
            <tr>
              <td class="cell-label">推荐系统版本</td>
              <td>macOS 13+ (Ventura / Sonoma / Sequoia)</td>
              <td>Windows 11 64位 最新版本</td>
              <td>iOS 17+ / iOS 18+</td>
            </tr>
            <tr>
              <td class="cell-label">硬件架构支持</td>
              <td>Apple Silicon (aarch64) & Intel (x86_64)</td>
              <td>x86_64 处理器 (Intel / AMD)</td>
              <td>A13 仿生芯片及以上 (iPhone / iPad)</td>
            </tr>
            <tr>
              <td class="cell-label">运行内存建议</td>
              <td>8 GB 最低要求，推荐 16 GB 及以上</td>
              <td>8 GB 最低要求，推荐 16 GB 及以上</td>
              <td>4 GB 及以上运行内存</td>
            </tr>
            <tr>
              <td class="cell-label">核心环境依赖</td>
              <td>一体包内嵌完整 Node 及 Sidecar，零环境要求</td>
              <td>Microsoft Edge WebView2 Runtime</td>
              <td>需连接运行中的桌面或远端 Piwin Host</td>
            </tr>
            <tr>
              <td class="cell-label">发布状态</td>
              <td><span class="status-pill status-ready">正式版 · 可下载</span></td>
              <td><span class="status-pill status-ready">正式版 · 可下载</span></td>
              <td><span class="status-pill status-wait">研发中 · 暂未上线</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 源码构建与开发者命令行 -->
    <section class="download-cli-section">
      <div class="cli-box">
        <div class="cli-info">
          <span class="cli-badge">极客与二次开发</span>
          <h3 class="serif cli-title">偏好从源码自编译或运行 CLI？</h3>
          <p class="cli-desc">
            Piwin 完全开源，遵循清晰分层与单向依赖规范。你可以随时拉取主仓库源码，在本地快速构建或启动轻量命令行模式：
          </p>
          <div class="cli-code-block">
            <pre><code><span class="c-comment"># 1. 克隆代码仓库并安装依赖</span>
git clone https://github.com/mimimaster/piwin.git
cd piwin && pnpm install

<span class="c-comment"># 2. 启动桌面端调试或命令行终端</span>
pnpm dev:desktop      <span class="c-comment"># 启动桌面端调试</span>
pnpm dev:cli          <span class="c-comment"># 启动命令行 CLI</span>
pnpm package:desktop  <span class="c-comment"># 本地生成全量安装包</span></code></pre>
            <button
              class="copy-cli-btn"
              type="button"
              @click="copyToClipboard('git clone https://github.com/mimimaster/piwin.git\ncd piwin && pnpm install\npnpm dev:desktop')"
            >
              {{ copiedText && copiedText.startsWith('git clone') ? '已复制命令 ✓' : '复制命令' }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 常见问题解答 FAQ -->
    <section class="download-faq-section">
      <div class="section-header">
        <h2 class="serif section-title">常见安装与运行问题</h2>
        <p class="section-desc">遇到疑问？这里整理了各平台下载与运行高频解答：</p>
      </div>

      <div class="faq-grid">
        <div v-for="(faq, idx) in faqs" :key="idx" class="faq-card">
          <div class="faq-q">
            <span class="faq-icon">Q</span>
            <h4 class="faq-title">{{ faq.question }}</h4>
          </div>
          <p class="faq-a">{{ faq.answer }}</p>
        </div>
      </div>
    </section>

    <!-- 底部开源链接与反馈 -->
    <footer class="download-footer">
      <p>遇到下载问题或有任何需求反馈？欢迎前往 GitHub 提交 Issue 或与开发者交流探讨。</p>
      <div class="footer-actions">
        <a :href="releasesUrl" target="_blank" rel="noopener noreferrer" class="footer-link">
          查看 GitHub Releases 全部历史包 ↗
        </a>
        <a href="https://github.com/mimimaster/piwin/issues" target="_blank" rel="noopener noreferrer" class="footer-link">
          反馈安装问题 (GitHub Issues) ↗
        </a>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.download-page {
  max-width: 1180px;
  margin: 0 auto;
  padding: 2.5rem 24px 5rem;
  color: var(--t1);
}

/* Hero Section */
.download-hero {
  text-align: center;
  max-width: 780px;
  margin: 0 auto 3.5rem;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 14px;
  border-radius: 9999px;
  background: var(--zhu-wash);
  color: var(--zhu);
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 1.25rem;
  border: 1px solid rgba(198, 65, 42, 0.2);
}

.hero-badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--zhu);
  animation: pulse-dot 2s infinite ease-in-out;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

.hero-title {
  font-family: var(--font-serif);
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--t1);
  letter-spacing: -0.02em;
  margin: 0 0 1rem;
}

.hero-subtitle {
  font-size: 1.1rem;
  color: var(--t2);
  line-height: 1.7;
  margin: 0 0 1.5rem;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}

.meta-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--t3);
  background: var(--s2);
  border: 1px solid var(--l2);
  padding: 4px 12px;
  border-radius: 6px;
}

/* Cards Grid */
.download-cards-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  margin-bottom: 4rem;
}

@media (max-width: 1024px) {
  .download-cards-grid {
    grid-template-columns: 1fr;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }
}

.platform-card {
  background: var(--s3);
  border: 1px solid var(--l2);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  box-shadow: var(--sh1);
  position: relative;
}

.platform-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--sh2);
  border-color: var(--l3);
}

.card-highlight {
  border-color: var(--zhu);
  box-shadow: 0 0 0 2px var(--zhu-wash), var(--sh2);
}

.card-highlight-ios {
  border-color: var(--lamp);
  box-shadow: 0 0 0 2px var(--lamp-wash), var(--sh2);
}

.card-upcoming {
  background: linear-gradient(180deg, var(--s3) 0%, var(--s2) 100%);
}

/* Card Header */
.card-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.platform-icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid var(--l2);
}

.icon-apple {
  background: var(--s1);
  color: var(--t1);
}

.icon-windows {
  background: rgba(0, 120, 215, 0.08);
  color: #0078d7;
  border-color: rgba(0, 120, 215, 0.2);
}

.icon-ios {
  background: var(--lamp-wash);
  color: var(--lamp);
  border-color: rgba(184, 128, 31, 0.25);
}

.platform-header-text {
  flex: 1;
  min-width: 0;
}

.platform-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.platform-name {
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--t1);
  margin: 0;
}

.user-os-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--on-zhu);
  background: var(--zhu);
  padding: 2px 8px;
  border-radius: 4px;
}

.status-badge {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
}

.badge-official {
  background: var(--pine-wash);
  color: var(--pine);
  border: 1px solid rgba(61, 124, 94, 0.2);
}

.badge-pending {
  background: var(--lamp-wash);
  color: var(--lamp);
  border: 1px solid rgba(184, 128, 31, 0.25);
  font-weight: 600;
}

.platform-version-pill {
  font-size: 0.8rem;
  color: var(--t3);
}

.pill-amber {
  color: var(--lamp);
  font-weight: 500;
}

/* Constraint Box (版本限制) */
.constraint-box {
  background: var(--s1);
  border: 1px solid var(--l2);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 20px;
}

.constraint-ios {
  border-color: rgba(184, 128, 31, 0.2);
  background: rgba(184, 128, 31, 0.04);
}

.constraint-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--zhu);
  margin-bottom: 8px;
}

.constraint-ios .constraint-title {
  color: var(--lamp);
}

.constraint-list {
  margin: 0;
  padding: 0 0 0 18px;
  font-size: 0.84rem;
  color: var(--t2);
  line-height: 1.6;
}

.constraint-list li {
  margin-bottom: 4px;
}

.constraint-list li:last-child {
  margin-bottom: 0;
}

/* Download Action Group */
.download-action-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.download-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  text-decoration: none;
  font-size: 0.92rem;
  font-weight: 500;
  transition: all 0.2s ease;
  cursor: pointer;
  border: 1px solid transparent;
}

.btn-primary {
  background: var(--zhu);
  color: var(--on-zhu) !important;
  border-color: var(--zhu-lift);
}

.btn-primary:hover {
  background: var(--zhu-lift);
  box-shadow: 0 4px 12px rgba(198, 65, 42, 0.28);
}

.btn-secondary {
  background: var(--s2);
  color: var(--t1) !important;
  border-color: var(--l2);
}

.btn-secondary:hover {
  background: var(--s1);
  border-color: var(--l3);
}

.btn-disabled {
  background: var(--s2);
  color: var(--t4);
  border-color: var(--l2);
  border-style: dashed;
  cursor: not-allowed;
  opacity: 0.85;
}

.btn-text-wrap {
  display: flex;
  flex-direction: column;
  text-align: left;
  flex: 1;
}

.btn-title {
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.3;
}

.btn-sub {
  font-size: 0.76rem;
  opacity: 0.85;
}

.btn-tag-accent {
  font-size: 0.72rem;
  background: rgba(255, 255, 255, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
}

.btn-arrow {
  font-size: 0.95rem;
  opacity: 0.6;
}

/* iOS Feature Capsules */
.ios-feature-capsules {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
  background: var(--s2);
  border: 1px solid var(--l2);
  border-radius: 10px;
  padding: 12px 14px;
}

.ios-feature-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.ios-feature-icon {
  font-size: 1.1rem;
  line-height: 1.2;
}

.ios-feature-desc {
  display: flex;
  flex-direction: column;
  font-size: 0.82rem;
  line-height: 1.45;
}

.ios-feature-desc b {
  color: var(--t1);
  font-weight: 600;
}

.ios-feature-desc span {
  color: var(--t3);
}

/* Tips / Gatekeeper */
.gatekeeper-tip {
  margin-top: auto;
  padding: 12px 14px;
  background: var(--s2);
  border-radius: 8px;
  border: 1px solid var(--l1);
}

.tip-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.tip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--zhu);
}

.tip-dot-pine {
  background: var(--pine);
}

.tip-dot-lamp {
  background: var(--lamp);
}

.tip-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--t1);
}

.tip-desc {
  font-size: 0.78rem;
  color: var(--t3);
  margin: 0 0 8px;
  line-height: 1.5;
}

.code-pill-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--s1);
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--l2);
}

.code-pill-row code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  color: var(--zhu);
}

.copy-pill-btn {
  font-size: 0.72rem;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--s3);
  border: 1px solid var(--l2);
  color: var(--t2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.copy-pill-btn:hover {
  background: var(--s1);
  color: var(--zhu);
  border-color: var(--zhu);
}

.tip-link-row a {
  font-size: 0.8rem;
  color: var(--zhu);
  text-decoration: none;
  font-weight: 500;
}

.tip-link-row a:hover {
  text-decoration: underline;
}

/* Matrix Table Section */
.download-matrix-section {
  margin-bottom: 4rem;
}

.section-header {
  text-align: center;
  margin-bottom: 24px;
}

.section-title {
  font-family: var(--font-serif);
  font-size: 1.6rem;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--t1);
}

.section-desc {
  font-size: 0.95rem;
  color: var(--t3);
  margin: 0;
}

.matrix-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--l2);
  border-radius: 12px;
  background: var(--s3);
  box-shadow: var(--sh1);
}

.matrix-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
  text-align: left;
}

.matrix-table th,
.matrix-table td {
  padding: 14px 18px;
  border-bottom: 1px solid var(--l2);
}

.matrix-table th {
  background: var(--s2);
  font-weight: 600;
  color: var(--t1);
  font-size: 0.9rem;
}

.matrix-table tr:last-child td {
  border-bottom: none;
}

.cell-label {
  font-weight: 600;
  color: var(--t2);
  width: 20%;
  white-space: nowrap;
}

.badge-req {
  font-family: var(--vp-font-family-mono);
  font-weight: 600;
  color: var(--zhu);
  background: var(--zhu-wash);
  padding: 2px 8px;
  border-radius: 4px;
  display: inline-block;
}

.badge-pending-req {
  font-family: var(--vp-font-family-mono);
  font-weight: 600;
  color: var(--lamp);
  background: var(--lamp-wash);
  padding: 2px 8px;
  border-radius: 4px;
  display: inline-block;
}

.status-pill {
  display: inline-block;
  font-size: 0.78rem;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.status-ready {
  background: var(--pine-wash);
  color: var(--pine);
  border: 1px solid rgba(61, 124, 94, 0.2);
}

.status-wait {
  background: var(--lamp-wash);
  color: var(--lamp);
  border: 1px solid rgba(184, 128, 31, 0.25);
}

/* CLI Section */
.download-cli-section {
  margin-bottom: 4rem;
}

.cli-box {
  background: var(--s3);
  border: 1px solid var(--l2);
  border-radius: 16px;
  padding: 28px 32px;
  box-shadow: var(--sh1);
}

.cli-badge {
  display: inline-block;
  font-size: 0.78rem;
  color: var(--azure);
  background: var(--azure-wash);
  border: 1px solid rgba(58, 119, 151, 0.2);
  padding: 2px 8px;
  border-radius: 4px;
  margin-bottom: 8px;
}

.cli-title {
  font-family: var(--font-serif);
  font-size: 1.35rem;
  font-weight: 600;
  margin: 0 0 8px;
}

.cli-desc {
  font-size: 0.92rem;
  color: var(--t2);
  margin: 0 0 16px;
  line-height: 1.6;
}

.cli-code-block {
  position: relative;
  background: var(--s1);
  border: 1px solid var(--l2);
  border-radius: 10px;
  padding: 16px 20px;
}

.cli-code-block pre {
  margin: 0;
  overflow-x: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--t1);
}

.c-comment {
  color: var(--t4);
}

.copy-cli-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  font-size: 0.78rem;
  padding: 4px 10px;
  background: var(--s3);
  border: 1px solid var(--l2);
  color: var(--t2);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.copy-cli-btn:hover {
  background: var(--s2);
  color: var(--zhu);
  border-color: var(--zhu);
}

/* FAQ Section */
.download-faq-section {
  margin-bottom: 4rem;
}

.faq-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

@media (max-width: 768px) {
  .faq-grid {
    grid-template-columns: 1fr;
  }
}

.faq-card {
  background: var(--s3);
  border: 1px solid var(--l2);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--sh1);
}

.faq-q {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
}

.faq-icon {
  width: 22px;
  height: 22px;
  background: var(--zhu-wash);
  color: var(--zhu);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.8rem;
  flex-shrink: 0;
}

.faq-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--t1);
  margin: 0;
  line-height: 1.4;
}

.faq-a {
  font-size: 0.86rem;
  color: var(--t2);
  line-height: 1.6;
  margin: 0;
}

/* Footer Section */
.download-footer {
  text-align: center;
  padding-top: 2rem;
  border-top: 1px solid var(--l2);
  color: var(--t3);
  font-size: 0.9rem;
}

.download-footer p {
  margin: 0 0 12px;
}

.footer-actions {
  display: flex;
  justify-content: center;
  gap: 20px;
  flex-wrap: wrap;
}

.footer-link {
  color: var(--zhu);
  text-decoration: none;
  font-weight: 500;
}

.footer-link:hover {
  text-decoration: underline;
}
</style>
