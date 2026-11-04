#!/usr/bin/env node
/**
 * 在「你自己的网络」上实测候选 Cloudflare 边缘 IP，挑出真正快的，写成 A 记录。
 *
 * 为什么需要它：优选域名给的 IP 是按维护者自己的探测结果排的，跟你的宽带线路
 * 未必一致。社区池里常见的 104.21.x / 172.67.x 与 Pages 默认给的 IP 属于同一批
 * anycast 段，换过去等于原地踏步（甚至因为多一跳 Worker 更慢）。只有本地实测
 * TLS 握手 + 首字节，才能知道哪个 IP 真正落在香港 / 东京 / 新加坡。
 *
 * 用法（**先关掉 VPN / 代理 / TUN，否则测的是机场线路不是你家宽带**）：
 *   node scripts/pick-edge-ips.mjs --host piwinwin.com
 *   node scripts/pick-edge-ips.mjs --host piwinwin.com --ips 1.2.3.4,5.6.7.8
 *   node scripts/pick-edge-ips.mjs --host piwinwin.com --apply --top 2
 *
 * 输出会带 colo：HKG/NRT/SIN/KIX 才是有意义的落点；全是 LAX/SJC 说明你还在走
 * 代理，或者这条线路就是绕美国（那就别做优选，回滚更划算）。
 */

import https from 'node:https';
import dns from 'node:dns/promises';

const DEFAULT_POOLS = [
  'cf.090227.xyz',
  'ct.cf.090227.xyz',
  'cu.cf.090227.xyz',
  'cmcc.cf.090227.xyz',
  'cloudflare.182682.xyz',
  'cf.877774.xyz',
];

const ZONE_ID = '611c5d1b9943ef2ef7480496884f5975';
const API = 'https://api.cloudflare.com/client/v4';

function parseArgs(argv) {
  const opts = { host: 'piwinwin.com', rounds: 3, top: 2, ips: [], apply: false, pools: DEFAULT_POOLS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--host') opts.host = argv[++i];
    else if (arg === '--top') opts.top = Number(argv[++i]);
    else if (arg === '--rounds') opts.rounds = Number(argv[++i]);
    else if (arg === '--ips') opts.ips = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (arg === '--pools') opts.pools = (argv[++i] ?? '').split(',').filter(Boolean);
    else throw new Error(`未知参数: ${arg}`);
  }
  return opts;
}

/** 直接连 IP，但 SNI / Host 用业务域名，这样测的才是「这个 IP 能不能接这个站」 */
function requestOnce(hostname, ip, path, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const req = https.request(
      {
        host: ip,
        servername: hostname,
        port: 443,
        path,
        method: 'GET',
        headers: { Host: hostname, 'user-agent': 'piwin-edge-bench/1' },
        timeout: timeoutMs,
        rejectUnauthorized: false,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 4096) body += chunk;
        });
        res.on('end', () => {
          const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
          resolve({ elapsed, status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ elapsed: Infinity, status: 0, body: '', error: error.message }));
    req.end();
  });
}

async function collectCandidates(pools, explicit) {
  const set = new Set(explicit);
  for (const pool of pools) {
    // 必须走 DoH：本地 DNS 常被代理/Clash 劫持成 198.18.x 假 IP，系统解析不可信
    const records = await resolveViaDoh(pool);
    for (const ip of records) set.add(ip);
  }
  return [...set];
}

