// 診斷壓測失敗案例的畫布尺寸/氣泡寬度分布
import { separateBubble, BubbleRect } from '../src/ui/ui';

const overlap = (a: BubbleRect, b: BubbleRect) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
const inBounds = (r: BubbleRect, vw: number, vh: number) =>
  r.x - r.w / 2 >= 0 && r.x + r.w / 2 <= vw && r.y - r.h / 2 >= 0 && r.y + r.h / 2 <= vh;
const B = (x: number, y: number, w: number, h = 38): BubbleRect => ({ x, y, w, h });

const tally = new Map<string, number>();
for (let i = 0; i < 4000; i++) {
  const vw = 320 + (i % 5) * 160, vh = 480 + (i % 3) * 210;
  const rnd = (n: number) => Math.floor(Math.random() * n);
  const others: BubbleRect[] = [];
  const n = 1 + rnd(3);
  for (let k = 0; k < n; k++) others.push(B(40 + rnd(vw - 80), 40 + rnd(vh - 80), 84 + rnd(80), 38));
  const cand = B(40 + rnd(vw - 80), 40 + rnd(vh - 80), 84 + rnd(80), 38);
  const r = separateBubble(cand, others, vw, vh);
  const out = B(r.x, r.y, cand.w, cand.h);
  let bad = false;
  if (!inBounds(out, vw, vh)) bad = true;
  for (const o of others) if (overlap(out, o)) { bad = true; break; }
  if (bad) {
    const totalW = cand.w + others.reduce((s, o) => s + o.w, 0);
    const key = `${vw}x${vh} n=${others.length} 總寬=${totalW}${totalW > vw ? ' >寬' : ''}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
}
console.log('失敗案例分布:');
[...tally.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
