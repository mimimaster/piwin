import type { ReactElement } from 'react';
import { DocPreviewPanel } from '../DocPreviewPanel.js';

const SOURCE = Array.from({ length: 2000 }, (_, index) => {
  if (index === 78) return '/* multiline comment begins';
  if (index === 81) return 'end of multiline comment */';
  return `const value${index} = "hello world";`;
}).join('\n');

export function CodePreviewGallery(): ReactElement {
  return (
    <div style={{ height: '80vh', width: 640 }}>
      <DocPreviewPanel title="large.ts" filePath="large.ts" content={SOURCE} />
    </div>
  );
}
