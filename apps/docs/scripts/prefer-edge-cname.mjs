#!/usr/bin/env node
/**
 * 把域名的 CNAME 切到社区优选入口（灰云），或回滚回 Pages 默认（`--proxied`）。
 *
 * ⚠️ 重要结论（2026-11 实测，勿重复踩）：**Cloudflare Pages 自定义域不能直连优选。**
 *
 * 切到外部 CNAME（如 cf.090227.xyz）后，Pages 会持续校验自定义域的 DNS 是否指向
 * `<project>.pages.dev`，校验失败就把域标记为 `deactivated`：
 *   - 前台先返回 403「DNS points to prohibited IP」，随后 522；
 *   - 只有回滚成 `CNAME -> <project>.pages.dev` + proxied=true 并 PATCH
 *     /pages/projects/{p}/domains/{domain} 重试校验，域才会回到 active。
 *
 * 想给 Pages 做优选，链路必须是：业务域灰云 CNAME -> 优选域名 -> CF 边缘 ->
 * **Worker Route**（路由不依赖 Pages 自定义域，由 Worker 反代到 `<project>.pages.dev`）。
 * 多一跳 Worker，收益要自己权衡；真要让国内稳定快，走「备案 + 国内 CDN」。
 *
 * 用法：
 *   node scripts/prefer-edge-cname.mjs                        # dry-run，只打印差异
 *   node scripts/prefer-edge-cname.mjs --apply                # 切到优选入口（灰云）
 *   node scripts/prefer-edge-cname.mjs --target piwin-site.pages.dev --proxied \
 *        --records @,www --ttl 1 --apply                      # 回滚 Pages 默认
 *   node scripts/prefer-edge-cname.mjs --zone piwinwin.com --target cf.090227.xyz \
 *        --records docs --apply
 *
 * 需要：CLOUDFLARE_DNS_TOKEN（该 zone 的 Zone.DNS:Edit 权限）。
 *
 * 回滚：脚本每条删除都打印原记录内容；本文件保留 --proxied 就是为了原样还原。
 */

const API = 'https://api.cloudflare.com/client/v4';

function parseArgs(argv) {
  const opts = {
    zone: 'piwinwin.com',
    target: 'cf.090227.xyz',
    records: ['@', 'www', 'docs'],
    ttl: 600,
    proxied: false,
    apply: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--proxied') opts.proxied = true;
    else if (arg === '--zone') opts.zone = argv[++i];
    else if (arg === '--target') opts.target = argv[++i];
    else if (arg === '--records') opts.records = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (arg === '--ttl') opts.ttl = Number(argv[++i]);
    else throw new Error(`未知参数: ${arg}`);
  }
  return opts;
}

async function cf(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!body.success) {
    const detail = (body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ');
    throw new Error(`${init.method ?? 'GET'} ${path} 失败: ${detail}`);
  }
  return body.result;
}

/** 目标记录名：@ 还原成裸域，其它拼成子域 */
function recordName(zone, record) {
  return record === '@' ? zone : `${record}.${zone}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const token = process.env.CLOUDFLARE_DNS_TOKEN;
  if (!token) throw new Error('缺少环境变量 CLOUDFLARE_DNS_TOKEN');

  const zones = await cf(token, `/zones?name=${encodeURIComponent(opts.zone)}`);
  const zone = zones[0];
  if (!zone) throw new Error(`token 无法访问 zone ${opts.zone}（权限不足或域名不在该账号）`);
  console.log(`zone: ${zone.name} (${zone.id})`);
  console.log(`目标: CNAME -> ${opts.target} · proxied=${opts.proxied} · ttl=${opts.ttl}`);
  console.log(`模式: ${opts.apply ? '写入 (--apply)' : 'dry-run'}\n`);

  for (const record of opts.records) {
    const name = recordName(opts.zone, record);
    const existing = (await cf(token, `/zones/${zone.id}/dns_records?name=${encodeURIComponent(name)}`)).filter(
      (r) => ['A', 'AAAA', 'CNAME'].includes(r.type),
    );

    const wanted = existing.find(
      (r) =>
        r.type === 'CNAME' &&
        r.content === opts.target &&
        r.proxied === opts.proxied &&
        r.ttl === opts.ttl,
    );
    if (wanted) {
      console.log(`= ${name}: 已是 ${opts.target}（proxied=${opts.proxied}），跳过`);
      continue;
    }

    for (const r of existing) {
      console.log(`- ${name}: 删除 ${r.type} -> ${r.content} (proxied=${r.proxied}, ttl=${r.ttl})`);
    }
    console.log(`+ ${name}: 新建 CNAME -> ${opts.target} (proxied=${opts.proxied}, ttl=${opts.ttl})`);

    if (!opts.apply) continue;

    for (const r of existing) {
      await cf(token, `/zones/${zone.id}/dns_records/${r.id}`, { method: 'DELETE' });
    }
    await cf(token, `/zones/${zone.id}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'CNAME',
        name,
        content: opts.target,
        proxied: opts.proxied,
        ttl: opts.ttl,
        comment: 'prefer-edge: 大陆优选入口，见 apps/docs/scripts/prefer-edge-cname.mjs',
      }),
    });
  }

  if (opts.apply) {
    console.log('\n写入完成。等 TTL 生效后请用 itdog 拨测 @ / www / docs 三个域名。');
    console.log('回滚：把 CNAME 改回 <project>.pages.dev 并把 proxied 设回 true。');
  } else {
    console.log('\ndry-run 结束，未做任何改动。加 --apply 才会写入。');
  }
}

main().catch((error) => {
  console.error(`\n失败: ${error.message}`);
  process.exit(1);
});
