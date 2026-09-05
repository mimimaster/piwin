import type { CSSProperties, ReactElement } from 'react';

/** Prototype voice animation: bar height follows --level, silencing flattens it. */
export function VoiceBars({
  levels,
  muted = false,
}: {
  levels: number[];
  muted?: boolean;
}): ReactElement {
  return (
    <div className="voice-bars" aria-hidden="true">
      {levels.map((level, index) => (
        <i key={index} style={{ '--level': muted ? 0 : level } as CSSProperties} />
      ))}
    </div>
  );
}
