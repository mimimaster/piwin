import { describe, expect, it } from 'vitest';
import {
  artifactFileName,
  artifactSourceFileName,
  buildArtifactHostPage,
  countTranscriptArtifacts,
  formatByteSize,
  listTranscriptArtifacts,
  splitMessageArtifacts,
} from './artifact-export.js';
import { EMPTY_TRANSCRIPT, appendLocalUserMessage, applyAgentEvent, type TranscriptState } from './transcript-model.js';

const FENCE = '```';

function assistant(state: TranscriptState, id: string, text: string): TranscriptState {
  const started = applyAgentEvent(state, { type: 'message/start', messageId: id, role: 'assistant' });
  return applyAgentEvent(started, { type: 'message/text_delta', messageId: id, delta: text });
}

function artifactFence(title: string, body: string): string {
  return `${FENCE}artifact-html title="${title}"\n${body}\n${FENCE}`;
}

describe('listTranscriptArtifacts', () => {
  it('finds artifacts in assistant messages, newest first, and skips ordinary code', () => {
    let state = assistant(EMPTY_TRANSCRIPT, 'a1', `先看这个\n${artifactFence('旧的', '<p>old</p>')}`);
    state = assistant(state, 'a2', `${FENCE}ts\nconst x = 1;\n${FENCE}\n${artifactFence('新的', '<p>new</p>')}`);
    const artifacts = listTranscriptArtifacts(state);
    expect(artifacts.map((artifact) => [artifact.title, artifact.kind])).toEqual([
      ['新的', 'html'],
      ['旧的', 'html'],
    ]);
    expect(artifacts[0]?.source).toBe('<p>new</p>');
    expect(artifacts[0]?.document?.srcdoc).toContain('<p>new</p>');
  });

  it('ignores a user message that quotes an artifact and a fence still streaming', () => {
    let state = appendLocalUserMessage(EMPTY_TRANSCRIPT, 'u1', artifactFence('用户贴的', '<p>x</p>'));
    state = assistant(state, 'a1', `${FENCE}artifact-html title="没写完"\n<p>half`);
    expect(listTranscriptArtifacts(state)).toEqual([]);
  });

  it('keeps an artifact the policy blocks, without a document to export', () => {
    const state = assistant(
      EMPTY_TRANSCRIPT,
      'a1',
      artifactFence('带外链', '<img src="https://example.com/x.png" alt="">'),
    );
    const [blocked] = listTranscriptArtifacts(state);
    expect(blocked?.blocked).toBe('引用了外部资源');
    expect(blocked?.document).toBeUndefined();
    expect(blocked === undefined ? undefined : buildArtifactHostPage(blocked)).toBeUndefined();
  });
});

describe('buildArtifactHostPage', () => {
  const [artifact] = listTranscriptArtifacts(
    assistant(EMPTY_TRANSCRIPT, 'a1', artifactFence('计数器 <b> & v1', '<button onclick="n++">加一</button>')),
  );
  const page = artifact === undefined ? '' : (buildArtifactHostPage(artifact) ?? '');

  it('puts the artifact in a script-only sandbox frame and nowhere else', () => {
    expect(page).toContain('<iframe sandbox="allow-scripts"');
    expect(page).not.toContain('allow-same-origin');
    expect(page.match(/<iframe/g)).toHaveLength(1);
    // The model's markup exists only as an escaped attribute value, never as live outer markup.
    expect(page).not.toContain('<button onclick');
    expect(page).toContain('&lt;button onclick=&quot;n++&quot;&gt;');
  });

  it('declares the artifact policy on the outer page and runs no script of its own', () => {
    expect(page).toContain(`http-equiv="Content-Security-Policy" content="default-src 'none'`);
    expect(page).toContain("connect-src 'none'");
    expect(page).not.toMatch(/<script/i);
  });

  it('escapes the title wherever it appears', () => {
    expect(page).toContain('<title>计数器 &lt;b&gt; &amp; v1 · piwin</title>');
    expect(page).toContain('title="计数器 &lt;b&gt; &amp; v1"');
    expect(page).not.toContain('<b>');
  });
});

