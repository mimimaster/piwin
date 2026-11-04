import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * VitePress 只支持单个 publicDir，而两站的 _redirects 必须不同：
 * 共用一个文件会让产品站也加载 "/docs/gallery -> piwinwin.com/gallery"，
 * 在 piwinwin.com 上形成指向自身的跳转链。
 *
 * 所以 public/ 继续共享图片，_redirects 在构建后按站复制进各自 outDir。
 */

const SITES = {
  product: { source: 'product-public/_redirects', outDir: '.vitepress/dist-product' },
  docs: { source: 'docs-public/_redirects', outDir: '.vitepress/dist-docs' },
};

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const siteName = process.argv[2];
const site = SITES[siteName];

if (!site) {
  console.error(
    `[copy-redirects] 未知站点 "${siteName ?? ''}"，可选：${Object.keys(SITES).join(' / ')}`,
  );
  process.exit(1);
}

const sourcePath = resolve(root, site.source);
const targetPath = resolve(root, site.outDir, '_redirects');

if (!existsSync(sourcePath)) {
  console.error(`[copy-redirects] 缺少重定向文件：${site.source}`);
  process.exit(1);
}

if (!existsSync(resolve(root, site.outDir))) {
  console.error(`[copy-redirects] 构建产物不存在：${site.outDir}（先跑 vitepress build）`);
  process.exit(1);
}

copyFileSync(sourcePath, targetPath);
console.log(`[copy-redirects] ${site.source} -> ${site.outDir}/_redirects`);
