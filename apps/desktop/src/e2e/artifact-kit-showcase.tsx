/**
 * `#/e2e/artifacts?id=kit-showcase&theme=ink|paper` — every host-drawn
 * building block in one place for visual review and regression: kit charts
 * (all six kinds, plus line annotations), the viz kit (every kind, ADR 0093),
 * the diagram kit, the component kit, and two fences that
 * trip the layout probe (one per renderer). Real Inkstone manifests are mapped
 * through the production theme map.
 */
import { useEffect, useMemo, type ReactElement } from 'react';
import { PIWIN_APPEARANCE_DARK, PIWIN_APPEARANCE_LIGHT } from '../appearance-tokens';
import { applyAppearanceToDocument } from '../theme/apply-appearance';
import { mapThemeToArtifactVariables } from '../artifact-theme-map';
import { MarkdownView } from '../MarkdownView';
import { ARTIFACT_VIZ_KINDS } from '@piwin/contracts';
import { ARTIFACT_LINE_ANNOTATION_SAMPLE, ARTIFACT_VIZ_EXTRA_SAMPLES, ARTIFACT_VIZ_SAMPLES, artifactVizFigure } from '@piwin/artifact/fixtures';

const SESSION = 'e2e-kit-showcase';

function chart(kind: string, spec: unknown, caption: string): string {
  return `<figure data-piwin-chart="${kind}"><script type="application/json">${JSON.stringify(spec)}</script><figcaption>${caption}</figcaption></figure>`;
}

const CHARTS = [
  '<main class="piwin-report">',
  chart('bar', { labels: ['周一', '周二', '周三', '周四', '周五'], series: [{ name: '成功', values: [42, 51, 47, 60, 58] }, { name: '失败', values: [5, 3, 8, 2, 4] }] }, '每日运行：成功稳步上升。'),
  chart('line', { labels: ['1月', '2月', '3月', '4月', '5月', '6月', '7月'], series: [{ name: 'P95', values: [320, 298, 305, 260, 244, 231, 212] }], unit: 'ms' }, 'P95 耗时半年下降三分之一。'),
  chart('hbar', { labels: ['packages/host-runtime', 'apps/desktop', 'packages/agent-host', 'packages/artifact'], series: [{ name: '测试数', values: [3917, 2410, 1320, 338] }] }, '测试集中在 host-runtime。'),
  chart('donut', { labels: ['通过', '建议', '失败'], series: [{ values: [18, 4, 1] }], center: '78%', centerLabel: '通过' }, '23 个检查点中 18 个通过。'),
  chart('stack', { labels: ['系统提示词', '工具定义', '对话历史', '剩余'], series: [{ values: [2600, 6200, 18000, 73200] }] }, '上下文还有七成余量。'),
  `<div class="piwin-meta"><span>近八次构建</span> ${chart('spark', { values: [3, 5, 4, 8, 7, 11, 10, 14] }, '')}</div>`,
  chart('line', ARTIFACT_LINE_ANNOTATION_SAMPLE, '超时后 cwnd 回到 1，ssthresh 减半。'),
  '</main>',
].join('\n');

/** One fence per viz kind, so each gets its own frame like a real reply. */
const VIZ_FENCES = [
  ...ARTIFACT_VIZ_KINDS.map((kind) => ({ kind, sample: ARTIFACT_VIZ_SAMPLES[kind] })),
  ...ARTIFACT_VIZ_EXTRA_SAMPLES,
].map(({ kind, sample }) => ({ title: sample.title, source: artifactVizFigure(kind, sample.spec, sample.title) }));

/**
 * A dense real-world swimlane: seven phases, three actors, handoffs between
 * them. Over five phases the lanes run down (actors across, phases as rows).
 */
const ATTACK_CHAIN_LANES = [
  '<table class="piwin-lanes" data-dir="down"><thead><tr><th></th><th>页面 JS</th><th>原生</th><th>C2</th></tr></thead><tbody>',
  '<tr><th>入口</th><td><p>埋点上报 UA，拉取 loader.js</p></td><td></td><td><p data-to="页面 JS">下发 loader</p></td></tr>',
  '<tr><th>Hook</th><td><p data-to="原生">改写 window.bridge</p></td><td></td><td><p data-to="页面 JS">下发 hook 脚本</p></td></tr>',
  '<tr><th>RCE</th><td><p data-to="原生">调用 reporter.run()</p></td><td><p data-tone="risk">bridge 不校验调用来源</p></td><td><p>记录 ack</p></td></tr>',
  '<tr><th>选包</th><td><p>按机型挑 payload（7 选 1）</p></td><td><p>写入 /data/local/tmp</p></td><td><p data-to="页面 JS">按指纹返回包名</p></td></tr>',
  '<tr><th>执行</th><td><p data-to="原生">写入并触发加载</p></td><td><p>dlopen 加载 so</p></td><td></td></tr>',
  '<tr><th>注册</th><td><p data-to="C2">POST /api/reg</p></td><td><p data-to="C2">上报设备 ID + deviceinfo</p></td><td><p data-tone="info">设备入库</p></td></tr>',
  '<tr><th>后续</th><td><p data-tone="warn">等待下一轮指令</p></td><td><p data-tone="warn">常驻，等待回连</p></td><td><p>定时轮询任务</p></td></tr>',
  '</tbody></table>',
];

