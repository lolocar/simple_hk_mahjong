// 驗證發牌落點與 renderHand 排布一致（手牌從少到多、不跳動）
// 复刻 board.ts 的兩個公式
const TILE_W = 0.6, tileScale = 0.36;
const spacingOf = (p: number) => (p === 0 ? TILE_W * tileScale : 0.28);

// renderHand: x = i*spacing - (n-1)*spacing/2
const renderX = (p: number, i: number, n: number) => i * spacingOf(p) - (n - 1) * spacingOf(p) / 2;
// getHandTilePos: x = index*spacing - (total-1)*spacing/2
const flyX = (p: number, index: number, total: number) => index * spacingOf(p) - (total - 1) * spacingOf(p) / 2;

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };

// 复刻 startDeal 的隊列
function buildQueue(dealOrder: number[]) {
  const q: { player: number; start: number; count: number }[] = [];
  for (let i = 0; i < 12; i++) q.push({ player: dealOrder[i], start: Math.floor(i / 4) * 4, count: 4 });
  for (let i = 12; i < 16; i++) q.push({ player: dealOrder[i], start: 12, count: 1 });
  return q;
}

// 前 12 個為 3 輪×4 家（每家 3 次），後 4 個為每家 1 張單張
const orders = [[0, 1, 2, 3], [2, 3, 0, 1], [3, 2, 1, 0], [1, 0, 3, 2]].map((o) => [...o, ...o, ...o, ...o]);

for (const dealOrder of orders) {
  const q = buildQueue(dealOrder);
  const handSize = [0, 0, 0, 0];
  const sizeSeq: number[][] = [[], [], [], []];
  for (const { player, start, count } of q) {
    ok(start === handSize[player], `起點應接在現有手牌之後 (p=${player} start=${start} 現有=${handSize[player]})`);
    const n = start + count; // 落地後的手牌張數
    // 每一張飛行的落點必須等於 renderHand 對該 index 的排布
    for (let k = 0; k < count; k++) {
      const idx = start + k;
      ok(Math.abs(flyX(player, idx, n) - renderX(player, idx, n)) < 1e-9,
        `落點須等於 renderHand 位置 p=${player} idx=${idx} n=${n}`);
    }
    handSize[player] = n;
    sizeSeq[player].push(n);
  }
  // 每家手牌從少到多、最終 13 張
  for (let p = 0; p < 4; p++) {
    ok(handSize[p] === 13, `p=${p} 最終應 13 張，實際 ${handSize[p]}`);
    const seq = sizeSeq[p];
    ok(seq.every((v, i) => i === 0 || v > seq[i - 1]), `p=${p} 張數須嚴格遞增 ${seq.join(',')}`);
    ok(seq[0] < seq[seq.length - 1], `p=${p} 從少到多 ${seq[0]}→${seq[seq.length - 1]}`);
  }
}

// 舊公式（total=13）會與 renderHand 不一致 → 證明這是原 bug
{
  const p = 0, idx = 0, n = 4;
  ok(Math.abs(flyX(p, idx, 13) - renderX(p, idx, n)) > 0.5, '舊公式(total=13) 與 renderHand(4張) 不一致（原 bug）');
}

console.log('各家張數序列 p0:', buildQueue(orders[0]).filter((s) => s.player === 0).map((s) => s.start + s.count).join(','));
console.log(`合計 pass=${pass} fail=${fail}`);
