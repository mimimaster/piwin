/**
 * Pages 边缘反代 Worker —— 让 Pages 站点能用社区优选入口。
 *
 * 为什么需要这一层：Cloudflare Pages 会持续校验自定义域的 DNS 是否指向
 * `<project>.pages.dev`，一旦把域名切到外部 CNAME（优选域名）就会把该域标记
 * `deactivated`，前台变成 403「DNS points to prohibited IP」/ 522（2026-11 实测）。
 *
 * 换成这条链路就绕开了那个校验：
 *   访客 → 灰云 CNAME → 优选域名（大陆友好 CF 边缘 IP）→ CF 边缘
 *        → Worker Route（按 hostname 命中，不依赖 Pages 自定义域）
 *        → fetch `<project>.pages.dev` → 返回
 *
 * 部署（不需要 Pages 自定义域，也不要在 Pages 项目里挂这些域名）：
 *   npx wrangler deploy workers/pages-edge-proxy.mjs --name piwin-pages-edge-proxy
 * 路由（在 zone 的 Workers Routes 里加，另一个权限组）：
 *   piwinwin.com/*      → piwin-pages-edge-proxy
 *   www.piwinwin.com/*  → piwin-pages-edge-proxy
 *   docs.piwinwin.com/* → piwin-pages-edge-proxy
 *
 * 回滚：删除三条路由 + 把 DNS 改回 `CNAME <project>.pages.dev` + proxied=true，
 * 再 PATCH /accounts/{acc}/pages/projects/{p}/domains/{domain} 重校验。
 */

const ORIGIN_BY_HOST = new Map([
  ['piwinwin.com', 'piwin-site.pages.dev'],
  ['www.piwinwin.com', 'piwin-site.pages.dev'],
  ['docs.piwinwin.com', 'piwin-docs.pages.dev'],
]);

/** Pages 的回源地址会带 *.pages.dev，改写回访客看到的域名，避免把用户甩到预览域 */
function rewriteLocation(headers, targetUrl, publicHostname, originHost) {
  const location = headers.get('location');
  if (!location) return;
  try {
    const parsed = new URL(location, targetUrl);
    if (parsed.hostname !== originHost) return;
    parsed.protocol = 'https:';
    parsed.hostname = publicHostname;
    parsed.port = '';
    headers.set('location', parsed.toString());
  } catch {
    // Location 不是合法 URL 就原样保留
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const originHost = ORIGIN_BY_HOST.get(url.hostname);
    if (!originHost) {
      return new Response(`unknown host: ${url.hostname}`, {
        status: 421,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    const target = new URL(url.toString());
    target.hostname = originHost;
    target.protocol = 'https:';

    // 必须丢掉原 Host 头：Request 的 Host 由 URL 决定，带着业务域名的 Host
    // 去 fetch pages.dev 会被 CF 判成 Host/SNI 不一致，直接 403（实测）。
    const upstreamHeaders = new Headers();
    for (const [key, value] of request.headers) {
      if (key.toLowerCase() === 'host') continue;
      upstreamHeaders.set(key, value);
    }

    const hasBody = !['GET', 'HEAD'].includes(request.method);
    const upstreamRequest = new Request(target.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
    });

    const upstream = await fetch(upstreamRequest);
    const headers = new Headers(upstream.headers);
    rewriteLocation(headers, target, url.hostname, originHost);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
