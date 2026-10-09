// 圈數計算測試：圈風固定於一圈之內（東→南→西→北 為一圈，只在北家過莊回東家才進圈）；
// 滿四圈（完整輪莊四次）整場結束；一圈結束積分不重置；破產優先。
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

// 打一局：閑家胡（winner != dealer）→ 過莊，然後進入下一局
function guo(g: Game, winner: number) {
  (g as any).recordResult(winner);
  if (!g.matchOver) g.nextDealer();
}

// ===== 圈風固定於一圈之內 =====
{
  const g = fresh();
  g.nextDealer();
  ok(g.dealer === 0 && g.roundWind.rank === 1, `東圈局1 莊=東 圈風=東 (${g.dealer},${g.roundWind.rank})`);
  guo(g, 1);
  ok(g.dealer === 1 && g.roundWind.rank === 1, `東圈局2 莊=南 圈風仍東 (${g.dealer},${g.roundWind.rank})`);
  guo(g, 0);
  ok(g.dealer === 2 && g.roundWind.rank === 1, `東圈局3 莊=西 圈風仍東 (${g.dealer},${g.roundWind.rank})`);
  guo(g, 1);
  ok(g.dealer === 3 && g.roundWind.rank === 1, `東圈局4 莊=北 圈風仍東 (${g.dealer},${g.roundWind.rank})`);
  ok(g.matchOver === false, '東圈結束前未整場結束');
  guo(g, 0); // 北家過莊 → 回東家 → 進南圈
  ok(g.dealer === 0 && g.roundWind.rank === 2, `南圈開始（北→東）莊=東 圈風=南 (${g.dealer},${g.roundWind.rank})`);
}

// ===== 滿四圈（完整輪莊四次）才整場結束 =====
{
  const g = fresh();
  g.nextDealer();
  let games = 0;
  while (!g.matchOver && games < 100) {
    guo(g, (g.dealer + 1) % 4); // 每局閑家胡 → 過莊
    games++;
  }
  ok(g.roundsCompleted === 4, `滿四圈 roundsCompleted=${g.roundsCompleted}`);
  ok(g.matchOver === true && g.overReason === 'rounds', `滿四圈整場結束 (${g.overReason})`);
  ok(games === 16, `無連莊時共 16 局（4 圈×4 局）= ${games}`);
}

// ===== 連莊不進圈 =====
{
  const g = fresh();
  g.nextDealer();
  (g as any).recordResult(0); // 莊家胡 → 連莊
  g.nextDealer();
  ok(g.dealer === 0 && g.roundWind.rank === 1 && g.roundsCompleted === 0,
    `連莊圈風不變 (${g.dealer},${g.roundWind.rank},${g.roundsCompleted})`);
}

// ===== 北圈連莊延長（不進下一圈） =====
{
  const g = fresh();
  g.nextDealer();
  guo(g, 1); guo(g, 0); guo(g, 1); // 東圈 → 莊=北
  ok(g.dealer === 3 && g.roundWind.rank === 1, '東圈莊=北');
  (g as any).recordResult(3); g.nextDealer(); // 莊家胡 → 連莊
  ok(g.dealer === 3 && g.roundWind.rank === 1 && g.matchOver === false, '東圈莊連莊，圈風仍東');
  (g as any).recordResult(null); g.nextDealer(); // 流局 → 北過莊 → 進南圈
  ok(g.dealer === 0 && g.roundWind.rank === 2, `流局進南圈 (${g.dealer},${g.roundWind.rank})`);
}

// ===== 破產優先於四圈 =====
{
  const g = fresh();
  g.nextDealer();
  guo(g, 1); guo(g, 0); guo(g, 1); // 莊=北
  ok(g.dealer === 3, '到北家');
  g.rollDice(); g.prepareDeal(); g.resolveFlowers(); g.finishDeal();
  g.scores = [1000, 5, 1000, 1000];
  for (let i = 0; i < 4; i++) g.players[i].flowers = [];
  const fans: any = { fans: [{ name: '清一色', value: 6 }], total: 6, minFan: 0 };
  (g as any).settle(0, fans, false, 3); // 右家(3)放炮破產 → bankrupt
  ok(g.overReason === 'bankrupt', `破產優先 (${g.overReason})`);
  (g as any).recordResult(0); // 北家閑家胡 → rounds，但 bankrupt 優先
  ok(g.overReason === 'bankrupt', `recordResult 不覆蓋 bankrupt (${g.overReason})`);
}

// ===== 一圈結束積分不重置 =====
{
  const g = fresh();
  g.nextDealer();
  g.rollDice(); g.prepareDeal(); g.resolveFlowers(); g.finishDeal();
  for (let i = 0; i < 4; i++) g.players[i].flowers = [];
  const fans: any = { fans: [{ name: '清一色', value: 3 }], total: 3, minFan: 0 };
  (g as any).settle(0, fans, true, null); // 東圈局1 莊家自摸
  const afterRound1 = g.scores.slice();
  ok(afterRound1[0] > 1000, `局1 莊家自摸得分 ${afterRound1[0]}`);
  guo(g, 1); guo(g, 0); guo(g, 1); guo(g, 0); // 打完東圈 → 南圈
  ok(g.roundWind.rank === 2, '進入南圈');
  ok(g.scores[0] === afterRound1[0], `一圈結束積分不重置 (${g.scores[0]} vs ${afterRound1[0]})`);
}

// ===== resetMatch 回到東圈 =====
{
  const g = fresh();
  g.nextDealer();
  let games = 0;
  while (!g.matchOver && games < 100) { guo(g, (g.dealer + 1) % 4); games++; }
  ok(g.matchOver === true, '滿四圈整場結束');
  g.resetMatch();
  ok(g.dealer === 0 && g.roundWind.rank === 1 && g.roundsCompleted === 0 &&
     g.matchOver === false && g.overReason === null,
    `resetMatch 回東圈 (${g.dealer},${g.roundWind.rank},${g.roundsCompleted},${g.matchOver},${g.overReason})`);
}

console.log(`合計 pass=${pass} fail=${fail}`);
