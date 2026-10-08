// 臨時規則驗證腳本（不進 src，不進構建）
import { Game, pickBestClaim, ClaimOptions, ClaimChoice } from '../src/game/game';
import { calcFans, isWinningHand, isAllChows } from '../src/game/hand';
import { TileDef, makeTile, fullWall, sortTiles } from '../src/game/tiles';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const T = (s: string, r: number) => makeTile(s as any, r);
const H = (spec: string[]): TileDef[] =>
  spec.map((s) => T(s[0], parseInt(s.slice(1), 10)));

// ===== 1. claim 全局優先級 =====
console.log('[1] pickBestClaim');
{
  // 玩家1 可碰、玩家3 可胡 → 胡勝（舊代碼按座位會選碰）
  const opts: ClaimOptions = {
    from: 0, tile: T('m', 5),
    choices: [
      { player: 1, kind: 'pong', tile: T('m', 5) },
      { player: 3, kind: 'win', tile: T('m', 5) },
      { player: -1, kind: 'pass' },
    ],
  };
  const b = pickBestClaim(opts)!;
  check('胡 壓過 碰（跨座位）', b.kind === 'win' && b.player === 3, `got ${b.player}:${b.kind}`);
}
{
  // 同級碰：座位由出牌者下家起數，玩家1 優先於玩家3
  const opts: ClaimOptions = {
    from: 2, tile: T('z', 5),
    choices: [
      { player: 3, kind: 'pong', tile: T('z', 5) },
      { player: 1, kind: 'pong', tile: T('z', 5) },
      { player: -1, kind: 'pass' },
    ],
  };
  const b = pickBestClaim(opts)!;
  check('同級碰按座位（from=2 → 3 比 1 近）', b.player === 3, `got ${b.player}:${b.kind}`);
}
{
  // 玩家0 可碰、AI 可胡，排除玩家0 後 → AI 胡
  const opts: ClaimOptions = {
    from: 2, tile: T('p', 7),
    choices: [
      { player: 0, kind: 'pong', tile: T('p', 7) },
      { player: 1, kind: 'win', tile: T('p', 7) },
      { player: -1, kind: 'pass' },
    ],
  };
  check('玩家0 有選項時 AI 胡仍是全局最優', pickBestClaim(opts)!.player === 1);
  check('玩家0 過牌後讓位給 AI 胡', pickBestClaim(opts, true)!.player === 1);
}
{
  // 槓 > 碰
  const opts: ClaimOptions = {
    from: 0, tile: T('s', 3),
    choices: [
      { player: 1, kind: 'pong', tile: T('s', 3) },
      { player: 2, kind: 'kong', tile: T('s', 3) },
      { player: -1, kind: 'pass' },
    ],
  };
  check('槓 壓過 碰', pickBestClaim(opts)!.kind === 'kong');
}

// ===== 2. 番種 =====
console.log('[2] calcFans');
{
  const hand = H(['m1', 'm2', 'm3', 'm7', 'm8', 'm9', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's1', 's1']);
  const r = calcFans(hand, [], { selfDraw: true, seatWind: 1, roundWind: 1 });
  const names = r.fans.map((f) => f.name);
  check('平胡 判定', names.includes('平胡'), names.join(','));
  check('自摸 判定', names.includes('自摸'), names.join(','));
  check('平胡+自摸 共 2 番', r.total === 2, `total=${r.total}`);
}
{
  const hand = H(['m1', 'm1', 'm1', 'p2', 'p2', 'p2', 's3', 's3', 's3', 'z5', 'z5', 'z5', 's1', 's1']);
  const r = calcFans(hand, [], { selfDraw: true });
  check('無副露碰碰胡 判定', r.fans.some((f) => f.name === '碰碰胡'), r.fans.map((f) => f.name).join(','));
}
{
  // 4 張同牌不得算碰碰胡
  const hand = H(['m1', 'm1', 'm1', 'm1', 'p2', 'p2', 'p2', 's3', 's3', 's3', 'z5', 'z5', 'z5', 's1']);
  const r = calcFans(hand, [], {});
  check('4 張同牌不成碰碰胡', !r.fans.some((f) => f.name === '碰碰胡'), r.fans.map((f) => f.name).join(','));
}
{
  // 門風刻（玩家0 門風東 = z1）
  const hand = H(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'z1', 'z1', 'z1', 's5', 's5']);
  const r = calcFans(hand, [], { selfDraw: true, seatWind: 1, roundWind: 1 });
  const names = r.fans.map((f) => f.name);
  check('門風東刻', names.includes('門風東刻'), names.join(','));
  check('圈風東刻', names.includes('圈風東刻'), names.join(','));
  check('門風+圈風+自摸 不誤判平胡', !names.includes('平胡'), names.join(','));
}
{
  const hand = H(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'z5', 'z5', 'z5', 's7', 's7']);
  check('含刻子不成平胡', !isAllChows(hand, []));
}

