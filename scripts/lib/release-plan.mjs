/**
 * `release-desktop plan`: read-only. Shows the next version, what changed
 * since the last release, a CHANGELOG draft to rewrite, and whether this
 * machine is ready to publish.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { countChangelogItems, draftChangelogSection } from './release-changelog.mjs';
import { RELEASE_MANIFEST_KEY, releaseObjectUrl } from './release-manifest.mjs';
import { pickUploader } from './release-publish.mjs';
import { parseDeveloperIdIdentities } from './signing-identity.mjs';

/** wrangler rejects single uploads above this; rclone multipart has no such cap. */
const WRANGLER_MAX_OBJECT_BYTES = 300 * 1024 * 1024;
const DOCS_ORIGIN = 'https://docs.piwinwin.com';

/**
 * @typedef {{ label: string, ok: boolean, detail: string, blocking: boolean }} PreflightCheck
 */

/**
 * @param {import('./release-config.mjs').ReleaseConfig} config
 * @param {{ skipWindows: boolean }} options
 * @returns {Promise<PreflightCheck[]>}
 */
export async function runPreflight(config, options) {
  /** @type {PreflightCheck[]} */
  const checks = [];

  const identities = parseDeveloperIdIdentities(
    spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
      .stdout ?? '',
  );
  const wanted = config.apple?.signingIdentity;
  checks.push({
    label: 'Developer ID 签名身份',
    ok: wanted ? identities.includes(wanted) : identities.length === 1,
    detail: wanted ?? (identities.join(' | ') || '钥匙串里没有 Developer ID Application'),
    blocking: true,
  });

  const keyPath = config.apple
    ? (config.apple.apiKeyPath ??
      join(homedir(), '.appstoreconnect', 'private_keys', `AuthKey_${config.apple.apiKey}.p8`))
    : undefined;
  checks.push({
    label: '公证密钥 (.p8)',
    ok: Boolean(keyPath && existsSync(keyPath)),
    detail: keyPath ?? '发布配置里缺 apple.apiKey / apple.apiIssuer',
    blocking: true,
  });

  if (!options.skipWindows) {
    const reachable = config.windows
      ? spawnSync(
          'ssh',
          ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', config.windows.ssh, 'echo ok'],
          { encoding: 'utf8' },
        )
      : undefined;
    checks.push({
      label: 'Windows 构建机',
      ok: reachable?.status === 0,
      detail: config.windows
        ? `${config.windows.ssh} ${reachable?.status === 0 ? '可达' : '连不上（可加 --skip-windows 只发 macOS）'}`
        : '发布配置里缺 windows.ssh / windows.dir',
      blocking: true,
    });
  }

  const uploader = pickUploader(config);
  checks.push({
    label: '上传通道',
    ok: true,
    detail:
      uploader === 'rclone'
        ? `rclone ${config.r2.rcloneRemote}（分片并行）`
        : `wrangler（单请求上传，单文件上限 ${WRANGLER_MAX_OBJECT_BYTES / 1024 / 1024} MiB；配置 r2.rcloneRemote 可提速并解除上限）`,
    blocking: false,
  });

  checks.push(await checkManifestCors(config.r2.publicBase));
  checks.push({
    label: 'macOS 干净检出',
    ok: true,
    detail: existsSync(join(config.macCheckout, '.git'))
      ? config.macCheckout
      : `${config.macCheckout}（首次发布时创建，第一次是冷构建）`,
    blocking: false,
  });
  return checks;
}

/**
 * The download page reads the manifest cross-origin; without CORS on the
 * bucket it silently keeps showing its built-in fallback links.
 *
 * @param {string} publicBase
 * @returns {Promise<PreflightCheck>}
 */
async function checkManifestCors(publicBase) {
  const url = releaseObjectUrl(publicBase, RELEASE_MANIFEST_KEY);
  try {
    const response = await fetch(url, { method: 'HEAD', headers: { Origin: DOCS_ORIGIN } });
    const allowed = response.headers.get('access-control-allow-origin');
    return {
      label: '下载页 / 应用读取清单 (CORS)',
      ok: allowed === '*' || allowed === DOCS_ORIGIN,
      detail: allowed
        ? `access-control-allow-origin: ${allowed}`
        : `${publicBase} 未返回 CORS 头，下载页停在兜底链接、应用不提示更新（一次性设置见 docs/guides/desktop-release.md）`,
      blocking: false,
    };
  } catch (error) {
    return { label: '下载页 / 应用读取清单 (CORS)', ok: false, detail: String(error), blocking: false };
  }
}

/**
 * @param {{
 *   lastVersion: string | undefined, version: string, kind: 'formal' | 'patch',
 *   commit: string, date: string, commitSubjects: string[],
 *   section: import('./release-changelog.mjs').ChangelogSection | undefined,
 *   dirtyCount: number, unpushedCount: number, checks: PreflightCheck[],
 * }} report
 */
export function printPlan(report) {
  const kindLabel = report.kind === 'formal' ? '正式版' : '小更新';
  console.log(`上一个版本  ${report.lastVersion ?? '（无）'}`);
  console.log(`本次版本    ${report.version}（${kindLabel}）`);
  console.log(`构建提交    ${report.commit}`);
  console.log(`区间提交数  ${report.commitSubjects.length}`);
  if (report.unpushedCount > 0) {
    console.log(`未推送提交  ${report.unpushedCount} 个，发布时会一并 push 到 origin/main`);
  }
  if (report.dirtyCount > 0) {
    console.log(`未提交改动  ${report.dirtyCount} 个文件 —— 不会进安装包（两端都从干净检出构建）`);
  }

  console.log('\n— 就绪检查 —');
  for (const check of report.checks) {
    const mark = check.ok ? 'ok  ' : check.blocking ? 'FAIL' : 'warn';
    console.log(`[${mark}] ${check.label}: ${check.detail}`);
  }

  console.log('\n— CHANGELOG.md —');
  if (report.section && countChangelogItems(report.section) > 0) {
    console.log(
      `已有 ${report.version} 条目（${countChangelogItems(report.section)} 条），可以直接发布。`,
    );
    return;
  }
  const draft = draftChangelogSection(report.version, report.date, report.commitSubjects);
  console.log(
    `还没有 ${report.version} 条目。下面是按提交生成的草稿（另有 ${draft.omitted} 个 docs/refactor/test 等提交未列出）。`,
  );
  console.log('改写成用户能读懂的话，贴到 CHANGELOG.md 最上面的版本位置：\n');
  console.log(draft.markdown);
}