/** DoH 查 A 记录，绕开本地 DNS 劫持 */
async function resolveViaDoh(name) {
  try {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`;
    const res = await fetch(url, { headers: { accept: 'application/dns-json' } });
    const body = await res.json();
    const ips = (body.Answer ?? [])
      .map((answer) => answer.data)
      .filter((data) => typeof data === 'string' && /^[\d.]+$/.test(data));
    if (ips.length > 0) return ips;
  } catch {
    // DoH 不通就退回系统解析
  }
  try {
    return await dns.resolve4(name);
  } catch {
    return [];
  }
}

async function measure(hostname, ip, rounds) {
  let best = Infinity;
  let status = 0;
  let colo = '';
  for (let i = 0; i < rounds; i += 1) {
    const res = await requestOnce(hostname, ip, '/');
    if (res.elapsed < best) {
      best = res.elapsed;
      status = res.status;
    }
  }
  const trace = await requestOnce(hostname, ip, '/cdn-cgi/trace');
  for (const line of trace.body.split('\n')) {
    if (line.startsWith('colo=')) colo = line.slice(5).trim();
  }
  return { ip, ms: Math.round(best), status, colo };
}

async function cf(path, init = {}) {
  const token = process.env.CLOUDFLARE_DNS_TOKEN;
  if (!token) throw new Error('缺少环境变量 CLOUDFLARE_DNS_TOKEN');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json();
  if (!body.success) throw new Error((body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; '));
  return body.result;
}

async function applyTopIps(hostnames, ips) {
  for (const hostname of hostnames) {
    const existing = (await cf(`/zones/${ZONE_ID}/dns_records?name=${encodeURIComponent(hostname)}`)).filter((r) =>
      ['A', 'AAAA', 'CNAME'].includes(r.type),
    );
    for (const record of existing) {
      await cf(`/zones/${ZONE_ID}/dns_records/${record.id}`, { method: 'DELETE' });
    }
    for (const ip of ips) {
      await cf(`/zones/${ZONE_ID}/dns_records`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'A',
          name: hostname,
          content: ip,
          proxied: false,
          ttl: 120,
          comment: 'picked by pick-edge-ips.mjs',
        }),
      });
    }
    console.log(`  ✓ ${hostname} -> ${ips.join(', ')} (灰云 A 记录, ttl=120)`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`测试目标 host: ${opts.host}`);
  console.log('⚠️  如果你开着 VPN/代理/TUN，测出来的是机场线路，不是你的宽带。\n');

  const candidates = await collectCandidates(opts.pools, opts.ips);
  console.log(`候选 IP: ${candidates.length} 个，每个跑 ${opts.rounds} 轮取最优…\n`);

  const results = [];
  for (const ip of candidates) {
    results.push(await measure(opts.host, ip, opts.rounds));
  }
  results.sort((a, b) => a.ms - b.ms);

  console.log('  排名  IP               首字节     状态  colo');
  results.forEach((r, index) => {
    const ms = r.ms === Infinity ? '超时' : `${r.ms}ms`;
    console.log(
      `  ${String(index + 1).padStart(3)}.  ${r.ip.padEnd(16)} ${ms.padEnd(9)} ${String(r.status).padEnd(5)} ${r.colo || '-'}`,
    );
  });

  const bestColos = new Set(results.slice(0, 3).map((r) => r.colo));
  if (bestColos.has('LAX') || bestColos.has('SJC')) {
    console.log('\n⚠️ 最快的几个落点在美国（LAX/SJC）：说明流量在绕美，优选对你没意义。');
  } else {
    console.log('\n落点看起来正常（HKG/NRT/SIN 等），可以用这些 IP。');
  }

  if (!opts.apply) {
    console.log(`\n确认后执行：node scripts/pick-edge-ips.mjs --host ${opts.host} --apply --top ${opts.top}`);
    return;
  }

  const winners = results.filter((r) => r.status === 200 && r.ms !== Infinity).slice(0, opts.top).map((r) => r.ip);
  if (winners.length === 0) throw new Error('没有可用 IP，未写入任何记录');
  const hostnames = opts.host === 'docs.piwinwin.com' ? ['docs.piwinwin.com'] : ['piwinwin.com', 'www.piwinwin.com'];
  console.log(`\n写入最快的 ${winners.length} 个 IP：`);
  await applyTopIps(hostnames, winners);
}

main().catch((error) => {
  console.error(`\n失败: ${error.message}`);
  process.exit(1);
});
