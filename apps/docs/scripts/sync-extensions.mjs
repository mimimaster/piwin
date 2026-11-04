import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 把 piwin-extensions 的纯静态前端（site/）同步进产品站，挂到 /extensions/。
 *
 * 拓展站本身是手写静态页：相对路径资源 + hash 路由 + CSP 'self'，
 * 因此可以直接部署在子路径下，无需改写任何资源路径。
 *
 * CI 里由 actions/checkout 把 mimimaster/piwin-extensions 拉到 .ext-src。
 * 本地没有 .ext-src 时跳过同步并保留已有产物，不中断产品站构建。
 */

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const sourceDir = resolve(root, '.ext-src/site');
// VitePress publicDir 固定是 <srcDir>/public（本仓 srcDir 是仓库根），
// 写到 product/public 不会进构建产物。
const targetDir = resolve(root, 'public/extensions');

if (!existsSync(sourceDir)) {
  console.warn(
    '[sync-extensions] 未找到 .ext-src/site，跳过同步（沿用已有 product/public/extensions/）',
  );
  process.exit(0);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
console.log('[sync-extensions] 已同步拓展站前端到 product/public/extensions/');
