/**
 * Isolated knowledge-workspace fixture (knowledge product integration, stage 0).
 *
 * One temp `piwinRoot` with the content shapes the workspace has to survive:
 * a Chinese long-form document with headings, a code block and a table, a
 * readable-but-never-indexed folder, a registered folder whose directory was
 * deleted, one wiki page, and a basic plus a cloze card that carry a real
 * source relation.
 *
 * Later stages assert against this fixture instead of inventing their own
 * roots, so a regression in any one of those shapes is visible in one place.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFolderRag, type FolderRag } from '@piwin/doc-rag';
import { createStudyServices } from '@piwin/flashcards';
import { createDefaultPiwinConfig } from './config-store.js';
import { addFolderKnowledgeBase, type KnowledgeBaseRuntime } from './knowledge-base-service.js';
import { getPiwinKnowledgeCollectionsPath, getPiwinKnowledgeDir } from './paths.js';
import { writeWikiConcept } from './wiki-service.js';

const LONG_FORM_ZH = `# 极限的定义

数列极限的直觉是「无限接近」。严格的 epsilon-N 定义把直觉写成可检验的命题。

## 一、定义

设 {a_n} 是数列，若对任意 epsilon > 0，存在 N，当 n > N 时 |a_n - a| < epsilon，则称数列收敛于 a。

## 二、常见误区

- 把「越来越接近」当成收敛，忽略了「最终任意接近」。
- 忽略 N 依赖于 epsilon，把它当成固定常数。

## 三、代码示例

\`\`\`python
def converges(values, eps):
    """Return the first N past which every later term stays within eps."""
    for index, value in enumerate(values):
        if all(abs(later - value) < eps for later in values[index:]):
            return index
    return None
\`\`\`

## 四、对照表

| 概念 | 直觉表述 | 严格表述 |
| --- | --- | --- |
| 收敛 | 越来越接近 | 对任意 epsilon 存在 N |
| 发散 | 不收敛 | 否命题成立 |

理解定义之后，判断收敛问题就变成了构造 N 的问题。
`;

const SECOND_DOC_ZH = `# 第一章 线性映射

线性映射保持加法与数乘。矩阵是线性映射在选定基下的坐标表达。

## 1.1 核与像

核是映射为零向量的原像集合，像是映射的值域。秩-零化度定理把两者维数联系起来。
`;

const WIKI_CONCEPT_BODY = `极限的严格定义把「无限接近」写成对任意 epsilon 的构造性命题。

## 要点

- N 依赖 epsilon，不是固定常数。
- 收敛性讨论必须给出数列本身，而不是前若干项。

## 相关

- [[第一章 线性映射]]
`;

export type KnowledgeWorkspaceFixture = {
  root: string;
  /** Registered and indexed; holds the Chinese long-form document. */
  indexedFolder: string;
  /** Registered, readable on disk, never indexed. */
  unindexedFolder: string;
  /** Registered, then deleted from disk. */
  missingFolder: string;
  indexedBaseId: string;
  unindexedBaseId: string;
  missingBaseId: string;
  /** Wiki page path, relative to the wiki root. */
  wikiRelativePath: string;
  basicItemId: string;
  clozeItemId: string;
  rag: FolderRag;
  close: () => Promise<void>;
};

export async function openKnowledgeWorkspaceFixture(): Promise<KnowledgeWorkspaceFixture> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-knowledge-workspace-'));
  const indexedFolder = join(root, 'sources', 'math');
  const unindexedFolder = join(root, 'sources', 'java');
  const missingFolder = join(root, 'sources', 'moved-away');
  await mkdir(indexedFolder, { recursive: true });
  await mkdir(unindexedFolder, { recursive: true });
  await mkdir(missingFolder, { recursive: true });
  await writeFile(join(indexedFolder, '极限的定义.md'), LONG_FORM_ZH, 'utf8');
  await writeFile(join(indexedFolder, '线性映射.md'), SECOND_DOC_ZH, 'utf8');
  await writeFile(join(unindexedFolder, '泛型.md'), '# 泛型\n\n泛型在编译期擦除。\n', 'utf8');

  const rag = createFolderRag({ piwinRoot: root });
  const runtime: KnowledgeBaseRuntime = {
    piwinRoot: root,
    getFolderRag: async () => rag,
    loadConfig: async () => createDefaultPiwinConfig(),
  };
  const indexedBase = await addFolderKnowledgeBase(runtime, indexedFolder, '数学');
  const unindexedBase = await addFolderKnowledgeBase(runtime, unindexedFolder, 'Java');
  const missingBase = await addFolderKnowledgeBase(runtime, missingFolder, '已移动的资料');
  await rag.indexFolder(indexedFolder);
  // Register first, then delete: the "source is gone" state, not a broken registry.
  await rm(missingFolder, { recursive: true, force: true });

  const concept = await writeWikiConcept(root, {
    title: '极限的严格定义',
    content: WIKI_CONCEPT_BODY,
    summary: '用 epsilon-N 语言重写「无限接近」。',
    tags: ['数学', '极限'],
    logMessage: 'fixture: seed concept',
  });

  const cards = createStudyServices({ piwinRoot: root });
  const basic = await cards.cardStore.create({
    model: 'basic',
    deck: '数学',
    front: '数列收敛的 epsilon-N 定义是什么？',
    back: '对任意 epsilon > 0 存在 N，当 n > N 时 |a_n - a| < epsilon。',
    sourceFolder: indexedFolder,
    sourceFile: '极限的定义.md',
    sourceLine: 7,
    sourceExcerpt: '若对任意 epsilon > 0，存在 N',
  });
  const cloze = await cards.cardStore.create({
    model: 'cloze',
    deck: '数学',
    text: '收敛要求 {{c1::N 依赖 epsilon}}，而不是固定常数。',
    sourceFolder: indexedFolder,
    sourceFile: '极限的定义.md',
    sourceLine: 13,
  });

  await writeCollections(root, indexedBase.id, concept.relativePath);

  return {
    root,
    indexedFolder,
    unindexedFolder,
    missingFolder,
    indexedBaseId: indexedBase.id,
    unindexedBaseId: unindexedBase.id,
    missingBaseId: missingBase.id,
    wikiRelativePath: concept.relativePath,
    basicItemId: basic.id,
    clozeItemId: cloze.id,
    rag,
    close: async () => {
      rag.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function writeCollections(
  piwinRoot: string,
  materialBaseId: string,
  wikiRelativePath: string,
): Promise<void> {
  const now = new Date().toISOString();
  const body = {
    version: 1,
    collections: [
      {
        id: 'collection:kaoyan-math',
        name: '考研数学',
        createdAt: now,
        updatedAt: now,
        members: [
          { kind: 'material', baseId: materialBaseId, relativePath: '极限的定义.md' },
          { kind: 'wiki', relativePath: wikiRelativePath },
        ],
      },
    ],
  };
  await mkdir(getPiwinKnowledgeDir(piwinRoot), { recursive: true });
  await writeFile(
    getPiwinKnowledgeCollectionsPath(piwinRoot),
    JSON.stringify(body, null, 2),
    'utf8',
  );
}
