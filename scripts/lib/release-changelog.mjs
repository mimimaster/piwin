/**
 * CHANGELOG.md is the hand-edited source for release notes. A release section:
 *
 *   ## 0.1.1 — 2026-10-08
 *   ### 新增
 *   - 用户能读懂的一句话
 *
 * The same section feeds the download page manifest and GitHub release notes.
 */

const SECTION_HEADING = /^##\s+v?(\d+\.\d+\.\d+)\b(.*)$/;
const GROUP_HEADING = /^###\s+(.+?)\s*$/;
const LIST_ITEM = /^[-*]\s+(.+?)\s*$/;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const CONVENTIONAL_SUBJECT = /^﻿?(\w+)(?:\([^)]*\))?!?:\s*(.+)$/;

/** Commit types worth a user-facing line, in display order. */
const DRAFT_GROUPS = [
  { type: 'feat', title: '新增' },
  { type: 'perf', title: '优化' },
  { type: 'fix', title: '修复' },
];

/**
 * @typedef {{ title: string, items: string[] }} ChangelogGroup
 * @typedef {{ version: string, date: string | undefined, groups: ChangelogGroup[] }} ChangelogSection
 */

/**
 * @param {string} markdown
 * @param {string} version
 * @returns {ChangelogSection | undefined}
 */
export function extractChangelogSection(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  /** @type {ChangelogSection | undefined} */
  let section;
  /** @type {ChangelogGroup | undefined} */
  let group;
  for (const line of lines) {
    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      if (section) break;
      if (heading[1] === version) {
        section = { version, date: ISO_DATE.exec(heading[2] ?? '')?.[0], groups: [] };
      }
      continue;
    }
    if (!section) continue;
    const groupHeading = GROUP_HEADING.exec(line);
    if (groupHeading?.[1]) {
      group = { title: groupHeading[1], items: [] };
      section.groups.push(group);
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (!item?.[1]) continue;
    if (!group) {
      group = { title: '', items: [] };
      section.groups.push(group);
    }
    group.items.push(item[1]);
  }
  if (!section) return undefined;
  section.groups = section.groups.filter((entry) => entry.items.length > 0);
  return section;
}

/** @param {ChangelogSection} section */
export function countChangelogItems(section) {
  return section.groups.reduce((total, group) => total + group.items.length, 0);
}

/**
 * Starting point for a human rewrite: feat / perf / fix subjects grouped, the
 * rest (docs, refactor, test, chore…) only counted because users never see them.
 *
 * @param {string} version
 * @param {string} date ISO date
 * @param {string[]} commitSubjects
 * @returns {{ markdown: string, omitted: number }}
 */
export function draftChangelogSection(version, date, commitSubjects) {
  /** @type {Map<string, string[]>} */
  const byType = new Map();
  let omitted = 0;
  for (const subject of commitSubjects) {
    const match = CONVENTIONAL_SUBJECT.exec(subject.trim());
    const type = match?.[1]?.toLowerCase();
    const text = match?.[2];
    if (!type || !text || !DRAFT_GROUPS.some((entry) => entry.type === type)) {
      omitted += 1;
      continue;
    }
    byType.set(type, [...(byType.get(type) ?? []), text]);
  }
  const blocks = [`## ${version} — ${date}`];
  for (const { type, title } of DRAFT_GROUPS) {
    const items = byType.get(type);
    if (!items) continue;
    blocks.push(`### ${title}\n${items.map((item) => `- ${item}`).join('\n')}`);
  }
  return { markdown: `${blocks.join('\n\n')}\n`, omitted };
}

/** @param {ChangelogSection} section */
export function renderReleaseNotes(section) {
  return section.groups
    .map((group) => {
      const items = group.items.map((item) => `- ${item}`).join('\n');
      return group.title ? `### ${group.title}\n${items}` : items;
    })
    .join('\n\n');
}
