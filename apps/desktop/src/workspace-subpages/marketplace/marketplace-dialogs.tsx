/**
 * Risk confirmation for installing an unverified live-search Pi package.
 */
import type { ReactElement } from 'react';
import type { MarketplaceSearchHit } from '@piwin/contracts';
import { Button, Dialog, Notice } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';

export type PiPackageInstallDialogProps = {
  hit: MarketplaceSearchHit | null;
  locale?: DesktopLocale | undefined;
  onConfirm: (hit: MarketplaceSearchHit) => void;
  onCancel: () => void;
};

export function PiPackageInstallDialog({
  hit,
  locale,
  onConfirm,
  onCancel,
}: PiPackageInstallDialogProps): ReactElement | null {
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  if (!hit) return null;

  const isMcp = hit.source === 'mcp-registry';
  const isSkill = hit.source === 'skill';
  const isCommunitySkill = isSkill && hit.curated === false;

  const dialogTitle = isMcp
    ? t(`Connect ${hit.name}`, `连接 MCP 服务 ${hit.name}`)
    : isSkill
      ? t(`Install ${hit.name}`, `安装技能 ${hit.name}`)
      : t(`Install ${hit.name}`, `安装 ${hit.name}`);

  const sourceName = isMcp
    ? 'MCP Registry'
    : isCommunitySkill
      ? 'skills.sh'
      : isSkill
        ? 'GitHub Skill'
        : hit.source === 'github'
          ? 'GitHub'
          : 'npm';

  const warningNotice = isMcp
    ? t(
        'This MCP server will run on the Host with your local permissions and expose its tools to the Agent. Ensure you trust this command before connecting.',
        '该 MCP 服务将在 Host 本地以当前系统权限启动运行，并向智能体暴露工具。请确认你信任该服务命令。',
      )
    : isCommunitySkill
      ? t(
          'Community skill from skills.sh, not reviewed by piwin. It installs from the repository’s latest code into the Host skills directory and is available from your next message.',
          '来自 skills.sh 的社区技能，未经 piwin 审核；将按仓库最新代码安装到 Host 技能目录，下一条消息起可用。',
        )
      : isSkill
        ? t(
            'This skill will be installed to the Host skills directory and become available to the Agent on your next turn.',
            '该技能将下载安装至 Host 的技能目录，并在下一轮对话中直接供智能体识别与调用。',
          )
        : t(
            'This is an unverified community package. Installation may download dependencies and run install scripts with the Host user’s permissions. Review its source before continuing.',
            '这是未经 piwin 实测的社区扩展。安装过程可能下载依赖，并以 Host 当前用户权限运行安装脚本；继续前请确认你信任其源码。',
          );

  const confirmActionLabel = isMcp
    ? t('Connect server', '确认连接')
    : isSkill
      ? t('Install skill', '确认安装')
      : t('Install package', '确认安装');

  return (
    <Dialog
      label={dialogTitle}
      open={true}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      testId="marketplace-package-install-dialog"
    >
      <div className="market-dialog-body">
        <h3 className="market-dialog-title">{dialogTitle}</h3>
        <div className="market-dialog-meta">
          <span>{sourceName}</span>
          <span>•</span>
          {hit.repositoryUrl && isCommunitySkill ? (
            <span>{hit.repositoryUrl.replace(/^https:\/\/github\.com\//, '')}</span>
          ) : (
            <span>v{hit.version}</span>
          )}
          {hit.publisher ? <span>• {hit.publisher}</span> : null}
        </div>
        <Notice tone="warning">{warningNotice}</Notice>
        {isMcp && hit.installCommand ? (
          <code className="market-dialog-command">{hit.installCommand}</code>
        ) : null}
        {isMcp && hit.requiredEnv && hit.requiredEnv.length > 0 ? (
          <p className="muted">
            {t(
              `Needs ${hit.requiredEnv.join(', ')}. The config is saved without starting; fill them in Settings → MCP.`,
              `需要 ${hit.requiredEnv.join('、')}。会先保存配置不启动，请到 设置 → MCP 填写后再启动。`,
            )}
          </p>
        ) : null}
        <div className="market-dialog-footer">
          <Button variant="ghost" size="compact" onClick={onCancel}>
            {t('Cancel', '取消')}
          </Button>
          <Button variant="primary" size="compact" onClick={() => onConfirm(hit)}>
            {confirmActionLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
