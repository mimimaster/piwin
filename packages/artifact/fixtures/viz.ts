/**
 * One sample spec per viz kind (ADR 0093), taken from the approved 408
 * sketches. Used by the runtime tests and the desktop kit showcase; each is
 * what a model would write into `<figure data-piwin-viz="KIND">`.
 */
import type { ArtifactVizKind } from '@piwin/contracts';

export type ArtifactVizSample = { title: string; spec: Record<string, unknown> };

function bubbleSortSteps(): Record<string, unknown>[] {
  const items = [5, 2, 4, 1, 3];
  const done: number[] = [];
  const doneMarks = () => Object.fromEntries(done.map((i) => [i, 'ok']));
  const steps: Record<string, unknown>[] = [{ items: [...items], note: '冒泡排序：每一趟把最大的数换到末尾' }];
  for (let pass = 0; pass < items.length - 1; pass++) {
    for (let j = 0; j < items.length - 1 - pass; j++) {
      const left = items[j] ?? 0;
      const right = items[j + 1] ?? 0;
      steps.push({ items: [...items], marks: { ...doneMarks(), [j]: 'warn', [j + 1]: 'warn' }, pointers: { [j]: 'j' }, note: `第 ${pass + 1} 趟：比较 ${left} 和 ${right}` });
      if (left > right) {
        items[j] = right;
        items[j + 1] = left;
        steps.push({ items: [...items], marks: { ...doneMarks(), [j]: 'accent', [j + 1]: 'accent' }, pointers: { [j]: 'j' }, note: `${left} > ${right}，交换` });
      }
    }
    done.push(items.length - 1 - pass);
  }
  done.push(0);
  steps.push({ items: [...items], marks: doneMarks(), pointers: {}, note: '排序完成' });
  return steps;
}

function lruTrace(): Record<string, unknown> {
  const refs = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2];
  const slots: (number | null)[] = [null, null, null];
  const rows: (number | string | null)[][] = [[], [], [], []];
  const marks: Record<string, string> = {};
  let recent: number[] = [];
  let misses = 0;
  refs.forEach((page, col) => {
    const hit = slots.includes(page);
    if (!hit) {
      misses += 1;
      const empty = slots.indexOf(null);
      const slot = empty >= 0 ? empty : slots.indexOf(recent[0] ?? null);
      slots[slot] = page;
      marks[`${slot}.${col}`] = 'accent';
      marks[`3.${col}`] = 'risk';
    }
    recent = recent.filter((p) => p !== page).concat(page);
    slots.forEach((value, r) => rows[r]?.push(value));
    rows[3]?.push(hit ? null : '×');
  });
  return {
    cols: refs,
    rows: ['块 1', '块 2', '块 3', '缺页'].map((label, r) => ({ label, cells: rows[r] })),
    marks,
    steps: refs.map((page, col) => ({ upto: col, now: col, note: col === refs.length - 1 ? `共缺页 ${misses} 次，缺页率 ${misses}/${refs.length}` : `访问 ${page}` })),
  };
}

const LIST_BASE = [
  { id: 'h', value: '', head: true },
  { id: 'a', value: 3 },
  { id: 'b', value: 8 },
  { id: 'c', value: 5 },
];

