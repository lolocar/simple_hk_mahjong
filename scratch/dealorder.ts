// 驗證發牌動畫用「摸牌順序」且從少到多
import { Game } from '../src/game/game';
import { TileDef, tileName, sortTiles } from '../src/game/tiles';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const key = (t: TileDef) => `${t.suit}${t.rank}`;
const keys = (h: TileDef[]) => h.map(key).join(',');
const isSorted = (h: TileDef[]) => keys(sortTiles(h)) === keys(h);

let unsortedCount = 0;
for (let n = 0; n < 200; n++) {
  const g = new Game();
  g.nextDealer();
  g.rollDice();
  const hands = g.prepareDeal(); // 應為摸牌順序（未排序）
  for (let p = 0; p < 4; p++) {
    ok(hands[p].length === 13, `p=${p} 返回值 13 張`);
    ok(hands[p].length === g.players[p].hand.length, `p=${p} 返回值與手牌張數一致`);
    // 返回值排序後應等於入局手牌（同一副牌，只是順序不同）
    ok(keys(sortTiles(hands[p])) === keys(g.players[p].hand), `p=${p} 返回值與入局手牌同牌`);
    // 返回值是摸牌順序：多數情況下不等於排序順序
    if (!isSorted(hands[p])) unsortedCount++;
  }
}
ok(unsortedCount > 200 * 4 * 0.9, `返回值應為未排序的摸牌順序（未排序家數=${unsortedCount}/800）`);

// 動畫隊列：每家按摸牌順序從少到多（4,8,12,13）
{
  const g = new Game();
  g.nextDealer();
  g.rollDice();
  const hands = g.prepareDeal();
  const order = g.getDealOrder();
  const q: { player: number; start: number; count: number }[] = [];
  for (let i = 0; i < 12; i++) q.push({ player: order[i], start: Math.floor(i / 4) * 4, count: 4 });
  for (let i = 12; i < 16; i++) q.push({ player: order[i], start: 12, count: 1 });
  const sizeSeq: number[][] = [[], [], [], []];
  const shownSeq: string[][] = [[], [], [], []];
  for (const { player, start, count } of q) {
    const n = start + count;
    sizeSeq[player].push(n);
    // 動畫顯示的手牌 = 摸牌順序的前 n 張
    shownSeq[player].push(keys(hands[player].slice(0, n)));
  }
  for (let p = 0; p < 4; p++) {
    ok(sizeSeq[p].join(',') === '4,8,12,13', `p=${p} 張數從少到多 4,8,12,13（實際 ${sizeSeq[p].join(',')}）`);
    // 每次顯示都是前一次的前綴（從少到多、按摸牌順序追加）
    for (let i = 1; i < shownSeq[p].length; i++) {
      ok(shownSeq[p][i].startsWith(shownSeq[p][i - 1]), `p=${p} 第${i}次顯示是前一次的前綴（按摸牌順序追加）`);
    }
    // 最終顯示 = 摸牌順序全部 13 張
    ok(shownSeq[p][3] === keys(hands[p]), `p=${p} 最終顯示=摸牌順序全 13 張`);
  }
}

console.log(`合計 pass=${pass} fail=${fail}`);
