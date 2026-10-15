/**
 * Viz kit (ADR 0093): step-through figures for algorithms, memory, OS and
 * networking. The model writes each step's state as JSON; the host kit only
 * draws it. `@piwin/artifact` must implement every kind and icon listed here
 * (checked by test).
 */

export const ARTIFACT_VIZ_KINDS = [
  'array',
  'stack',
  'list',
  'tree',
  'graph',
  'hash',
  'window',
  'bits',
  'grid',
  'gantt',
  'blocks',
  'seek',
  'layers',
  'topo',
  'seq',
] as const;

export type ArtifactVizKind = (typeof ARTIFACT_VIZ_KINDS)[number];

export const ARTIFACT_VIZ_ICONS = ['host', 'laptop', 'phone', 'server', 'db', 'hub', 'switch', 'router', 'firewall', 'ap', 'cloud'] as const;

/** Resident pointer (fixed token budget, CHT-803): names the markup and kinds only. */
export function formatArtifactVizKit(): string {
  return `- Step-through figures: \`<figure data-piwin-viz="KIND">\` + JSON, kinds ${ARTIFACT_VIZ_KINDS.join(' ')}; prefer them over hand-written animation for algorithms, memory, scheduling and networking. \`artifact_instructions\` has the fields.`;
}

/** Field reference returned by `artifact_instructions` (not resident). */
export function formatArtifactVizKitReference(): string[] {
  return [
    'Viz figures: `<figure data-piwin-viz="KIND"><script type="application/json">{..}</script><figcaption>takeaway</figcaption></figure>`. The kit only draws: you compute every state.',
    '- `steps`: list of partial specs, each shallow-merged over the top-level fields, with `note` (one short sentence). The figure rests on the last step and gets ◀ ▶ controls; `speed` ms per step. Omit `steps` for a still figure.',
    '- Tones for marks: warn (comparing/waiting), accent (current/changed), ok (done/hit), risk (fault/miss), info, muted. `table`: {"head":[..],"rows":[["label",..]],"marks":{"r.c":tone}} under any figure.',
    '- array {items, marks{i}, pointers{i:"j"}, index:false}. stack {items bottom→top, capacity, marks{i}}. list {nodes[{id,value,col,row:0|1,head}], next{id:id}, marks{id}, linkMarks{fromId}, pointers{id:"p"}}; a node without next shows ∧.',
    '- tree {tree:[level-order, null gaps, heap indexing k→2k+1,2k+2], marks{value}, balance:true shows balance factors}. graph {nodes{id:[x,y]}, edges[[a,b,weight]], directed, marks{id}, edgeMarks[[a,b,tone]]}. hash {buckets[[keys]], marks{"b"|"b.i"}}. window {count, size, start, marks{i}}: unmarked cells in the window read as sendable.',
    '- bits {fields[{name,bits,value,tone,dashed}], width}: one register with bit ranges when the fields fit `width`, otherwise a header grid of `width`-bit rows (TCP/IP headers, width 32).',
    '- grid {cols[..], rows[{label,cells[..]}], marks{"r.c"}, now, upto}: pipeline space-time (cell "~" = bubble), page replacement. gantt {segments[{label,from,to}], upto}. blocks {total, unit, blocks[{label,from,to,kind:"free"|"fixed",tone}]}. seek {range[min,max], path[..], upto}. layers {cols[weights], rows[{label,sub,parts[{text,from,to,series:1-6}]}], upto}: encapsulation.',
    `- topo {nodes[{id,icon,x,y,label,sub}], links[[a,b,"wireless"?]], zones[{x,y,w,h,label}], at (packet at node), via[a,b] (lit link), marks{id}}; place nodes ~110px apart. seq {actors[{id,label,icon}], msgs[{from,to,label}], states{actorId:[[label,afterMsgCount]]}, upto}. Icons: ${ARTIFACT_VIZ_ICONS.join(' ')}.`,
  ];
}
