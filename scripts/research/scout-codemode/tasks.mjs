import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const COMMON = `这是只读实验任务。不得修改文件、配置或源码，不得执行有副作用的命令，不得联网。可以用正常的 Scout、grep/read、bash 中的只读命令，以及当前可用的其他只读工具；自主选择工具，不必使用某一种工具。请至少使用一个 Scout 获取证据或计算结果，以验证“已经使用 Scout”的情形；你自主决定 Scout 的任务和自己的工具。不要创建计划文件或报告文件。最终答案只输出一个 JSON 对象，不要 Markdown 围栏。`;
export const TASKS = [
  {
    id: 'call-chain',
    prompt: `从 Host 的 SessionHostToolExecutionPort.execute 开始，追踪普通 read_file 调用直到实际读取 UTF-8 字节（排除 toolbox 和 Codemode 分支）。定位以下 5 个阶段：port（验证身份并分派），router（准备参数的路由入口），prepare（把输入路径转换为规范路径的辅助函数），admission（权限准入函数），executor（read_file 注册的实际执行器）。返回 {stages:{port:{file,symbol,line},router:{file,symbol,line},prepare:{file,symbol,line},admission:{file,symbol,line},executor:{file,symbol,line}},identityChecks:[...],readOnly:boolean,fileEffect:string,encoding:string}。file 用仓库相对路径，line 是对应函数内一行。identityChecks 列出 port 校验的 4 个输入字段名。`,
  },
  {
    id: 'cross-file',
    prompt: `在 packages/media/src、packages/project/src、packages/mcp/src 内递归统计生产 .ts 文件中静态 from '@piwin/contracts'（单引号或双引号）的导入或再导出。不计 *.test.ts、*.spec.ts、fixtures/ 目录；不计 import('@piwin/contracts')，也不计子路径。每个文件只计一次，匹配定义为 from\\s+['\"]@piwin/contracts['\"]。返回 {packages:[{name:'media',count:number,files:[仓库相对路径按字典升序]},...],total:number}，packages 按 media、project、mcp 顺序。`,
  },
  {
    id: 'structured-data',
    prompt: `读取 experiment-data/orders.json 的 rows。筛选 status='paid'、currency='CNY'、region 是 'cn-east' 或 'cn-north'、grossCents>=1000 的订单。按 sku 聚合 count、quantity=sum(quantity)、netCents=sum(grossCents-refundCents)。按 netCents 降序、并列时 sku 升序，取前 5。返回 {matchedCount:number,top:[{sku,count,quantity,netCents},...]}。所有金额以整数分计算。数据的每一行都可通过正常文件读取或只读命令访问，两组访问能力相同。`,
  },
];

export function makeRows() {
  let state = 20261011;
  const next = (max) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
  return Array.from({ length: 4096 }, (_, index) => ({
    id: `order-${String(index + 1).padStart(5, '0')}`,
    status: ['paid', 'pending', 'paid', 'refunded', 'paid'][next(5)],
    currency: ['CNY', 'USD', 'CNY'][next(3)],
    region: ['cn-east', 'cn-north', 'eu-west', 'us-east'][next(4)],
    sku: `sku-${String(next(12) + 1).padStart(2, '0')}`,
    quantity: next(9) + 1,
    grossCents: next(25000) + 100,
    refundCents: next(800),
    note: `Local synthetic read-only order ${index + 1}; deterministic fixture; no customer data.`,
  }));
}

export function aggregateRows(rows) {
  const matched = rows.filter(row => row.status === 'paid' && row.currency === 'CNY'
    && ['cn-east', 'cn-north'].includes(row.region) && row.grossCents >= 1000);
  const groups = new Map();
  for (const row of matched) {
    const bucket = groups.get(row.sku) ?? { sku: row.sku, count: 0, quantity: 0, netCents: 0 };
    bucket.count += 1; bucket.quantity += row.quantity; bucket.netCents += row.grossCents - row.refundCents;
    groups.set(row.sku, bucket);
  }
  return { matchedCount: matched.length, top: [...groups.values()].sort((left, right) =>
    right.netCents - left.netCents || left.sku.localeCompare(right.sku)).slice(0, 5) };
}

export async function walkFiles(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...await walkFiles(path));
    else if (entry.isFile()) found.push(path);
  }
  return found.sort();
}

export async function inventory(root) {
  const packages = [];
  for (const name of ['media', 'project', 'mcp']) {
    const files = [];
    for (const path of await walkFiles(join(root, 'packages', name, 'src'))) {
      if (!path.endsWith('.ts') || /\.(test|spec)\.ts$|\/fixtures\//.test(path)) continue;
      if (/from\s+['"]@piwin\/contracts['"]/.test(await readFile(path, 'utf8'))) files.push(relative(root, path));
    }
    packages.push({ name, count: files.length, files });
  }
  return { packages, total: packages.reduce((total, row) => total + row.count, 0) };
}

export async function fingerprint(root) {
  const hash = createHash('sha256');
  for (const path of await walkFiles(root)) {
    hash.update(relative(root, path)); hash.update('\0'); hash.update(await readFile(path)); hash.update('\0');
  }
  return hash.digest('hex');
}

const CHAIN = {
  port: { file: 'packages/host-runtime/src/tools/session-host-tool-port.ts', symbol: 'execute', first: 288, last: 364 },
  router: { file: 'packages/host-runtime/src/tools/host-tool-execution-router.ts', symbol: 'execute', first: 114, last: 191 },
  prepare: { file: 'packages/host-runtime/src/tools/host-filesystem-tools.ts', symbol: 'prepareResolvedPath', first: 396, last: 416 },
  admission: { file: 'packages/host-runtime/src/tools/tool-admission.ts', symbol: 'resolveHostToolAdmission', first: 90, last: 194 },
  executor: { file: 'packages/host-runtime/src/tools/host-filesystem-tools.ts', symbol: 'execute', first: 103, last: 109 },
};
export const CHAIN_ORACLE = CHAIN;

export function grade(taskId, answer, expected) {
  let parsed;
  try { parsed = JSON.parse(answer.trim()); } catch { return { passed: false, failures: ['invalid JSON'] }; }
  if (taskId !== 'call-chain') {
    return { passed: isDeepStrictEqual(parsed, expected), failures:
      isDeepStrictEqual(parsed, expected) ? [] : ['exact values/list/order differ from oracle'], parsed };
  }
  const failures = [];
  for (const [stage, oracle] of Object.entries(CHAIN)) {
    const value = parsed.stages?.[stage];
    if (value?.file !== oracle.file || typeof value?.symbol !== 'string' || !value.symbol.includes(oracle.symbol)
      || !Number.isInteger(value.line) || value.line < oracle.first || value.line > oracle.last) failures.push(stage);
  }
  if (JSON.stringify([...parsed.identityChecks ?? []].sort()) !== JSON.stringify(['sessionId', 'runtimeGenerationId', 'runId', 'toolName'].sort())) failures.push('identityChecks');
  if (parsed.readOnly !== true) failures.push('readOnly');
  if (parsed.fileEffect !== 'none') failures.push('fileEffect');
  if (!['utf-8', 'utf8'].includes(parsed.encoding)) failures.push('encoding');
  return { passed: failures.length === 0, failures, parsed };
}
