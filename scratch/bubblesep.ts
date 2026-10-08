// 驗證氣泡避讓：新氣泡與可見氣泡重疊時被推開，且結果不溢出畫面
import { separateBubble, BubbleRect } from '../src/ui/ui';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const overlap = (a: BubbleRect, b: BubbleRect) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
const inBounds = (r: BubbleRect, vw: number, vh: number) =>
  r.x - r.w / 2 >= 0 && r.x + r.w / 2 <= vw && r.y - r.h / 2 >= 0 && r.y + r.h / 2 <= vh;

const B = (x: number, y: number, w = 128, h = 38): BubbleRect => ({ x, y, w, h });

// 1) 不重疊 → 原點不動
{
  const r = separateBubble(B(410, 78), [B(1249, 472), B(351, 472)], 1600, 900);
  ok(r.x === 410 && r.y === 78, `不重疊應不動 (${r.x},${r.y})`);
}

// 2) 窄屏夾邊後 p0/p3 同貼左 x=78、y 接近 → 必須推開
{
  const p3 = B(78, 459);
  const r = separateBubble(B(78, 440), [p3], 675, 900);
  const out = B(r.x, r.y);
  ok(!overlap(out, p3), `推開後不重疊 (${r.x},${r.y})`);
  ok(inBounds(out, 675, 900), `推開後在畫面內`);
}

// 3) 完全同心 → 推開且不重疊
{
  const o = B(300, 300);
  const r = separateBubble(B(300, 300), [o], 900, 900);
  ok(!overlap(B(r.x, r.y), o), `同心應推開 (${r.x},${r.y})`);
}

// 4) 多家同時：新氣泡要避開兩個可見氣泡
{
  const a = B(400, 300), b = B(400, 340);
  const r = separateBubble(B(400, 320), [a, b], 1200, 900);
  const out = B(r.x, r.y);
  ok(!overlap(out, a), `避開 a (${r.x},${r.y})`);
  ok(!overlap(out, b), `避開 b (${r.x},${r.y})`);
  ok(inBounds(out, 1200, 900), `多家避讓後在畫面內`);
}

// 5) 貼邊重疊：推開後不得溢出
{
  const o = B(20, 20);
  const r = separateBubble(B(30, 30), [o], 675, 900);
  const out = B(r.x, r.y);
  ok(inBounds(out, 675, 900), `貼邊推開後不溢出 (${r.x},${r.y})`);
}

// 6) 真實場景壓測：最窄真實窗口 675x900 起，氣泡寬 84~128（真實文案），推開後不重疊且在畫面內
{
  let bad = 0;
  const canvases: [number, number][] = [[675, 900], [900, 900], [1200, 900], [1440, 900], [1600, 900]];
  for (let i = 0; i < 8000; i++) {
    const [vw, vh] = canvases[i % canvases.length];
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const others: BubbleRect[] = [];
    const n = 1 + rnd(3);
    for (let k = 0; k < n; k++) others.push(B(78 + rnd(vw - 156), 78 + rnd(vh - 156), 84 + rnd(45), 38));
    const cand = B(78 + rnd(vw - 156), 78 + rnd(vh - 156), 84 + rnd(45), 38);
    const r = separateBubble(cand, others, vw, vh);
    const out = B(r.x, r.y, cand.w, cand.h);
    if (!inBounds(out, vw, vh)) { bad++; continue; }
    for (const o of others) if (overlap(out, o)) { bad++; break; }
    const disp = Math.hypot(r.x - cand.x, r.y - cand.y);
    if (disp > 170) { bad++; }
  }
  ok(bad === 0, `真實場景壓測 8000 例：溢出/殘餘重疊/位移過大=${bad}`);
}

// 7) 位移有界：單個重疊的推開距離不超過 1 圈（8px）+ 自身寬度級別
{
  const o = B(300, 300, 128, 38);
  const r = separateBubble(B(310, 300, 128, 38), [o], 1200, 900);
  const disp = Math.hypot(r.x - 310, r.y - 300);
  ok(disp <= 170, `單次推開位移有界 (${disp.toFixed(0)}px)`);
  ok(!overlap(B(r.x, r.y, 128, 38), o), `輕微重疊推開後不重疊 (${r.x},${r.y})`);
}

console.log(`合計 pass=${pass} fail=${fail}`);
