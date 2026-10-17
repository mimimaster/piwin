import { describe, expect, it } from 'vitest';
import { buildSlashCatalog, SKILL_SLASH_ALIASES } from './slash-catalog';
import { filterSlashItems } from './slash-match';

const skills = [
  { id: 'writing-plans', name: 'writing-plans', description: 'Plan', enabled: true },
  {
    id: 'optimize-prompt',
    name: 'optimize-prompt',
    description: 'Optimize prompts',
    enabled: true,
  },
  { id: 'create-skill', name: 'create-skill', enabled: true },
];

describe('buildSlashCatalog — write-plan alias', () => {
  it('registers write-plan as an alias of writing-plans', () => {
    expect(SKILL_SLASH_ALIASES['write-plan']).toBe('writing-plans');
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
    });
    const item = catalog.find((entry) => entry.id === 'skill:writing-plans');
    expect(item).toBeTruthy();
    expect(item?.aliases).toContain('write-plan');
  });

  it('autocomplete matches /write-plan query to writing-plans skill', () => {
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
    });
    const filtered = filterSlashItems(catalog, 'write-plan');
    expect(filtered.some((entry) => entry.id === 'skill:writing-plans')).toBe(true);
  });

  it('autocomplete matches /writing-plans query to writing-plans skill', () => {
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
    });
    const filtered = filterSlashItems(catalog, 'writing-plans');
    expect(filtered.some((entry) => entry.id === 'skill:writing-plans')).toBe(true);
  });
});

describe('buildSlashCatalog — optimize-prompt aliases', () => {
  it('registers optimize-prompts and prompt-optimize as aliases', () => {
    expect(SKILL_SLASH_ALIASES['optimize-prompts']).toBe('optimize-prompt');
    expect(SKILL_SLASH_ALIASES['prompt-optimize']).toBe('optimize-prompt');
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
    });
    const item = catalog.find((entry) => entry.id === 'skill:optimize-prompt');
    expect(item).toBeTruthy();
    expect(item?.aliases).toContain('optimize-prompts');
    expect(item?.aliases).toContain('prompt-optimize');
  });
});

describe('buildSlashCatalog — composer modes', () => {
  it('lists Goal only — Agent is resting mode, not Plan or Ask', () => {
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
    });
    const modeIds = catalog.filter((item) => item.kind === 'mode').map((item) => item.name);
    expect(modeIds).toEqual(['goal']);
  });
});

describe('buildSlashCatalog — Conversation chat', () => {
  it('keeps compact plus Goal/skills, and omits orchestration', () => {
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
      conversationChat: true,
    });
    expect(catalog.map((item) => item.id)).toEqual([
      'cmd:compact',
      'mode:goal',
      'skill:writing-plans',
      'skill:optimize-prompt',
      'skill:create-skill',
    ]);
    expect(catalog.some((item) => item.id === 'cmd:ultra-code')).toBe(false);
    expect(catalog.some((item) => item.id === 'cmd:scheme')).toBe(false);
    const writingPlans = catalog.find((item) => item.id === 'skill:writing-plans');
    expect(writingPlans?.available).toBe(true);
  });

  it('hides project-local skills in Conversation slash', () => {
    const catalog = buildSlashCatalog({
      skills: [
        { id: 'user-skill', name: 'user-skill', enabled: true, source: 'user' },
        { id: 'proj-skill', name: 'proj-skill', enabled: true, source: 'project' },
        { id: 'bundled-skill', name: 'bundled-skill', enabled: true, source: 'bundled' },
      ],
      hasActiveSession: true,
      projectTrusted: true,
      requireProjectTrust: false,
      conversationChat: true,
    });
    expect(catalog.map((item) => item.id)).toContain('skill:user-skill');
    expect(catalog.map((item) => item.id)).toContain('skill:bundled-skill');
    expect(catalog.map((item) => item.id)).not.toContain('skill:proj-skill');
  });

  it('keeps /goal available before a session exists', () => {
    const catalog = buildSlashCatalog({
      skills: [],
      hasActiveSession: false,
      projectTrusted: false,
      conversationChat: true,
    });
    const goal = catalog.find((item) => item.id === 'mode:goal');
    expect(goal?.available).toBe(true);
  });

  it('lists one flashcards command and a separate knowledge command', () => {
    const catalog = buildSlashCatalog({
      skills: [],
      hasActiveSession: true,
      projectTrusted: true,
    });
    const flashcards = catalog.filter((item) => item.label === 'Flashcards');
    expect(flashcards).toHaveLength(1);
    expect(flashcards[0]?.id).toBe('cmd:flashcards');
    expect(flashcards[0]?.aliases).toEqual(expect.arrayContaining(['doccards', 'cards']));
    const knowledge = catalog.find((item) => item.id === 'cmd:knowledge');
    expect(knowledge?.aliases).toEqual(expect.arrayContaining(['kb', 'notes', 'wiki']));
    expect(catalog.some((item) => item.id === 'cmd:wiki')).toBe(false);
    expect(catalog.some((item) => item.id === 'cmd:notes')).toBe(false);
  });

  it('disables /goal when the extension is off', () => {
    const catalog = buildSlashCatalog({
      skills: [],
      hasActiveSession: true,
      projectTrusted: true,
      goalExtensionEnabled: false,
    });
    const goal = catalog.find((item) => item.id === 'mode:goal');
    expect(goal?.available).toBe(false);
    expect(goal?.unavailableReason).toMatch(/Settings → Extensions/);
  });
});