const DIAGRAMS = [
  '<main class="piwin-report">',
  '<ol class="piwin-flow"><li><b>下单</b><small>提交购物车</small></li><li><b>支付</b></li><li data-kind="decision">库存充足？</li><li data-tone="ok"><b>发货</b></li></ol>',
  '<table class="piwin-lanes"><thead><tr><th></th><th>下单</th><th>支付</th><th>履约</th></tr></thead><tbody>',
  '<tr><th>用户</th><td><p data-to="订单服务">提交订单</p></td><td><p data-to="支付网关">确认付款</p></td><td></td></tr>',
  '<tr><th>订单服务</th><td><p>创建订单</p></td><td></td><td><p>锁定库存</p><p data-tone="warn">缺货则回滚</p></td></tr>',
  '<tr><th>支付网关</th><td></td><td><p data-tone="info">扣款回调</p></td><td></td></tr>',
  '</tbody></table>',
  ...ATTACK_CHAIN_LANES,
  '<ol class="piwin-timeline"><li data-tone="ok"><time>10-10</time><b>设计评审通过</b><small>产品负责人确认</small></li><li data-tone="warn"><time>10-12</time><b>v14 运行时上线</b></li><li><time>10-13</time><b>内置组件</b></li></ol>',
  '<ul class="piwin-tree"><li>apps<ul><li>desktop</li><li>cli<ul><li>tui</li></ul></li></ul></li><li>packages<ul><li>contracts</li><li>artifact</li></ul></li></ul>',
  '</main>',
].join('\n');

const COMPONENTS = [
  '<main class="piwin-report">',
  '<header class="piwin-hero"><p class="piwin-meta">发布评审 · 10-13</p><h1>v14 运行时可以发布</h1><p>核心路径全部通过，剩余两项为非阻塞建议。</p></header>',
  '<div class="piwin-grid"><div class="piwin-stat" data-tone="ok"><span>通过率</span><strong>96%</strong><small data-trend="up" data-tone="ok">+4% 较上周</small></div>',
  '<div class="piwin-stat"><span>P95 耗时</span><strong>212ms</strong><small data-trend="down" data-tone="ok">-18ms</small></div></div>',
  '<ol class="piwin-steps"><li data-state="done"><b>解析 fence</b><small>得到 descriptor</small></li><li data-state="current"><b>沙箱渲染</b></li><li data-state="blocked"><b>对比度探测</b></li><li><b>导出</b></li></ol>',
  '<ul class="piwin-checklist"><li data-state="done">类型检查</li><li data-state="current">打包验证</li><li data-state="blocked">E2E</li><li>发布说明</li></ul>',
  '<label class="piwin-progress"><span>迁移进度</span><b>72%</b><progress value="72" max="100"></progress></label>',
  '<label class="piwin-progress" data-tone="warn"><span>磁盘占用</span><b>88%</b><progress value="88" max="100"></progress></label>',
  '<section class="piwin-compare"><article data-pick><h3>内置组件</h3><p>稳定、流式首屏快。</p></article><article><h3>自由发挥</h3><p>表达力最强，偶尔翻车。</p></article></section>',
  '<table class="piwin-matrix"><thead><tr><th></th><th>Desktop</th><th>CLI</th></tr></thead><tbody><tr><th>图表</th><td data-tone="ok">支持</td><td data-tone="risk">不支持</td></tr><tr><th>导出</th><td data-tone="ok">支持</td><td data-tone="warn">部分</td></tr></tbody></table>',
  '</main>',
].join('\n');

/**
 * The mistake the layout probe exists for: a sentence written straight into a
 * grid row, so each inline `code` lands in the narrow marker track.
 */
const SHATTERED_ROW = [
  '<style>',
  '.row{display:grid;grid-template-columns:18px 1fr;gap:6px 10px;color:var(--piwin-artifact-text);font-size:15px}',
  '.dot{width:10px;height:10px;margin-top:6px;border-radius:50%;background:var(--piwin-artifact-warn)}',
  '</style>',
  '<div class="row"><span class="dot"></span>拆分协议、主机、路径：<code>https</code> / <code>www.example.com</code> / <code>/index.html</code></div>',
].join('\n');

function fence(title: string, source: string): string {
  return `\`\`\`artifact-html title="${title}" style="host"\n${source}\n\`\`\``;
}

export function ArtifactKitShowcase(props: { paper: boolean }): ReactElement {
  const manifest = props.paper ? PIWIN_APPEARANCE_LIGHT : PIWIN_APPEARANCE_DARK;
  useEffect(() => {
    applyAppearanceToDocument(manifest);
  }, [manifest]);
  const artifactTheme = useMemo(() => mapThemeToArtifactVariables(manifest), [manifest]);
  const markdown = [
    '### Kit 图表（六种）',
    fence('图表', CHARTS),
    '### Viz Kit',
    ...VIZ_FENCES.map((viz) => fence(viz.title, viz.source)),
    '### Diagram Kit',
    fence('图形', DIAGRAMS),
    '### Component Kit',
    fence('组件', COMPONENTS),
    '### 布局探针 · 静态渲染',
    fence('被挤碎的一行', SHATTERED_ROW),
    '### 布局探针 · 沙箱渲染',
    // The icon makes this a kit artifact, which always takes the sandbox renderer.
    fence('被挤碎的一行（沙箱）', `${SHATTERED_ROW}\n<p><i data-piwin-icon="alert"></i> 同一段标记，换一条渲染路径。</p>`),
  ].join('\n\n');
  return (
    <section data-testid="kit-showcase" style={{ maxWidth: 760, minWidth: 0 }}>
      <MarkdownView
        text={markdown}
        renderingPhase="completed"
        locale="zh-CN"
        artifactTheme={artifactTheme}
        artifactThemeKey={props.paper ? 'paper' : 'ink'}
        artifactOrigin={{ sessionId: SESSION, messageId: 'kit' }}
      />
    </section>
  );
}
