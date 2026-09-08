import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { TranscriptViewport } from '../transcript-viewport';
import { TranscriptTurnList } from '../transcript-turn-list';
import { groupTranscriptTurns } from '../transcript-turns';
import type { ChatMessageUi } from '../chat-reducer';

/** Synthetic geometry only: no real session contents or Host writes. */
export function TranscriptScrollGallery(): ReactElement {
  const [session, setSession] = useState(0);
  const [count, setCount] = useState(2);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [tailGrowth, setTailGrowth] = useState(0);
  const [staged, setStaged] = useState(false);
  const [layoutPhase, setLayoutPhase] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLOutputElement>(null);
  const messages: ChatMessageUi[] = Array.from({ length: loaded ? count : 0 }, (_, index) => ({
    id: `fixture-${index}`,
    role: 'user',
    text: `Turn ${index + 1}`,
    thinking: '',
    attachments: [],
    tools: [],
    status: revision % 2 === 0 ? 'done' : 'streaming',
  }));
  const turns = groupTranscriptTurns(messages);
  const sampledGrowth = staged ? 0 : tailGrowth;

  useEffect(() => {
    if (!staged || !loaded) return;
    const timers = [120, 260, 400].map((delay, index) =>
      window.setTimeout(() => {
        setTailGrowth((index + 1) * 500);
        setLayoutPhase(index + 1);
      }, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [staged, loaded, session]);

  useLayoutEffect(() => {
    const frames: Array<{
      top: number;
      height: number;
      gap: number;
      visible: boolean;
      phase: number;
    }> = [];
    let frame = 0;
    const sample = (): void => {
      const scroll = rootRef.current?.querySelector<HTMLElement>('.chat-stream');
      if (scroll && reportRef.current) {
        frames.push({
          top: scroll.scrollTop,
          height: scroll.scrollHeight,
          gap: Math.max(0, scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop),
          visible: getComputedStyle(scroll).visibility !== 'hidden',
          phase: Number(rootRef.current?.dataset.layoutPhase ?? 0),
        });
        reportRef.current.textContent = JSON.stringify(frames);
      }
      if (frames.length < (staged ? 90 : 30)) frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [session, loaded, revision, count, sampledGrowth, staged]);

  const openSession = (turnCount: number): void => {
    setCount(turnCount);
    setSession((current) => current + 1);
    setLoaded(false);
    setRevision(0);
    setTailGrowth(0);
    setStaged(false);
    setLayoutPhase(0);
  };

  return (
    <div ref={rootRef} data-layout-phase={layoutPhase} style={{ padding: 24 }}>
      <Button onClick={() => openSession(2)}>Open two heavy turns</Button>
      <Button onClick={() => openSession(60)}>Open long history</Button>
      <Button onClick={() => setLoaded(true)}>Load transcript</Button>
      <Button onClick={() => setSession((current) => current + 1)}>Reopen transcript</Button>
      <Button onClick={() => setRevision((current) => current + 1)}>Update status</Button>
      <Button onClick={() => setTailGrowth((current) => current + 500)}>Grow content</Button>
      <Button
        onClick={() => {
          openSession(2);
          setLoaded(true);
          setStaged(true);
        }}
      >
        Open with delayed layout
      </Button>
      <div style={{ height: 550, display: 'flex', flexDirection: 'column' }}>
        <TranscriptViewport
          key={session}
          sessionId={`scroll-fixture-${session}`}
          awaitingTranscript={!loaded}
          messageCount={messages.length}
          activitySignal={`revision-${revision}`}
        >
          <TranscriptTurnList
            turns={turns}
            pinnedMessageId={null}
            renderTurn={(turn) => (
              <section
                style={{
                  height: turn.id === 'turn-fixture-0' ? 6_000 : 900 + tailGrowth,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                }}
              >
                <p>{turn.items[0]?.message.text}</p>
                <p>
                  {turn.id === `turn-fixture-${count - 1}` ? 'END OF CONVERSATION' : 'End of turn'}
                </p>
              </section>
            )}
          />
        </TranscriptViewport>
      </div>
      <output
        ref={reportRef}
        data-testid="scroll-frame-report"
        style={{ display: 'block', maxHeight: 120, overflow: 'auto' }}
      />
    </div>
  );
}
