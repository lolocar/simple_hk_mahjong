// 驗證兩階段配牌：prepareDeal 後手牌含花牌且花牌區為空；resolveFlowers 後手牌無花牌、張數 13
import { Game } from '../src/game/game';
import { isFlower, sortTiles } from '../src/game/tiles';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } };

let sumFlowerInHand = 0, sumTaken = 0, cases = 0;
for (let n = 0; n < 400; n++) {
  const g = new Game();
  g.nextDealer();
  g.rollDice();
  const hands = g.prepareDeal();
  // 階段一：補花前
  for (let p = 0; p < 4; p++) {
    ok(g.players[p].hand.length === 13, `配牌後手牌應 13 張，實測 ${g.players[p].hand.length}`);
    ok(g.players[p].flowers.length === 0, `配牌後花牌區應為空，實測 ${g.players[p].flowers.length}`);
    ok(g.players[p].hand.length === hands[p].length, 'prepareDeal 返回值應與手牌一致');
  }
  const flowerInHand = [0, 1, 2, 3].map((p) => g.players[p].hand.filter((t) => isFlower(t)).length);
  const wallBefore = g.wall.length;
  const totalIn = flowerInHand.reduce((a, b) => a + b, 0);
  sumFlowerInHand += totalIn; cases++;

  const taken = g.resolveFlowers();
  sumTaken += taken;
  // 階段二：補花後
  for (let p = 0; p < 4; p++) {
    ok(g.players[p].hand.filter((t) => isFlower(t)).length === 0, `補花後手牌不應含花牌`);
    ok(g.players[p].hand.length === 13, `補花後手牌應 13 張，實測 ${g.players[p].hand.length}`);
  }
  // 牌牆消耗 = 補花取走張數；花牌區總數 = 配牌花牌 + 補到的花牌
  ok(g.wall.length === wallBefore - taken, `牌牆應減少 ${taken}，實測 ${wallBefore}→${g.wall.length}`);
  // 花牌區總數 = 配牌花牌 + 補到的花牌；補花取牌 = 非花牌填補(=配牌花牌) + 補到的花牌
  // 故花牌區總數應恰等於補花取走的張數
  const flowersTotal = [0, 1, 2, 3].reduce((a, p) => a + g.players[p].flowers.length, 0);
  ok(flowersTotal === taken, `花牌區總數(${flowersTotal})應等於補花取牌數(${taken})`);
  // 全副牌無遺失：手牌+花牌+牌牆 = 144
  const total = [0, 1, 2, 3].reduce((a, p) => a + g.players[p].hand.length + g.players[p].flowers.length, 0) + g.wall.length;
  ok(total === 144, `牌數守恆應 144，實測 ${total}`);
  // 手牌已排序
  for (let p = 0; p < 4; p++) {
    const h = g.players[p].hand;
    ok(JSON.stringify(h) === JSON.stringify(sortTiles(h)), '補花後手牌應已排序');
  }
}
console.log(`合計 pass=${pass} fail=${fail}`);
console.log(`平均每家配牌花牌 ${(sumFlowerInHand / cases / 4).toFixed(2)} 張/家，平均補花取牌 ${(sumTaken / cases).toFixed(2)} 張/局`);
