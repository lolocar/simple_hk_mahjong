// 驗證亮牌提示的種類判定：暗槓/加槓/明槓 + 補花/吃/碰 事件計數（沿用 sim 的驅動方式）
import { Game, pickBestClaim } from '../src/game/game';
import { AIPlayer } from '../src/game/ai';
import { TileDef } from '../src/game/tiles';

const GAMES = 300;
const MAX_STEPS = 4000;
const counts: Record<string, number> = { 暗槓: 0, 加槓: 0, 明槓: 0, 碰: 0, 吃: 0, 補花: 0 };
let fail = 0, pass = 0;
const ok = (cond: boolean, msg: string) => { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } };

for (let n = 0; n < GAMES; n++) {
  const g = new Game();
  g.onPrompt = (opts) => {
    const best = pickBestClaim(opts);
    if (!best) { g.resolveClaim(opts.choices.find((c) => c.kind === 'pass')!); return; }
    g.resolveClaim(best);
  };
  g.onEvent = (e) => {
    if (e.type === 'flower') { counts['補花']++; return; }
    if (e.type === 'pong') { counts['碰']++; return; }
    if (e.type === 'chi') { counts['吃']++; return; }
    if (e.type !== 'kong') return;
    // 與 main.ts handleEvent 完全相同的判定
    ok(!!e.kongKind, 'kong 事件應攜帶 kongKind');
    const label = e.kongKind === 'angang' ? '暗槓' : e.kongKind === 'jigang' ? '加槓' : '明槓';
    counts[label]++;
    const melds = g.players[e.player].melds;
    // 找到這副槓：4 張、type kong、含該牌
    const kong = melds.find((m) => m.type === 'kong' && m.tiles.length === 4 &&
      m.tiles.some((t) => t.suit === e.tile!.suit && t.rank === e.tile!.rank));
    ok(!!kong, `${label} 應存在 4 張的槓副露`);
    if (label === '暗槓') ok(!!kong?.concealed && e.from === e.player, '暗槓應 concealed 且 from 自家');
    if (label === '加槓') ok(!kong?.concealed && e.from === e.player, '加槓應非 concealed 且 from 自家');
    if (label === '明槓') ok(!kong?.concealed && e.from !== e.player, '明槓應非 concealed 且 from 弃牌家');
  };

  g.nextDealer();
  g.rollDice();
  const hands = g.prepareDeal();
  for (const p of g.players) p.isAI = true;
  void hands;
  g.resolveFlowers();
  g.finishDeal();

  let steps = 0;
  while (g.phase !== 'game_over' && steps < MAX_STEPS) {
    steps++;
    if (g.phase !== 'turn') break;
    const p = g.current;
    if (p === 0 && g.isAwaitingDraw) {
      g.manualDraw(0);
      if ((g.phase as string) === 'game_over') break;
    }
    const ai = new AIPlayer(g, p);
    // 暗槓：有選項就槓（讓 angang 路徑被觸發）
    const kongOpts = g.getConcealedKongOptions(p);
    if (kongOpts.length > 0) {
      g.concealedKong(p, kongOpts[0]);
      continue;
    }
    const added = ai.chooseAddedKong();
    if (added && g.addedKong(p, added)) continue;
    const tile: TileDef = ai.chooseDiscard();
    if (!g.discard(p, tile)) break;
  }
}
console.log('事件計數（300 局）:', JSON.stringify(counts));
ok(counts['暗槓'] > 0, '應出現暗槓');
ok(counts['加槓'] > 0, '應出現加槓');
ok(counts['明槓'] > 0, '應出現明槓');
ok(counts['碰'] > 0 && counts['吃'] > 0 && counts['補花'] > 0, '吃/碰/補花應出現');
console.log(`合計 pass=${pass} fail=${fail}`);