describe('buildSlashCatalog — extension commands', () => {
  it('lists extension commands after skills and lets skills and reserved names win', () => {
    const catalog = buildSlashCatalog({
      skills,
      extensionCommands: [
        { name: 'cache-stats', extensionName: 'pi-deepseek-cache' },
        { name: 'create-skill', extensionName: 'shadowed-by-skill' },
        { name: 'compact', extensionName: 'shadowed-by-command' },
      ],
      hasActiveSession: true,
      projectTrusted: true,
    });
    const extensionItems = catalog.filter((item) => item.kind === 'extension');
    expect(extensionItems.map((item) => item.name)).toEqual(['cache-stats']);
    expect(extensionItems[0]).toMatchObject({
      groupLabel: 'Extension',
      acceptsArgs: true,
      available: true,
      description: 'From extension pi-deepseek-cache',
    });
    expect(filterSlashItems(catalog, 'cache').map((item) => item.id)).toContain('extension:cache-stats');
  });

  it('requires project trust like skills do', () => {
    const catalog = buildSlashCatalog({
      skills: [],
      extensionCommands: [{ name: 'cache-stats', extensionName: 'cache' }],
      hasActiveSession: true,
      projectTrusted: false,
      requireProjectTrust: true,
    });
    expect(catalog.find((item) => item.kind === 'extension')).toMatchObject({
      available: false,
      unavailableReason: 'Trust the project first',
    });
  });
});

