import { describe, expect, it } from 'vitest';
import { artifactFileName, buildArtifactHostPage, listTranscriptArtifacts } from './artifact-export.js';
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
    const named = (title: string): string => artifactFileName({ key: 'k', title, kind: 'html', source: '' });
    expect(named('计数器 / demo: v1?')).toBe('计数器 demo v1.html');
    expect(named('///')).toBe('artifact.html');
    expect(named('x'.repeat(200))).toHaveLength(65);
  });
});
