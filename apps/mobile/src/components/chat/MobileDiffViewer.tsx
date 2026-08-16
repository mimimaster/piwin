import type { ReactElement } from 'react';

export type MobileDiffViewerProps = {
  diffText: string;
};

type DiffLine = {
  type: 'add' | 'delete' | 'context' | 'header';
  text: string;
  oldNum?: number | undefined;
  newNum?: number | undefined;
};

function parseDiffLines(rawDiff: string): DiffLine[] {
  const lines = rawDiff.split('\n');
  const result: DiffLine[] = [];
  let oldLineCounter = 1;
  let newLineCounter = 1;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      result.push({ type: 'header', text: line });
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match && match[1] && match[2]) {
        oldLineCounter = parseInt(match[1], 10);
        newLineCounter = parseInt(match[2], 10);
      }
    } else if (line.startsWith('+')) {
      result.push({
        type: 'add',
        text: line.slice(1),
        newNum: newLineCounter++,
      });
    } else if (line.startsWith('-')) {
      result.push({
        type: 'delete',
        text: line.slice(1),
        oldNum: oldLineCounter++,
      });
    } else {
      result.push({
        type: 'context',
        text: line.startsWith(' ') ? line.slice(1) : line,
        oldNum: oldLineCounter++,
        newNum: newLineCounter++,
      });
    }
  }

  return result;
}

export function MobileDiffViewer({ diffText }: MobileDiffViewerProps): ReactElement {
  const diffLines = parseDiffLines(diffText);

  return (
    <div className="mobile-diff-viewer" role="region" aria-label="代码变更 Diff">
      <div className="mobile-diff-content">
        {diffLines.map((line, index) => {
          if (line.type === 'header') {
            return (
              <div key={index} className="diff-line header">
                <span className="diff-text">{line.text}</span>
              </div>
            );
          }

          return (
            <div key={index} className={`diff-line ${line.type}`}>
              <span className="diff-num old">{line.oldNum ?? ''}</span>
              <span className="diff-num new">{line.newNum ?? ''}</span>
              <span className="diff-sign">
                {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
              </span>
              <span className="diff-text">{line.text || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