describe('buildSlashCatalog — backend commands (ADR 0082)', () => {
  const backendCommands = [
    { name: 'help', description: 'Show Grok help' },
    { name: 'compact', description: 'Compact the Grok context' },
    { name: 'model', description: 'Switch model', inputHint: '<name>' },
  ];

  it('lists the backend commands for a backend session', () => {
    const catalog = buildSlashCatalog({
      skills: [],
      hasActiveSession: true,
      projectTrusted: true,
      backendSession: true,
      backendCommands,
    });
    const help = catalog.find((item) => item.id === 'backend:help');
    expect(help?.kind).toBe('backend');
    expect(help?.groupLabel).toBe('Backend');
    expect(help?.available).toBe(true);
    // The argument hint is surfaced so the token is usable without docs.
    expect(catalog.find((item) => item.id === 'backend:model')?.description).toContain('<name>');
  });

  it('drops Pi product commands and Pi modes rather than offering what cannot run', () => {
    const catalog = buildSlashCatalog({
      skills: [],
      hasActiveSession: true,
      projectTrusted: true,
      backendSession: true,
      backendCommands,
    });
    expect(catalog.find((item) => item.name === 'scheme')).toBeUndefined();
    expect(catalog.find((item) => item.kind === 'mode')).toBeUndefined();
    // Pi compaction is gone too; Grok's own `/compact` is listed instead.
    expect(catalog.find((item) => item.id === 'cmd:compact')).toBeUndefined();
    expect(catalog.find((item) => item.id === 'backend:compact')).toBeTruthy();
  });

  it('keeps Pi commands and modes for a Pi session', () => {
    const catalog = buildSlashCatalog({
      skills: [],
      hasActiveSession: true,
      projectTrusted: true,
    });
    expect(catalog.find((item) => item.id === 'cmd:compact')).toBeTruthy();
    expect(catalog.find((item) => item.kind === 'mode')).toBeTruthy();
  });

  it('lets a backend token override a piwin item with the same name', () => {
    // piwin defines `knowledge` as a local panel. If the backend claims the
    // token, the backend's meaning wins because piwin sends it verbatim.
    const catalog = buildSlashCatalog({
      skills: [],
      hasActiveSession: true,
      projectTrusted: true,
      backendSession: true,
      backendCommands: [{ name: 'knowledge', description: 'Grok knowledge search' }],
    });
    expect(catalog.find((item) => item.id === 'cmd:knowledge')).toBeUndefined();
    expect(catalog.find((item) => item.id === 'backend:knowledge')).toBeTruthy();
  });

  it('ranks backend commands below piwin commands so they do not crowd the menu', () => {
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
      backendSession: true,
      backendCommands,
    });
    const ordered = filterSlashItems(catalog, '');
    const firstBackendIndex = ordered.findIndex((item) => item.kind === 'backend');
    expect(firstBackendIndex).toBeGreaterThanOrEqual(0);
    // Backend commands form the tail: no piwin-owned item sorts after them.
    expect(ordered.slice(firstBackendIndex).every((item) => item.kind === 'backend')).toBe(true);
  });

  it('ignores an empty backend command list', () => {
    const catalog = buildSlashCatalog({
      skills: [],
      hasActiveSession: true,
      projectTrusted: true,
      backendCommands: [],
    });
    expect(catalog.some((item) => item.kind === 'backend')).toBe(false);
    expect(catalog.find((item) => item.id === 'cmd:compact')).toBeTruthy();
  });
});


describe('extension command purpose discovery', () => {
  it('shows registered descriptions and supports Chinese purpose searches', () => {
    const catalog = buildSlashCatalog({ skills: [], hasActiveSession: true, projectTrusted: true,
      extensionCommands: [
        { name: 'teacher-ta', extensionName: 'Study Space', description: '助教答疑 · Answer code questions' },
        { name: 'teacher-learn', extensionName: 'Study Space', description: '开始学习 · Learn a topic' },
        { name: 'teacher-review', extensionName: 'Study Space', description: '到期复习 · Review scheduled cards' },
      ] });
    expect(catalog.find(item => item.name === 'teacher-ta')?.label).toBe('助教答疑 · Answer code questions');
    for (const [query, name] of [['助教', 'teacher-ta'], ['学习', 'teacher-learn'], ['复习', 'teacher-review']]) {
      expect(filterSlashItems(catalog, query ?? '').map(item => item.name)).toContain(name);
    }
  });
});

describe('buildSlashCatalog — handoff', () => {
  it('offers /handoff only when the Host and session support it', () => {
    const base = { skills, hasActiveSession: true, projectTrusted: true };
    expect(buildSlashCatalog(base).some((item) => item.id === 'cmd:handoff')).toBe(false);
    const item = buildSlashCatalog({ ...base, handoffSupported: true }).find(
      (entry) => entry.id === 'cmd:handoff',
    );
    expect(item).toMatchObject({ kind: 'command', available: true, acceptsArgs: true });
    expect(
      buildSlashCatalog({ ...base, handoffSupported: true, backendSession: true }).some(
        (entry) => entry.id === 'cmd:handoff',
      ),
    ).toBe(false);
  });

  it('explains why /handoff is unavailable while a run streams or without a session', () => {
    const streaming = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
      handoffSupported: true,
      streaming: true,
    }).find((entry) => entry.id === 'cmd:handoff');
    expect(streaming).toMatchObject({
      available: false,
      unavailableReason: 'Wait for the current run to finish',
    });
    const draft = buildSlashCatalog({ skills, handoffSupported: true }).find(
      (entry) => entry.id === 'cmd:handoff',
    );
    expect(draft).toMatchObject({ available: false, unavailableReason: 'Start or select a session first' });
  });

  it('matches the Chinese keyword', () => {
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
      handoffSupported: true,
    });
    expect(filterSlashItems(catalog, 'hand').map((item) => item.id)).toContain('cmd:handoff');
  });
});
