// 驗證：發牌動畫期間（phase='dealing'）看門狗 / 遺留定時任務無法驅動 AI 出牌
import { Game } from '../src/game/game';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };

// 模擬第二局：先跑完一局讓 lastResult 非 null（過莊 → 莊家變成 AI）
const g = new Game();
const events: string[] = [];
g.onEvent = (e) => events.push(`${e.type}:${e.player}`);
g.onPrompt = (o) => { const p = o.choices.find((c) => c.kind === 'pass')!; g.resolveClaim(p); };

g.nextDealer();
g.rollDice();
g.prepareDeal();
g.resolveFlowers();
g.finishDeal();
// 快速打完一局：輪到誰就摸牌出牌，直到結束
let guard = 0;
while (g.phase !== 'game_over' && guard++ < 5000) {
  if (g.phase === 'turn') {
    const c = g.current;
    if (c === 0) { g.manualDraw(0); }
    const t = g.players[c].hand[g.players[c].hand.length - 1];
    if (t) g.discard(c, t);
  }
}
ok(g.phase === 'game_over', `第一局結束 phase=${g.phase}`);

// === 第二局 startGame 等價流程 ===
// 強制過莊（流局過莊），確保第二局莊家是 AI，才能重現看門狗驅動 AI 的場景
g.lastResult = 'exhaustive';
g.nextDealer();
const dealer2 = g.dealer;
ok(dealer2 !== 0, `第二局莊家過莊給 AI (dealer=${dealer2})`);
g.rollDice();
const hands = g.prepareDeal();
const evMark = events.length; // 只看發牌動畫期間新增的事件

// 核心：發牌動畫期間 phase 必須是 'dealing'
ok(g.phase === 'dealing', `配牌後 phase='dealing'（實際 ${g.phase}）`);
ok(g.current === dealer2, `current=莊家 ${g.current}`);

// 看門狗條件 1 的等價驅動：AI 出牌必須被拒絕
const ai = dealer2;
const tile = g.players[ai].hand[0];
const before = g.players[ai].hand.length;
const dres = g.discard(ai, tile);
ok(dres === false, `dealing 期間 discard(AI) 被拒絕 → 不會 emit discard`);
ok(g.players[ai].hand.length === before, `dealing 期間手牌未被出掉 (${g.players[ai].hand.length})`);
ok(!events.slice(evMark).some((e) => e.startsWith('discard:')), `dealing 期間無 discard 事件（renderHand 不會画出全部手牌）`);

// 暗槓 / 加槓 / 自摸胡 在 dealing 期間全部不可用
ok(g.concealedKong(ai, tile) === false, `dealing 期間 concealedKong 被拒絕`);
ok(g.getAddedKongOptions(ai).length === 0, `dealing 期間 getAddedKongOptions 為空`);
ok(g.getConcealedKongOptions(ai).length === 0, `dealing 期間 getConcealedKongOptions 為空`);

// 遺留 nextTurn 任務在 dealing 期間必須是 no-op
const curBefore = g.current;
g.nextTurn();
ok(g.current === curBefore, `dealing 期間 nextTurn 為 no-op（current 未推進）`);
ok(g.phase === 'dealing', `dealing 期間 nextTurn 未把 phase 改成 turn`);

// 玩家0 在 dealing 期間不能摸牌
ok(g.manualDraw(0) === false, `dealing 期間 manualDraw(0) 被拒絕`);

// 動畫 + 補花完成後 finishDeal 才開啟 'turn'
g.resolveFlowers();
ok(g.phase === 'dealing', `補花後仍為 dealing`);
g.finishDeal();
ok(g.phase === 'turn', `finishDeal 後 phase='turn'`);
ok(g.players[0].hand.length === 13 || g.players[0].hand.length === 14, `開局手牌張數 ${g.players[0].hand.length}`);
ok(hands.every((h) => h.length === 13), `發牌動畫用 13 張/家`);

console.log(`合計 pass=${pass} fail=${fail}`);
