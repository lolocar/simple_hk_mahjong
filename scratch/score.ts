// 驗證積分模式：一二蚊（辣辣上）金額表、門風花牌番、半銃制結算、破產結束
import { fanToUnit, countFlowerFans, settleWin, START_SCORE, rankScores } from '../src/game/score';
import { Game } from '../src/game/game';
import { makeTile, TileDef } from '../src/game/tiles';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const T = (s: 'm' | 'p' | 's' | 'z' | 'f', r: number) => makeTile(s, r);

// ===== 一二蚊 辣辣上 金額表 =====
const table = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
for (let f = 0; f <= 10; f++) ok(fanToUnit(f) === table[f], `${f}番=${table[f]} (得 ${fanToUnit(f)})`);

// ===== 門風花牌番 =====
// 東家(1)：春(1) 梅(5) 計番；夏(2) 蘭(6) 不計
ok(countFlowerFans([T('f', 1), T('f', 5)], 1) === 2, '東家 春+梅 = 2番');
ok(countFlowerFans([T('f', 2), T('f', 6)], 1) === 0, '東家 夏+蘭 = 0番');
// 北家(4)：冬(4) 菊(7) 計番
ok(countFlowerFans([T('f', 4), T('f', 7)], 4) === 2, '北家 冬+菊 = 2番');
// 西家(3)：秋(3) 竹(8) 計番
ok(countFlowerFans([T('f', 3), T('f', 8)], 3) === 2, '西家 秋+竹 = 2番');
ok(countFlowerFans([T('f', 1), T('f', 2), T('f', 3), T('f', 4), T('f', 5), T('f', 6), T('f', 7), T('f', 8)], 2) === 2,
  '南家 夏+蘭 = 2番（8張花裡只有2張配門風）');

// ===== 半銃制結算 =====
{
  const r = settleWin({ winner: 0, fan: 0, selfDraw: true, from: null });
  ok(r.unit === 1, '雞胡自摸 單份=1');
  ok(r.deltas[0] === 6 && r.deltas[1] === -2 && r.deltas[2] === -2 && r.deltas[3] === -2,
    `自摸 6/-2/-2/-2 (${r.deltas.join(',')})`);
  ok(r.deltas.reduce((a, b) => a + b, 0) === 0, '自摸結算零和');
}
{
  const r = settleWin({ winner: 2, fan: 3, selfDraw: false, from: 0 });
  ok(r.unit === 8, '3番 單份=8');
  ok(r.deltas[2] === 32 && r.deltas[0] === -16 && r.deltas[1] === -8 && r.deltas[3] === -8,
    `出銃 出銃者雙份其餘單份 (${r.deltas.join(',')})`);
  ok(r.deltas.reduce((a, b) => a + b, 0) === 0, '出銃結算零和');
}

// ===== 排名 =====
{
  const rk = rankScores([1000, 900, 1200, 900]);
  ok(rk[0].player === 2 && rk[1].player === 0, '排名按分數遞減');
  ok(rk[1].player === 0 && rk[2].player === 1, '同分按座位序');
}

