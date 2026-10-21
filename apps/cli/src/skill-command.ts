import { getPiwinRoot, loadDiscoveredResources, loadPiwinConfig } from '@piwin/host-runtime';
import { RECOMMENDED_SKILLS, parseSkillsShEntryId, skillsShInstallSource } from '@piwin/marketplace';
import {
  ensureBundledSkillsInstalled,
  installSkill,
  resolveBundledSkillsRoot,
  uninstallUserSkill,
  updateSkillFromOrigin,
} from '@piwin/skills';
import { resolve } from 'node:path';
import { parseProject, readOption } from './cli-args.js';

/**
 * `piwin skill` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandSkill(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);

  if (sub === 'list') {
    await ensureBundledSkillsInstalled(root);
    const scanOptions: {
      piwinRoot: string;
      projectPath: string;
      skillsConfig?: NonNullable<typeof config.skills>;
    } = {
      piwinRoot: root,
      projectPath: parseProject(argv),
    };
    if (config.skills) {
      scanOptions.skillsConfig = config.skills;
    }
    const discovered = await loadDiscoveredResources({
      piwinRoot: root,
      projectPath: scanOptions.projectPath,
      ...(config.skills ? { skillsConfig: config.skills } : {}),
    });
    const visibleSkills = discovered.skills.filter(
      (s) => s.hidden !== true || s.source === 'bundled',
    );
    if (visibleSkills.length === 0) {
      console.log('(no skills found)');
      return;
    }
    for (const skill of visibleSkills) {
      const flag = skill.enabled ? 'on ' : 'off';
      console.log(`${flag}\t${skill.id}\t${skill.source}\t${skill.name}\t${skill.path}`);
    }
    return;
  }

  if (sub === 'ensure-bundled') {
    await ensureBundledSkillsInstalled(root);
    console.log(`bundled skills load from ${resolveBundledSkillsRoot()}`);
    console.log('(product tree — not copied into ~/.piwin/skills)');
    return;
  }

  if (sub === 'install') {
    // `piwin skill install skills.sh:<owner>/<repo>/<skill>` — the id `piwin market search` prints.
    const communityId = argv[2] && !argv[2].startsWith('--') ? parseSkillsShEntryId(argv[2]) : undefined;
    if (communityId) {
      const result = await installSkill({
        piwinRoot: root,
        source: skillsShInstallSource(communityId.ownerRepo),
        name: readOption(argv, '--name') ?? communityId.skillName,
      });
      console.log(`installed ${result.skillId} -> ${result.targetPath}`);
      return;
    }
    const localPath = readOption(argv, '--local');
    const gitUrl = readOption(argv, '--git');
    const name = readOption(argv, '--name');
    if (localPath) {
      const installOptions: Parameters<typeof installSkill>[0] = {
        piwinRoot: root,
        source: { kind: 'local', path: resolve(localPath) },
      };
      if (name) {
        installOptions.name = name;
      }
      const result = await installSkill(installOptions);
      console.log(`installed ${result.skillId} -> ${result.targetPath}`);
      return;
    }
    if (gitUrl) {
      const installOptions: Parameters<typeof installSkill>[0] = {
        piwinRoot: root,
        source: { kind: 'git', url: gitUrl },
      };
      if (name) {
        installOptions.name = name;
      }
      const result = await installSkill(installOptions);
      console.log(`installed ${result.skillId} -> ${result.targetPath}`);
      return;
    }
    console.log('Recommended git skills:');
    for (const item of RECOMMENDED_SKILLS) {
      console.log(
        `- ${item.id}: ${item.source.url}${item.source.subdir ? ` (${item.source.subdir})` : ''}`,
      );
    }
    console.error(
      'Usage: piwin skill install skills.sh:<owner>/<repo>/<skill> | --local <dir> | --git <url> [--name <id>]',
    );
    process.exitCode = 1;
    return;
  }

  if (sub === 'uninstall') {
    const skillId = argv[2]?.trim();
    if (!skillId) {
      console.error('Usage: piwin skill uninstall <skill-id>');
      process.exitCode = 1;
      return;
    }
    const discovered = await loadDiscoveredResources({
      piwinRoot: root,
      ...(config.skills ? { skillsConfig: config.skills } : {}),
    });
    const skill = discovered.skills.find((entry) => entry.id === skillId);
    if (!skill) {
      console.error(`Skill not found: ${skillId}`);
      process.exitCode = 1;
      return;
    }
    try {
      await uninstallUserSkill({ piwinRoot: root, skill });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
    console.log(`uninstalled ${skillId}`);
    return;
  }

  if (sub === 'update') {
    const skillId = argv[2]?.trim();
    if (!skillId) {
      console.error('Usage: piwin skill update <skill-id>');
      process.exitCode = 1;
      return;
    }
    const discovered = await loadDiscoveredResources({
      piwinRoot: root,
      ...(config.skills ? { skillsConfig: config.skills } : {}),
    });
    const skill = discovered.skills.find((entry) => entry.id === skillId);
    if (!skill) {
      console.error(`Skill not found: ${skillId}`);
      process.exitCode = 1;
      return;
    }
    try {
      const result = await updateSkillFromOrigin({ piwinRoot: root, skill });
      const commit = result.commit ? ` (${result.commit.slice(0, 7)})` : '';
      console.log(result.changed ? `updated ${skillId}${commit}` : `${skillId} is up to date${commit}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  console.error(`Unknown skill subcommand: ${sub}`);
  process.exitCode = 1;
}