export const ARTIFACT_VIZ_SAMPLES: Record<ArtifactVizKind, ArtifactVizSample> = {
  array: { title: '数组 + 指针', spec: { steps: bubbleSortSteps(), speed: 650 } },
  stack: {
    title: '栈',
    spec: {
      capacity: 5,
      steps: [
        { items: [], note: '空栈，top = -1' },
        { items: [1], marks: { 0: 'accent' }, note: 'push 1' },
        { items: [1, 2], marks: { 1: 'accent' }, note: 'push 2' },
        { items: [1, 2, 3], marks: { 2: 'accent' }, note: 'push 3' },
        { items: [1, 2], marks: {}, note: 'pop → 3' },
        { items: [1, 2, 9], marks: { 2: 'accent' }, note: 'push 9' },
      ],
    },
  },
  list: {
    title: '链表',
    spec: {
      pointers: { h: 'L', b: 'p', s: 's' },
      steps: [
        { nodes: [...LIST_BASE, { id: 's', value: 7, col: 3, row: 1 }], next: { h: 'a', a: 'b', b: 'c' }, marks: { s: 'accent' }, note: '要在 p 之后插入新结点 s' },
        { nodes: [...LIST_BASE, { id: 's', value: 7, col: 3, row: 1 }], next: { h: 'a', a: 'b', b: 'c', s: 'c' }, marks: { s: 'accent' }, linkMarks: { s: 'accent' }, note: '① s->next = p->next' },
        { nodes: [...LIST_BASE, { id: 's', value: 7, col: 3, row: 1 }], next: { h: 'a', a: 'b', b: 's', s: 'c' }, marks: { s: 'accent' }, linkMarks: { b: 'accent' }, note: '② p->next = s（顺序不能反）' },
        { nodes: [...LIST_BASE.slice(0, 3), { id: 's', value: 7, col: 3 }, { id: 'c', value: 5, col: 4 }], next: { h: 'a', a: 'b', b: 's', s: 'c' }, marks: { s: 'ok' }, linkMarks: {}, pointers: { h: 'L' }, note: '插入完成' },
      ],
    },
  },
  tree: {
    title: '二叉树',
    spec: {
      balance: true,
      steps: [
        { tree: [3], note: '插入 3' },
        { tree: [3, 2], note: '插入 2' },
        { tree: [3, 2, null, 1], marks: { 3: 'risk' }, note: '插入 1：结点 3 失衡（LL 型）' },
        { tree: [2, 1, 3], marks: { 2: 'accent' }, note: '右旋：2 成为根' },
        { tree: [2, 1, 3, null, null, null, 4], marks: {}, note: '插入 4' },
        { tree: [2, 1, 3, null, null, null, 4, null, null, null, null, null, null, null, 5], marks: { 3: 'risk' }, note: '插入 5：结点 3 失衡（RR 型）' },
        { tree: [2, 1, 4, null, null, 3, 5], marks: { 4: 'accent' }, note: '左旋：4 上升，平衡恢复' },
      ],
    },
  },
  graph: {
    title: '图',
    spec: {
      nodes: { A: [40, 95], B: [165, 35], C: [165, 155], D: [295, 35], E: [295, 155] },
      edges: [['A', 'B', 4], ['A', 'C', 2], ['B', 'C', 1], ['B', 'D', 5], ['C', 'D', 8], ['C', 'E', 10], ['D', 'E', 2]],
      steps: [
        { marks: { A: 'accent' }, table: { head: ['', 'A', 'B', 'C', 'D', 'E'], rows: [['dist', 0, '∞', '∞', '∞', '∞']] }, note: '初始：dist[A] = 0' },
        { marks: { A: 'ok' }, edgeMarks: [['A', 'B', 'accent'], ['A', 'C', 'accent']], table: { head: ['', 'A', 'B', 'C', 'D', 'E'], rows: [['dist', 0, 4, 2, '∞', '∞']], marks: { '0.2': 'accent', '0.3': 'accent' } }, note: 'A 加入集合 S，松弛邻边' },
        { marks: { A: 'ok', C: 'ok' }, edgeMarks: [['C', 'B', 'accent'], ['C', 'D', 'accent'], ['C', 'E', 'accent']], table: { head: ['', 'A', 'B', 'C', 'D', 'E'], rows: [['dist', 0, 3, 2, 10, 12]], marks: { '0.2': 'accent', '0.4': 'accent', '0.5': 'accent' } }, note: '选 C(2)：B 更新为 3' },
        { marks: { A: 'ok', C: 'ok', B: 'ok' }, edgeMarks: [['B', 'D', 'accent']], table: { head: ['', 'A', 'B', 'C', 'D', 'E'], rows: [['dist', 0, 3, 2, 8, 12]], marks: { '0.4': 'accent' } }, note: '选 B(3)：D 更新为 8' },
        { marks: { A: 'ok', C: 'ok', B: 'ok', D: 'ok', E: 'ok' }, edgeMarks: [['A', 'C', 'ok'], ['C', 'B', 'ok'], ['B', 'D', 'ok'], ['D', 'E', 'ok']], table: { head: ['', 'A', 'B', 'C', 'D', 'E'], rows: [['dist', 0, 3, 2, 8, 10]] }, note: '全部确定，绿色边是最短路径树' },
      ],
    },
  },
  hash: {
    title: '散列表',
    spec: {
      steps: [
        { buckets: [[14], [1], [23], [], [], [19], [20]], note: 'H(key) = key mod 7' },
        { buckets: [[14], [1], [23], [], [], [19, 68], [20]], marks: { 5: 'warn', '5.1': 'accent' }, note: 'H(68) = 5，冲突，接到链尾' },
        { buckets: [[14, 84], [1], [23], [], [], [19, 68], [20, 27]], marks: { '0.1': 'accent', '6.1': 'accent' }, note: 'ASL成功 = (5×1 + 3×2) / 8 = 11/8' },
      ],
    },
  },
  window: {
    title: '滑动窗口',
    spec: {
      count: 12,
      size: 4,
      steps: [
        { start: 0, marks: {}, note: '发送窗口 4：0–3 可以发送' },
        { start: 0, marks: { 0: 'warn', 1: 'warn', 2: 'warn' }, note: '发送 0、1、2' },
        { start: 2, marks: { 0: 'ok', 1: 'ok', 2: 'warn' }, note: '收到 ACK 2，窗口右移' },
        { start: 2, marks: { 0: 'ok', 1: 'ok', 2: 'risk', 3: 'risk', 4: 'risk', 5: 'risk' }, note: '2 号超时：GBN 回退重传 2–5' },
      ],
    },
  },
  bits: {
    title: '位域',
    spec: {
      fields: [
        { name: 'S', bits: 1, value: '1' },
        { name: '阶码 E', bits: 8, value: '01111110' },
        { name: '尾数 M', bits: 23, value: '10000000000000000000000' },
      ],
    },
  },
  grid: {
    title: '流水线时空图',
    spec: {
      cols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      rows: [
        { label: 'lw  r1, 0(r2)', cells: ['IF', 'ID', 'EX', 'MEM', 'WB'] },
        { label: 'add r3, r1, r4', cells: [null, 'IF', 'ID', '~', '~', 'EX', 'MEM', 'WB'] },
        { label: 'sub r5, r6, r7', cells: [null, null, 'IF', '~', '~', 'ID', 'EX', 'MEM', 'WB'] },
        { label: 'or  r8, r9, r10', cells: [null, null, null, null, null, 'IF', 'ID', 'EX', 'MEM', 'WB'] },
      ],
      steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => ({ upto: t - 1, now: t - 1, note: t === 4 ? 'r1 要等 I1 写回：插入气泡' : t === 10 ? '共 10 个周期；没有相关时只要 8 个' : `时钟 ${t}` })),
      speed: 800,
    },
  },
  gantt: {
    title: '调度甘特图',
    spec: {
      segments: [
        { label: 'P1', from: 0, to: 2 }, { label: 'P2', from: 2, to: 4 }, { label: 'P3', from: 4, to: 5 }, { label: 'P1', from: 5, to: 7 },
        { label: 'P4', from: 7, to: 9 }, { label: 'P2', from: 9, to: 10 }, { label: 'P1', from: 10, to: 11 },
      ],
      steps: [
        { upto: 0, note: 'P1 用完时间片' }, { upto: 1, note: 'P2 运行' }, { upto: 2, note: 'P3 结束' }, { upto: 3, note: 'P1 再运行 2' },
        { upto: 4, note: 'P4 结束' }, { upto: 5, note: 'P2 结束' }, { upto: 6, note: '平均周转时间 7.25' },
      ],
    },
  },
  blocks: {
    title: '内存分区',
    spec: {
      total: 640,
      unit: 'K',
      steps: [
        { blocks: [{ label: 'OS', from: 0, to: 64, kind: 'fixed' }, { label: 'P1', from: 64, to: 200 }, { label: '', from: 200, to: 330, kind: 'free', tone: 'accent' }, { label: 'P2', from: 330, to: 400 }, { label: '', from: 400, to: 520, kind: 'free' }, { label: 'P3', from: 520, to: 580 }, { label: '', from: 580, to: 640, kind: 'free' }], note: 'P4 申请 100K：首次适应选中 200K 处' },
        { blocks: [{ label: 'OS', from: 0, to: 64, kind: 'fixed' }, { label: 'P1', from: 64, to: 200 }, { label: 'P4', from: 200, to: 300, tone: 'ok' }, { label: '', from: 300, to: 330, kind: 'free' }, { label: 'P2', from: 330, to: 400 }, { label: '', from: 400, to: 520, kind: 'free' }, { label: 'P3', from: 520, to: 580 }, { label: '', from: 580, to: 640, kind: 'free' }], note: '分配后留下 30K 碎片' },
      ],
    },
  },
  seek: {
    title: '磁盘调度',
    spec: { range: [0, 199], path: [100, 90, 58, 55, 39, 38, 18, 150, 160, 184], steps: [{ upto: 0, note: '磁头在 100（SSTF）' }, { upto: 6, note: '先扫完近处' }, { upto: 9, note: '总寻道 248，平均 27.6' }] },
  },
  layers: {
    title: '分层封装',
    spec: {
      cols: [1, 1, 1, 2.2, 0.9],
      rows: [
        { label: '应用层', sub: '报文', parts: [{ text: '数据', from: 4, to: 4 }] },
        { label: '传输层', sub: '报文段', parts: [{ text: 'TCP 首部', from: 3, to: 3, series: 1 }, { text: '数据', from: 4, to: 4 }] },
        { label: '网络层', sub: '分组', parts: [{ text: 'IP 首部', from: 2, to: 2, series: 2 }, { text: 'TCP 首部', from: 3, to: 3, series: 1 }, { text: '数据', from: 4, to: 4 }] },
        { label: '数据链路层', sub: '帧', parts: [{ text: '帧首部', from: 1, to: 1, series: 4 }, { text: 'IP 首部', from: 2, to: 2, series: 2 }, { text: 'TCP 首部', from: 3, to: 3, series: 1 }, { text: '数据', from: 4, to: 4 }, { text: '帧尾 FCS', from: 5, to: 5, series: 4 }] },
      ],
      steps: [{ upto: 0, note: '应用层交下来一段数据' }, { upto: 1, note: '加上 TCP 首部' }, { upto: 2, note: '加上 IP 首部' }, { upto: 3, note: '加上帧首部和帧尾' }],
    },
  },
  topo: {
    title: '网络拓扑',
    spec: {
      zones: [{ x: 14, y: 16, w: 262, h: 270, label: '192.168.1.0/24' }],
      nodes: [
        { id: 'pc1', icon: 'host', x: 70, y: 64, label: 'PC1', sub: '.10' }, { id: 'pc2', icon: 'host', x: 70, y: 148, label: 'PC2', sub: '.11' },
        { id: 'ph', icon: 'phone', x: 70, y: 234, label: '手机', sub: '.20' }, { id: 'ap', icon: 'ap', x: 196, y: 234, label: 'AP' },
        { id: 'sw', icon: 'switch', x: 196, y: 120, label: '交换机' }, { id: 'r1', icon: 'router', x: 336, y: 120, label: 'R1', sub: '网关 .1' },
        { id: 'fw', icon: 'firewall', x: 448, y: 120, label: '防火墙' }, { id: 'net', icon: 'cloud', x: 562, y: 120, label: '互联网' },
        { id: 'srv', icon: 'server', x: 562, y: 236, label: 'Web 服务器', sub: '203.0.113.8' },
      ],
      links: [['pc1', 'sw'], ['pc2', 'sw'], ['ap', 'sw'], ['ph', 'ap', 'wireless'], ['sw', 'r1'], ['r1', 'fw'], ['fw', 'net'], ['net', 'srv']],
      steps: [
        { at: 'pc1', note: 'PC1 访问 203.0.113.8：交给默认网关' }, { at: 'sw', via: ['pc1', 'sw'], note: '交换机查 MAC 地址表转发' },
        { at: 'r1', via: ['sw', 'r1'], note: 'R1 查路由表，TTL − 1' }, { at: 'fw', via: ['r1', 'fw'], note: '防火墙放行 TCP 80，做 NAT' },
        { at: 'net', via: ['fw', 'net'], note: '经互联网逐跳转发' }, { at: 'srv', via: ['net', 'srv'], marks: { srv: 'ok' }, note: '到达 Web 服务器' },
      ],
    },
  },
  seq: {
    title: '时序图',
    spec: {
      actors: [{ id: 'c', label: '客户端', icon: 'host' }, { id: 's', label: '服务器', icon: 'server' }],
      msgs: [{ from: 'c', to: 's', label: 'SYN=1, seq=x' }, { from: 's', to: 'c', label: 'SYN=1, ACK=1, seq=y, ack=x+1' }, { from: 'c', to: 's', label: 'ACK=1, seq=x+1, ack=y+1' }],
      states: { c: [['CLOSED', 0], ['SYN-SENT', 1], ['ESTABLISHED', 2]], s: [['LISTEN', 0], ['SYN-RCVD', 1], ['ESTABLISHED', 3]] },
      steps: [{ upto: 0, note: '服务器先进入 LISTEN' }, { upto: 1, note: '第一次握手' }, { upto: 2, note: '第二次握手' }, { upto: 3, note: '第三次握手：连接建立' }],
    },
  },
};