// ===== Game 整合：自摸結算入帳 =====
{
  const g = new Game();
  g.onEvent = () => {};
  g.onPrompt = (o) => g.resolveClaim(o.choices.find((c) => c.kind === 'pass')!);
  g.nextDealer(); g.rollDice(); g.prepareDeal(); g.resolveFlowers(); g.finishDeal();
  ok(g.scores.every((s) => s === START_SCORE), `開局每人 ${START_SCORE}`);
  // 玩家0 湊一手雞胡自摸（混合花色、有刻有順，無番種，僅自摸1番）
  const h: TileDef[] = [
    T('m', 1), T('m', 2), T('m', 3), T('p', 5), T('p', 6), T('p', 7),
    T('s', 1), T('s', 2), T('s', 3), T('s', 9), T('s', 9), T('s', 9), T('z', 1), T('z', 1),
  ];
  g.players[0].hand = h;
  g.players[0].melds = [];
  g.players[0].flowers = []; // 配牌補的花是隨機的，清掉才能確定番數
  g.current = 0;
  g.phase = 'turn';
  (g as any).awaitingDraw = false;
  let winEvent: any = null;
  g.onEvent = (e) => { if (e.type === 'win') winEvent = e; };
  g.winBySelf(0);
  ok(winEvent !== null, 'win 事件發射');
  const st = winEvent!.settle;
  ok(st.selfDraw === true, '自摸');
  ok(st.fan === 0 && st.unit === 1, `雞胡自摸 0番 單份1（自摸不重複計番）(fan=${st.fan} unit=${st.unit})`);
  ok(g.scores[0] === START_SCORE + 6 && g.scores.slice(1).every((s) => s === START_SCORE - 2),
    `自摸 0番：贏家+6 三家-2 (${g.scores.join(',')})`);
  ok(g.scores.reduce((a, b) => a + b, 0) === 4 * START_SCORE, '四家總分守恆');
  ok(g.matchOver === false, '未破產');
  ok(g.wins[0] === 1 && g.wins[1] === 0 && g.wins[2] === 0 && g.wins[3] === 0, `自摸計入胡牌數 (${g.wins.join(',')})`);
  ok(g.deals.every((d) => d === 0), `自摸不計放炮 (${g.deals.join(',')})`);
}

// ===== Game 整合：出銃 → 胡牌數 / 放炮數 =====
{
  const g = new Game();
  let captured: any = null;
  g.onEvent = () => {};
  g.onPrompt = (o) => { captured = o; };
  g.nextDealer(); g.rollDice(); g.prepareDeal(); g.resolveFlowers(); g.finishDeal();
  // 玩家 0 聽 5 條（13 張：三組面子 + 一組面子 + 單張 5 條），玩家 1 打出 5 條
  const h: TileDef[] = [
    T('p', 1), T('p', 2), T('p', 3), T('p', 5), T('p', 5), T('p', 5),
    T('m', 7), T('m', 8), T('m', 9), T('m', 1), T('m', 2), T('m', 3), T('s', 5),
  ];
  g.players[0].hand = h; g.players[0].melds = []; g.players[0].flowers = [];
  g.players[1].hand = g.players[1].hand.filter((t) => !(t.suit === 's' && t.rank === 5));
  g.players[1].hand.push(T('s', 5));
  g.current = 1; g.phase = 'turn'; (g as any).awaitingDraw = false;
  g.discard(1, T('s', 5));
  const opt = captured.choices.find((c: any) => c.player === 0 && c.kind === 'win')!;
  g.resolveClaim(opt);
  ok(g.wins[0] === 1, `出銃胡計入贏家胡牌數 (${g.wins.join(',')})`);
  ok(g.deals[1] === 1 && g.deals[0] === 0, `出銃者計入放炮數 (${g.deals.join(',')})`);
  g.resetMatch();
  ok(g.wins.every((w) => w === 0) && g.deals.every((d) => d === 0), 'resetMatch 重置胡牌/放炮數');
}

// ===== Game 整合：積分見底 → 整場結束 =====
{
  const g = new Game();
  g.onEvent = () => {};
  g.onPrompt = (o) => g.resolveClaim(o.choices.find((c) => c.kind === 'pass')!);
  g.nextDealer(); g.rollDice(); g.prepareDeal(); g.resolveFlowers(); g.finishDeal();
  g.scores = [1000, 10, 1000, 1000]; // 右家只剩 10 分
  const h: TileDef[] = [
    T('s', 1), T('s', 1), T('s', 1), T('s', 2), T('s', 2), T('s', 2),
    T('s', 3), T('s', 3), T('s', 3), T('s', 4), T('s', 4), T('s', 4), T('s', 5), T('s', 5),
  ];
  g.players[0].hand = h; g.players[0].melds = []; g.players[0].flowers = [];
  g.current = 0; g.phase = 'turn'; (g as any).awaitingDraw = false;
  g.winBySelf(0);
  ok(g.matchOver === true, `右家 ${g.scores[1]} 分 → 整場結束`);
  g.resetMatch();
  ok(g.scores.every((s) => s === START_SCORE) && g.matchOver === false, 'resetMatch 重置積分');
}

console.log(`合計 pass=${pass} fail=${fail}`);