describe('artifactFileName', () => {
  it('keeps a readable name and drops what a file system or shell would choke on', () => {
    const named = (title: string): string => artifactFileName({ key: 'k', title, kind: 'html', source: '', byteSize: 0 });
    expect(named('计数器 / demo: v1?')).toBe('计数器 demo v1.html');
    expect(named('///')).toBe('artifact.html');
    expect(named('x'.repeat(200))).toHaveLength(65);
  });
});

describe('splitMessageArtifacts', () => {
  it('cuts finished artifacts out of the prose and keeps ordinary code in it', () => {
    const text = `前言\n${artifactFence('卡片', '<p>hi</p>')}\n中间\n${FENCE}ts\nconst x = 1;\n${FENCE}\n结尾`;
    const segments = splitMessageArtifacts('m1', text);
    expect(segments.map((segment) => segment.kind)).toEqual(['markdown', 'artifact', 'markdown']);
    expect(segments[0]).toEqual({ kind: 'markdown', text: '前言\n' });
    const card = segments[1];
    expect(card?.kind === 'artifact' && card.artifact.title).toBe('卡片');
    expect(card?.kind === 'artifact' && card.artifact.byteSize).toBe(9);
    expect(segments[2]?.kind === 'markdown' && segments[2].text).toContain('const x = 1;');
  });

  it('leaves a fence that is still streaming as Markdown', () => {
    const text = `开始\n${FENCE}artifact-html title="半截"\n<p>`;
    expect(splitMessageArtifacts('m1', text)).toEqual([{ kind: 'markdown', text }]);
  });

  it('keeps blocked artifacts as cards with the reason', () => {
    const segments = splitMessageArtifacts('m1', artifactFence('外链', '<script src="https://x.test/a.js"></script>'));
    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind === 'artifact' && segments[0].artifact.blocked).toBe('引用了外部资源');
  });
});

describe('artifactSourceFileName / formatByteSize', () => {
  it('names saved source by kind and numbers retries', () => {
    expect(artifactSourceFileName({ title: '图 / 1', kind: 'svg' })).toBe('图 1.svg');
    expect(artifactSourceFileName({ title: 'demo', kind: 'html' }, 1)).toBe('demo-2.html');
    expect(formatByteSize(812)).toBe('812 B');
    expect(formatByteSize(12_595)).toBe('12.3 KB');
  });
});

describe('countTranscriptArtifacts', () => {
  it('agrees with the list for finished messages and skips one still streaming', () => {
    let state = assistant(EMPTY_TRANSCRIPT, 'a1', `${artifactFence('一', '<p>1</p>')}\n${FENCE}ts\nx\n${FENCE}`);
    state = applyAgentEvent(state, { type: 'message/end', messageId: 'a1' } as never);
    state = assistant(state, 'a2', artifactFence('二', '<p>2</p>'));
    const streaming = state.entries.find((entry) => entry.id === 'a2');
    expect(streaming?.kind === 'message' && streaming.status).toBe('streaming');
    expect(countTranscriptArtifacts(state)).toBe(1);
    const done = {
      ...state,
      entries: state.entries.map((entry) => (entry.kind === 'message' ? { ...entry, status: 'done' as const } : entry)),
    };
    expect(countTranscriptArtifacts(done)).toBe(listTranscriptArtifacts(done).length);
    expect(countTranscriptArtifacts(done)).toBe(2);
  });

  it('stays fast over a long conversation while one message streams', () => {
    const entries = Array.from({ length: 400 }, (_, index) => ({
      kind: 'message' as const,
      id: `m${index}`,
      role: 'assistant' as const,
      text: artifactFence(`第${index}个`, '<p>x</p>'.repeat(50)),
      thinking: '',
      status: 'done' as const,
      tools: [],
    }));
    const state = { entries, noticeCount: 0 } as unknown as TranscriptState;
    countTranscriptArtifacts(state);
    const started = performance.now();
    for (let frame = 0; frame < 200; frame += 1) countTranscriptArtifacts({ ...state, entries: [...entries] });
    expect(performance.now() - started).toBeLessThan(200);
  });
});
