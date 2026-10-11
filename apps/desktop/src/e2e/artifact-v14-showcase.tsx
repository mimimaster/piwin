/**
 * `#/e2e/artifacts?id=v14-showcase&theme=ink|paper` — runtime v14 samples for
 * visual review: host style with the report kit and kit charts/icons, an
 * expressive stage, an expressive card that trips the contrast badge, and a
 * Canvas report with the 32px viewer toolbar. Real Inkstone manifests are
 * mapped through the production theme map.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { PIWIN_APPEARANCE_DARK, PIWIN_APPEARANCE_LIGHT } from '../appearance-tokens';
import { applyAppearanceToDocument } from '../theme/apply-appearance';
import { mapThemeToArtifactVariables } from '../artifact-theme-map';
import { ArtifactCanvasPanel } from '../artifact-canvas-panel';
import { collectArtifactCanvasTargets } from '../artifact-canvas-model';
import { MarkdownView } from '../MarkdownView';

const SESSION = 'e2e-v14-showcase';

const HOST_DASHBOARD = [
  '<main class="piwin-report">',
  '<h2><i data-piwin-icon="activity"></i> 构建健康度 · 本周</h2>',
  '<p class="piwin-lede">主干构建 212 次，失败率下降到 3.8%，P95 时长缩短 41 秒。</p>',
  '<div class="piwin-grid">',
  '<div class="piwin-stat"><span><i data-piwin-icon="check-circle"></i> 成功率</span><strong>96.2%</strong><small><span class="piwin-badge" data-tone="ok">+2.1</span> 较上周</small></div>',
  '<div class="piwin-stat"><span><i data-piwin-icon="clock"></i> P95 时长</span><strong>6m 12s</strong><small><figure data-piwin-chart="spark"><script type="application/json">{"series":[{"values":[9,8.4,8.1,7.6,7.1,6.4,6.2]}]}</script></figure></small></div>',
  '<div class="piwin-stat"><span><i data-piwin-icon="warn"></i> 不稳定用例</span><strong>7</strong><small><span class="piwin-badge" data-tone="warn">3 个新增</span></small></div>',
  '</div>',
  '<figure data-piwin-chart="bar"><script type="application/json">{"labels":["周一","周二","周三","周四","周五","周六","周日"],"series":[{"name":"成功","values":[31,34,29,36,33,22,19]},{"name":"失败","values":[2,1,3,1,1,0,0]}]}</script><figcaption>失败集中在周三的依赖升级，之后回落。</figcaption></figure>',
  '<div class="piwin-callout" data-tone="info"><i data-piwin-icon="info"></i> 建议：把 3 个新增不稳定用例加入隔离队列。</div>',
  '</main>',
].join('\n');

const EXPRESSIVE_STAGE = [
  '<style>',
  '.stage{position:relative;overflow:hidden;padding:28px 26px;border-radius:18px;background:linear-gradient(135deg,#1d1b3a,#3b2a6b 55%,#7b3f8c);color:#f6f0ff;font-family:var(--piwin-artifact-font)}',
  '.stage h2{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.01em}',
  '.stage p{margin:0 0 18px;color:#d9cdf5;max-width:36em}',
  '.chips{display:flex;gap:8px;flex-wrap:wrap}',
  '.chip{padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);font-size:13px}',
  '.orb{position:absolute;right:-40px;top:-40px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#ffd27a,#ff7a9a 60%,transparent 70%);opacity:.75}',
  '</style>',
  '<div class="stage"><div class="orb"></div>',
  '<h2>周末徒步计划 🌄</h2>',
  '<p>三条路线按难度排好了：清晨出发，下午四点前下山，带够水。</p>',
  '<div class="chips"><span class="chip">香山 · 8 km</span><span class="chip">百望山 · 6 km</span><span class="chip">凤凰岭 · 12 km</span></div>',
  '</div>',
].join('\n');

const EXPRESSIVE_LOW_CONTRAST = [
  '<style>',
  '.note{padding:20px 22px;border-radius:14px;background:#ffffff;color:#c9c9c9;font-size:14px}',
  '.note h3{margin:0 0 8px;color:#d4d4d4;font-size:16px}',
  '.note li{color:#cfcfcf}',
  '</style>',
  '<div class="note"><h3>浅色便签（故意低对比度）</h3>',
  '<ul><li>灰字压在白底上</li><li>在墨主题和纸主题里都难读</li><li>宿主只提示，不改写</li></ul></div>',
].join('\n');

const CANVAS_REPORT = [
  '<main class="piwin-report">',
  '<h1>代码审查 · artifact-expressive</h1>',
  '<p class="piwin-meta"><span class="piwin-badge" data-tone="ok">可合并</span> 4 项建议 · 0 阻塞</p>',
  '<div class="piwin-grid">',
  '<div class="piwin-card"><h3><i data-piwin-icon="shield"></i> 安全</h3><p>kit 只从 /lib/v1/ 加载，connect-src 仍为 none。</p></div>',
  '<div class="piwin-card"><h3><i data-piwin-icon="bug"></i> 风险</h3><p>对比度探针只提示，不改写作者样式。</p></div>',
  '</div>',
  '<figure data-piwin-chart="donut"><script type="application/json">{"labels":["通过","建议","阻塞"],"series":[{"values":[18,4,0]}],"center":"82%"}</script><figcaption>22 个检查点中 18 个直接通过。</figcaption></figure>',
  '<div class="piwin-callout" data-tone="warn">令牌预算测试在 main 上已经是红的，本分支未调整上限。</div>',
  '</main>',
].join('\n');

function fence(title: string, style: 'host' | 'expressive', source: string, canvas = false): string {
  return `\`\`\`artifact-html title="${title}" style="${style}"${canvas ? ' surface="canvas"' : ''}\n${source}\n\`\`\``;
}

export function ArtifactV14Showcase(props: { paper: boolean }): ReactElement {
  const manifest = props.paper ? PIWIN_APPEARANCE_LIGHT : PIWIN_APPEARANCE_DARK;
  useEffect(() => {
    applyAppearanceToDocument(manifest);
  }, [manifest]);
  const artifactTheme = useMemo(() => mapThemeToArtifactVariables(manifest), [manifest]);
  const inline = [
    '### Host 样式 · 报告套件 + kit 图表/图标',
    fence('构建健康度', 'host', HOST_DASHBOARD),
    '### Expressive 样式',
    fence('周末徒步', 'expressive', EXPRESSIVE_STAGE),
    '### Expressive · 对比度提示',
    fence('浅色便签', 'expressive', EXPRESSIVE_LOW_CONTRAST),
  ].join('\n\n');
  const canvasMarkdown = fence('代码审查', 'host', CANVAS_REPORT, true);
  const [target] = useState(
    () =>
      collectArtifactCanvasTargets({
        sessionId: SESSION,
        messageId: 'canvas',
        markdown: canvasMarkdown,
        mode: 'interactive',
      }).at(-1) ?? null,
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 720px) minmax(0, 1fr)', gap: 24 }}>
      <section data-testid="v14-inline" style={{ minWidth: 0 }}>
        <MarkdownView
          text={inline}
          renderingPhase="completed"
          locale="zh-CN"
          artifactTheme={artifactTheme}
          artifactThemeKey={props.paper ? 'paper' : 'ink'}
          artifactOrigin={{ sessionId: SESSION, messageId: 'inline' }}
        />
      </section>
      <section
        data-testid="v14-canvas"
        style={{ height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', background: 'var(--void)' }}
      >
        <ArtifactCanvasPanel
          activeTarget={target}
          artifactTheme={artifactTheme}
          artifactThemeKey={props.paper ? 'paper' : 'ink'}
        />
      </section>
    </div>
  );
}