/** Second modes of shared kinds: a page-replacement grid and a header bitfield. */
export const ARTIFACT_VIZ_EXTRA_SAMPLES: { kind: ArtifactVizKind; sample: ArtifactVizSample }[] = [
  { kind: 'grid', sample: { title: '页面置换（LRU）', spec: lruTrace() } },
  {
    kind: 'bits',
    sample: {
      title: 'TCP 首部',
      spec: {
        width: 32,
        fields: [
          { name: '源端口', bits: 16 }, { name: '目的端口', bits: 16 }, { name: '序号 seq', bits: 32 }, { name: '确认号 ack', bits: 32 },
          { name: '首部长度', bits: 4 }, { name: '保留', bits: 6 }, { name: 'U', bits: 1 }, { name: 'A', bits: 1, tone: 'accent' }, { name: 'P', bits: 1 },
          { name: 'R', bits: 1 }, { name: 'S', bits: 1, tone: 'accent' }, { name: 'F', bits: 1 }, { name: '窗口', bits: 16 },
          { name: '校验和', bits: 16 }, { name: '紧急指针', bits: 16 }, { name: '选项 + 填充（可变）', bits: 32, dashed: true },
        ],
      },
    },
  },
];

/** Kit v1 line chart with the ADR 0093 annotations (cwnd / ssthresh). */
export const ARTIFACT_LINE_ANNOTATION_SAMPLE = {
  labels: Array.from({ length: 25 }, (_, i) => String(i + 1)),
  series: [{ name: 'cwnd', values: [1, 2, 4, 8, 16, 17, 18, 19, 20, 21, 22, 23, 24, 1, 2, 4, 8, 12, 13, 14, 15, 16, 8, 9, 10] }],
  refs: [{ y: 16, from: 0, to: 12, label: 'ssthresh 16' }, { y: 12, from: 13, to: 21, label: 'ssthresh 12' }, { y: 8, from: 22, to: 24 }],
  marks: [{ at: 12, label: '超时', tone: 'risk' }, { at: 21, label: '3 个重复 ACK', tone: 'warn' }],
};

export function artifactVizFigure(kind: string, spec: unknown, caption: string): string {
  return `<figure data-piwin-viz="${kind}"><script type="application/json">${JSON.stringify(spec)}</script><figcaption>${caption}</figcaption></figure>`;
}
