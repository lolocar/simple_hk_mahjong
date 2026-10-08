// 全自動對局模擬：4 家皆由 AI 驅動，驗證狀態機不會卡死 / 拋出例外
import { Game, pickBestClaim } from '../src/game/game';
import { AIPlayer } from '../src/game/ai';
import { TileDef } from '../src/game/tiles';

const GAMES = 1000;
const MAX_STEPS = 4000;

let wins = 0, exhaustive = 0, errors = 0, stalls = 0;
const fanTally = new Map<string, number>();
const winPaths = { self: 0, ron: 0, rob: 0, kongFlower: 0, lastWall: 0 };

for (let n = 0; n < GAMES; n++) {
  const g = new Game();
  let prompts = 0;
  g.onPrompt = (opts) => {
    prompts++;
    const best = pickBestClaim(opts);
    if (!best) {
      g.resolveClaim(opts.choices.find((c) => c.kind === 'pass')!);
      return;
    }
    g.resolveClaim(best);
  };
  g.onEvent = (e) => {
    if (e.type === 'win' && e.fans) {
      wins++;
      for (const f of e.fans.fans) fanTally.set(f.name, (fanTally.get(f.name) ?? 0) + 1);
      const names = e.fans.fans.map((f) => f.name);
      if (names.includes('搶槓胡')) winPaths.rob++;
      if (names.includes('自摸')) winPaths.self++;
      if (names.includes('槓上開花')) winPaths.kongFlower++;
      if (names.includes('海底撈月')) winPaths.lastWall++;
      if (!names.includes('自摸') && !names.includes('搶槓胡')) winPaths.ron++;
    }
    if (e.type === 'exhaustive_draw') exhaustive++;
  };

  try {
    g.nextDealer();
    g.rollDice();
    const hands = g.prepareDeal();
    // 模擬：4 家全部交给 AI（含玩家0 座位）
    for (const p of g.players) p.isAI = true;
    void hands;
    g.resolveFlowers();
    g.finishDeal();

    let steps = 0;
    while (g.phase !== 'game_over' && steps < MAX_STEPS) {
      steps++;
      if (g.phase !== 'turn') {
        // claiming 應由 onPrompt 同步解決；若停在 claiming 即卡死
        stalls++;
        console.log(`  局${n} 停在 phase=${g.phase} cur=${g.current} steps=${steps} wall=${g.wall.length}`);
        break;
      }
      const p = g.current;
      // 玩家0 座位需手動摸牌（對應 App 的「點擊桌面摸牌」）
      if (p === 0 && g.isAwaitingDraw) {
        g.manualDraw(0);
        if ((g.phase as string) === 'game_over') break; // 摸牌即自摸
      }
      const ai = new AIPlayer(g, p);
      // AI 加槓（與 App runAITurn 行為一致，讓搶槓胡可被觸發）
      const added = ai.chooseAddedKong();
      if (added && g.addedKong(p, added)) {
        continue;
      }
      const tile: TileDef = ai.chooseDiscard();
      const ok = g.discard(p, tile);
      if (!ok) {
        if ((g.phase as string) === 'game_over') break; // 中途已由事件結束（合法）
        stalls++;
        console.log(`  局${n} discard 失敗 p=${p} phase=${g.phase} cur=${g.current} ` +
          `hand=${g.players[p].hand.length} melds=${g.players[p].melds.length} ` +
          `tile=${tile ? `${tile.suit}${tile.rank}` : String(tile)} wall=${g.wall.length} steps=${steps}`);
        break;
      }
    }
    if (g.phase !== 'game_over' && steps >= MAX_STEPS) {
      stalls++;
      console.log(`  局${n} 步數上限 phase=${g.phase} cur=${g.current} wall=${g.wall.length}`);
    }
  } catch (err) {
    errors++;
    console.log(`  局 ${n} 例外：${String(err)}`);
  }
}

console.log(`對局 ${GAMES}：胡 ${wins}，流局 ${exhaustive}，例外 ${errors}，卡死 ${stalls}`);
console.log('和牌路徑：', JSON.stringify(winPaths));
console.log('番種出現次數：');
[...fanTally.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
