import { defineConfig } from 'vitepress';
import { docsConfig } from './sites/docs';
import { productConfig } from './sites/product';

/**
 * 单仓库双站入口。
 *
 * VitePress 1.6 的 CLI 没有 --config 参数（只认 root 下的 .vitepress/config.*），
 * 所以用环境变量选择站点，避免把 theme 和 public/ 复制两份：
 *
 *   PIWIWIN_SITE=product  → piwinwin.com          （默认）
 *   PIWIWIN_SITE=docs     → docs.piwinwin.com
 *
 * 具体差异在 .vitepress/sites/{product,docs}.ts，公共部分在 .vitepress/shared.mts。
 */

const site = process.env.PIWIWIN_SITE === 'docs' ? 'docs' : 'product';

export default defineConfig(site === 'docs' ? docsConfig : productConfig);