// ===== 3. 加槓 / 搶槓胡 =====
console.log('[3] addedKong / 搶槓胡');
function makeGame(): Game {
  const g = new Game();
  g.dealer = 0;
  g.wall = fullWall();
  g.players = [0, 1, 2, 3].map((i) => ({
    hand: [], melds: [], discards: [], flowers: [], isAI: i !== 0,
  }));
  // 玩家1：已有中(5)碰 + 手上第 4 張中
  g.players[1].melds.push({ type: 'pong', tiles: [T('z', 5), T('z', 5), T('z', 5)], from: 0 });
  g.players[1].hand = sortTiles(H(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'p1', 'p2', 'p3', 'z5']));
  // 玩家2：聽 中（4 順 + 單張中）
  g.players[2].hand = H(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'z5']);
  g.players[0].hand = H(['m7', 'm8', 'm9', 'p7', 'p8', 'p9', 's7', 's8', 's9', 'z1', 'z2', 'z3', 'z4']);
  g.players[3].hand = H(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'z6', 'z6', 'z7', 'z7']);
  g.current = 1;
  g.phase = 'turn';
  return g;
}
{
  const g = makeGame();
  let prompt: ClaimOptions | null = null;
  g.onPrompt = (o) => { prompt = o; };
  const wallBefore = g.wall.length;
  const tailTile = g.wall[0];
  const ok = g.addedKong(1, T('z', 5));
  check('加槓觸發搶槓胡 claim', ok && g.phase === 'claiming' && prompt?.rob === true);
  check('搶槓選項含玩家2 胡', !!prompt?.choices.some((c) => c.player === 2 && c.kind === 'win'));
  check('加槓牌已移出手牌（未成槓）', !g.players[1].hand.some((t) => t.suit === 'z' && t.rank === 5));

  g.resolveClaim({ player: 2, kind: 'win', tile: T('z', 5) });
  check('搶槓胡 → 遊戲結束', g.phase === 'game_over' && g.current === 2);
  const fans = g.lastResult;
  check('記錄非莊家胡', fans === 'non_dealer_win', String(fans));
  void tailTile; void wallBefore;
}
{
  // 無人搶槓 → 槓成立 + 嶺上補牌（從牌牆尾端 shift）
  const g = makeGame();
  g.players[2].hand = H(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'z6']);
  let prompts = 0;
  g.onPrompt = () => { prompts++; };
  const tailTile = g.wall[0];
  const wallBefore = g.wall.length;
  const ok = g.addedKong(1, T('z', 5));
  check('無人搶槓 → 直接成槓', ok && g.phase === 'turn' && prompts === 0);
  const kong = g.players[1].melds.find((m) => m.type === 'kong');
  check('碰 已升為 槓（4 張）', !!kong && kong.tiles.length === 4);
  check('嶺上補牌：牌牆少 1 張', g.wall.length === wallBefore - 1);
  const hand = g.players[1].hand;
  check('嶺上補牌取自牌牆尾端', hand.some((t) => t.suit === tailTile.suit && t.rank === tailTile.rank));
  check('槓後輪到玩家1 出牌', g.current === 1);
}
{
  // 搶槓後過牌 → 槓成立
  const g = makeGame();
  g.onPrompt = () => {};
  g.addedKong(1, T('z', 5));
  check('搶槓 claim 已建立', g.phase === 'claiming');
  const passChoice = g.getPendingClaimPass();
  check('取得 pass 選項', !!passChoice);
  g.resolveClaim(passChoice!);
  check('過牌後槓成立並回到 turn', g.phase === 'turn' && g.players[1].melds.some((m) => m.type === 'kong'));
}

// ===== 4. 岭上補牌（明槓 / 暗槓） =====
console.log('[4] 槓後嶺上補牌');
{
  const g = makeGame();
  g.players[1].melds = [];
  g.players[1].hand = sortTiles(H(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'p1', 'p2', 'z5', 'z5', 'z5']));
  g.onEvent = () => {};
  g.onPrompt = () => {};
  const tailTile = g.wall[0];
  const ok = g.concealedKong(1, T('z', 5));
  // 暗槓需 4 張同牌
  check('暗槓需 4 張同牌（3 張時拒絕）', !ok);
  g.players[1].hand = sortTiles(H(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'p1', 'z5', 'z5', 'z5', 'z5']));
  const ok2 = g.concealedKong(1, T('z', 5));
  check('暗槓成立', ok2 && g.players[1].melds.some((m) => m.type === 'kong' && m.concealed === true));
  check('暗槓嶺上補牌取自尾端', g.players[1].hand.some((t) => t.suit === tailTile.suit && t.rank === tailTile.rank));
}

// ===== 5. 一炮多響：取先胡者 =====
console.log('[5] 一炮多響');
{
  const opts: ClaimOptions = {
    from: 3, tile: T('p', 9),
    choices: [
      { player: 2, kind: 'win', tile: T('p', 9) },
      { player: 1, kind: 'win', tile: T('p', 9) },
      { player: -1, kind: 'pass' },
    ],
  };
  const b = pickBestClaim(opts)!;
  check('多家可胡 → 取離出牌者最近者（from=3 → 0,1,2 → 1）', b.player === 1, `got ${b.player}`);
}

// ===== 6. 胡牌判定回歸 =====
console.log('[6] isWinningHand 回歸');
{
  const hand = H(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'z5', 'z5', 'z5', 's7', 's7']);
  check('4 組 + 1 對', isWinningHand(hand, []));
  const seven = H(['m1', 'm1', 'm2', 'm2', 'p3', 'p3', 'p4', 'p4', 's5', 's5', 'z1', 'z1', 'z6', 'z6']);
  check('七對', isWinningHand(seven, []));
  const withMeld = H(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's7', 's7']);
  check('副露後手牌長度校驗', !isWinningHand(withMeld, [{ type: 'pong', tiles: [T('z', 5), T('z', 5), T('z', 5)] }]));
  const okMeld = H(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's7', 's8', 's9', 'z6', 'z6']);
  check('副露 + 3 組 + 對', isWinningHand(okMeld, [{ type: 'pong', tiles: [T('z', 5), T('z', 5), T('z', 5)] }]));
}

console.log(`\n合計 pass=${pass} fail=${fail}`);
