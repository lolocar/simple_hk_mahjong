// 圈數計算測試：莊家座標=圈風，北圈莊家過莊/流局 → 四圈完成整場結束
import { Game } from '../src/game/game';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.log('FAIL: ' + msg); }
}

function fresh(): Game {
  const g = new Game();
  g.onEvent = () => {};
  g.onPrompt = (o) => g.resolveClaim(o.choices.find((c) => c.kind === 'pass')!);
  return g;
}

// ===== 東→南→西→北 圈風遞進 =====
{
  const g = fresh();
  g.nextDealer();
  ok(g.dealer === 0 && g.roundWind.rank === 1, `東圈 莊=東 (${g.dealer},${g.roundWind.rank})`);
  (g as any).recordResult(1); // 閑家胡 → 過莊
  g.nextDealer();
  ok(g.dealer === 1 && g.roundWind.rank === 2, `南圈 莊=南 (${g.dealer},${g.roundWind.rank})`);
  (g as any).recordResult(0); // 閑家胡 → 過莊
  g.nextDealer();
  ok(g.dealer === 2 && g.roundWind.rank === 3, `西圈 莊=西 (${g.dealer},${g.roundWind.rank})`);
  (g as any).recordResult(1); // 閑家胡 → 過莊
  g.nextDealer();
  ok(g.dealer === 3 && g.roundWind.rank === 4, `北圈 莊=北 (${g.dealer},${g.roundWind.rank})`);
  ok(g.matchOver === false, '北圈開始時未結束');
  (g as any).recordResult(0); // 北圈莊家閑家胡 → 四圈完成
  ok(g.matchOver === true && g.overReason === 'rounds', `北圈結束整場結束 (${g.overReason})`);
}

// ===== 北圈連莊延長，流局才結束 =====
{
  const g = fresh();
  g.nextDealer();
  (g as any).recordResult(1); g.nextDealer();
  (g as any).recordResult(0); g.nextDealer();
  (g as any).recordResult(1); g.nextDealer();
  ok(g.dealer === 3, '到北圈');
  (g as any).recordResult(3); // 莊家胡 → 連莊
  g.nextDealer();
  ok(g.dealer === 3 && g.matchOver === false, `北圈連莊延長莊家 (${g.dealer})`);
  (g as any).recordResult(3); // 再連莊
  g.nextDealer();
  ok(g.dealer === 3 && g.matchOver === false, '北圈連莊再延長');
  (g as any).recordResult(null); // 流局 → 北圈完成
  ok(g.matchOver === true && g.overReason === 'rounds', `北圈流局結束 (${g.overReason})`);
}

// ===== 破產優先於四圈 =====
{
  const g = fresh();
  g.nextDealer();
  (g as any).recordResult(1); g.nextDealer();
  (g as any).recordResult(0); g.nextDealer();
  (g as any).recordResult(1); g.nextDealer();
  ok(g.dealer === 3, '到北圈');
  g.rollDice(); g.prepareDeal(); g.resolveFlowers(); g.finishDeal();
  g.scores = [1000, 5, 1000, 1000];
  g.players[0].flowers = [];
  g.players[1].flowers = [];
  g.players[2].flowers = [];
  g.players[3].flowers = [];
  // 模擬北圈閑家胡且右家破產：settle 會設 bankrupt
  const fans: any = { fans: [{ name: '清一色', value: 6 }], total: 6, minFan: 0 };
  (g as any).settle(0, fans, false, 3); // 右家(3)放炮，分數見底
  ok(g.overReason === 'bankrupt', `破產優先 (${g.overReason})`);
  (g as any).recordResult(0); // 北圈閑家胡 → rounds，但 bankrupt 優先
  ok(g.overReason === 'bankrupt', `recordResult 不覆蓋 bankrupt (${g.overReason})`);
}

// ===== resetMatch 回到東圈 =====
{
  const g = fresh();
  g.nextDealer();
  (g as any).recordResult(1); g.nextDealer();
  (g as any).recordResult(0); g.nextDealer();
  (g as any).recordResult(1); g.nextDealer();
  (g as any).recordResult(0); // 北圈完成
  ok(g.matchOver === true, '整場結束');
  g.resetMatch();
  ok(g.dealer === 0 && g.roundWind.rank === 1 && g.matchOver === false && g.overReason === null,
    `resetMatch 回東圈 (${g.dealer},${g.roundWind.rank},${g.matchOver},${g.overReason})`);
}

console.log(`合計 pass=${pass} fail=${fail}`);
