import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 把 piwin-extensions 的**可部署产物**同步进产品站，挂到 /extensions/。
 *
 * 不能直接拷 site/：site/ 只是手写静态页源码，浏览器要的
 * `lib/entry.mjs`、`lib/source-rules.mjs`、`schema/entry.schema.json`
 * 与 `index.json` 都由拓展站自己的 `scripts/build-site.mjs` 生成。
 * 只拷 site/ 会让 `entry-builder.js` 的 `import './lib/entry.mjs'` 404，
 * 整个模块图加载失败，页面永远停在「加载中…」（2026-11 线上实测）。
 *
 * 拓展站是零依赖的纯 Node 脚本（只用 node: 内置模块），因此这里直接跑
 * `node .ext-src/scripts/build-site.mjs public/extensions`，产物写到
 * VitePress 的 publicDir 下，随后被 vitepress build 原样拷进 dist-product。
 *
 * CI 里由 actions/checkout 把 mimimaster/piwin-extensions 拉到 .ext-src。
 * 本地没有 .ext-src 时跳过同步并保留已有产物，不中断产品站构建。
 */

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const extRoot = resolve(root, '.ext-src');
const buildScript = resolve(extRoot, 'scripts/build-site.mjs');
// VitePress publicDir 固定是 <srcDir>/public（本仓 srcDir 是仓库根），
// 写到 product/public 不会进构建产物。
const targetDir = resolve(root, 'public/extensions');

if (!existsSync(buildScript)) {
  console.warn(
    '[sync-extensions] 未找到 .ext-src/scripts/build-site.mjs，跳过同步（沿用已有 public/extensions/）',
  );
  process.exit(0);
}

rmSync(targetDir, { recursive: true, force: true });

const built = spawnSync(process.execPath, [buildScript, targetDir], {
  cwd: extRoot,
  stdio: 'inherit',
});

if (built.status !== 0) {
  console.error('[sync-extensions] 拓展站构建失败，产品站 /extensions/ 会缺文件');
  process.exit(built.status ?? 1);
}

console.log('[sync-extensions] 已把拓展站产物同步到 public/extensions/');
