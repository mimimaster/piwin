import { artifactEndMarker } from './html.js';
import { ARTIFACT_TRAILING_MARKDOWN, type ArtifactStreamingDeltaStep } from './types.js';

const OPEN = '```artifact-html';

export const STREAMING_DELTA_STEPS: readonly ArtifactStreamingDeltaStep[] = [
  {
    phase: 'streaming',
    text: [
      OPEN,
      '<button type="button" id="count">0</button>',
      '<div class="grow" style="height:120px">Hel',
    ].join('\n'),
  },
  {
    phase: 'streaming',
    text: [
      OPEN,
      '<button type="button" id="count">0</button>',
      '<div class="grow" style="height:480px">Hello wor',
    ].join('\n'),
  },
  {
    phase: 'completed',
    text: [
      OPEN,
      '<button type="button" id="count">0</button>',
      '<script>count.onclick=function(){count.textContent="1"}</script>',
      '<div class="grow" style="height:960px">Hello world</div>',
      artifactEndMarker('streaming-script'),
      '```',
      '',
      ARTIFACT_TRAILING_MARKDOWN,
      '',
    ].join('\n'),
  },
];
