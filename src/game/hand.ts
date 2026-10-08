// 胡牌判定與番數計算（港式推倒胡）

import { TileDef, Suit, tileKey, countTiles, tilesEqual, makeTile, HONOR_NAMES } from './tiles';

/**
 * 胡牌判定：手牌 + 副露 = 4組（順子/刻子）+ 1對，或七對。
 * melds: 已亮出的副露（吃/碰/槓），每個算一組。
 */
export function isWinningHand(tiles: TileDef[], melds: { type: string; tiles: TileDef[] }[] = []): boolean {
  // 手牌長度必須是 3n+2（n = 4 - melds.length）
  const neededSets = 4 - melds.length;
  if (tiles.length !== neededSets * 3 + 2) return false;
  // 七對（僅無副露時）
  if (melds.length === 0 && isSevenPairs(tiles)) return true;
  const counts = countTiles(tiles);
  // 枚舉雀頭
  for (const [k, c] of counts) {
    if (c >= 2) {
      const rest = new Map(counts);
      rest.set(k, c - 2);
      if (canFormGroups(rest)) return true;
    }
  }
  return false;
}

function isSevenPairs(tiles: TileDef[]): boolean {
  if (tiles.length !== 14) return false;
  const counts = countTiles(tiles);
  let pairs = 0;
  for (const c of counts.values()) {
    if (c === 2) pairs++;
    else if (c !== 4) return false;
  }
  return pairs === 7;
}

function canFormGroups(counts: Map<string, number>): boolean {
  const keys = [...counts.keys()].filter((k) => (counts.get(k) ?? 0) > 0);
  if (keys.length === 0) return true;
  // 找第一張牌
  const first = keys.sort(compareKeys)[0];
  const [suit, rankStr] = parseKey(first);
  const rank = parseInt(rankStr, 10);
  const c = counts.get(first)!;

  // 刻子
  if (c >= 3) {
    const next = new Map(counts);
    next.set(first, c - 3);
    if (canFormGroups(next)) return true;
  }
  // 順子（僅數牌）
  if (suit !== 'z' && rank <= 7) {
    const k2 = `${suit}${rank + 1}`;
    const k3 = `${suit}${rank + 2}`;
    if ((counts.get(k2) ?? 0) > 0 && (counts.get(k3) ?? 0) > 0) {
      const next = new Map(counts);
      next.set(first, c - 1);
      next.set(k2, counts.get(k2)! - 1);
      next.set(k3, counts.get(k3)! - 1);
      if (canFormGroups(next)) return true;
    }
  }
  // 4 張同牌：可拆成 2+2（剩 2 張可再當雀頭或另一組），避免只走刻子分支剩 1 張失敗
  if (c >= 4) {
    const next = new Map(counts);
    next.set(first, c - 2);
    if (canFormGroups(next)) return true;
  }
  return false;
}

function compareKeys(a: string, b: string): number {
  const ta = parseKey(a);
  const tb = parseKey(b);
  if (ta[0] !== tb[0]) return ta[0] < tb[0] ? -1 : 1;
  return parseInt(ta[1], 10) - parseInt(tb[1], 10);
}

function parseKey(k: string): [string, string] {
  return [k[0], k.slice(1)];
}

// ===== 番數計算 =====

export interface FanResult {
  fans: { name: string; value: number }[];
  total: number;
  minFan: number; // 起胡番數（港式推倒胡通常1番起胡，這裡設為0即可胡）
}

/**
 * 計算胡牌番數（港式常見番種簡化版）
 */
export interface CalcFansMeld {
  tiles: TileDef[];
  concealed?: boolean;
}

/** 和牌情境（番種判定用） */
export interface WinContext {
  selfDraw?: boolean;   // 自摸
  seatWind?: number;    // 門風 rank（1東 2南 3西 4北）
  roundWind?: number;   // 圈風 rank（1東 ...）
  fromKong?: boolean;   // 槓後補牌直接自摸（槓上開花）
  robKong?: boolean;    // 搶槓胡
  lastWall?: boolean;   // 牌牆最後一張自摸（海底撈月）
}

export function calcFans(hand: TileDef[], melds: CalcFansMeld[], ctx: WinContext = {}): FanResult {
  const fans: { name: string; value: number }[] = [];
  const allTiles = [...hand];
  for (const m of melds) allTiles.push(...m.tiles);

  // 七對
  if (melds.length === 0 && isSevenPairs(hand)) {
    fans.push({ name: '七對', value: 4 });
  }

  // 清一色
  const suits = new Set(allTiles.map((t) => t.suit));
  const hasHonors = suits.has('z');
  const numSuits = [...suits].filter((s) => s !== 'z').length;
  if (numSuits === 1 && !hasHonors) {
    fans.push({ name: '清一色', value: 6 });
  } else if (numSuits === 0 && hasHonors) {
    fans.push({ name: '字一色', value: 8 });
  } else if (numSuits === 1 && hasHonors) {
    fans.push({ name: '混一色', value: 3 });
  }

  // 大三元 / 小三元
  const counts = countTiles(allTiles);
  const dragons = [5, 6, 7].filter((r) => (counts.get(`z${r}`) ?? 0) >= 3);
  if (dragons.length === 3) fans.push({ name: '大三元', value: 8 });
  else if (dragons.length === 2) {
    const pairDragon = [5, 6, 7].find((r) => !dragons.includes(r) && (counts.get(`z${r}`) ?? 0) >= 2);
    if (pairDragon) fans.push({ name: '小三元', value: 5 });
  }

  // 大四喜 / 小四喜
  const winds = [1, 2, 3, 4].filter((r) => (counts.get(`z${r}`) ?? 0) >= 3);
  if (winds.length === 4) fans.push({ name: '大四喜', value: 8 });
  else if (winds.length === 3) {
    const pairWind = [1, 2, 3, 4].find((r) => !winds.includes(r) && (counts.get(`z${r}`) ?? 0) >= 2);
    if (pairWind) fans.push({ name: '小四喜', value: 5 });
  }

  // 碰碰胡（全刻子 + 1對）：副露須全為碰/槓，手牌部分亦須成全刻子
  const meldsAllPungs = melds.every(
    (m) => m.tiles.length >= 2 && tilesEqual(m.tiles[0], m.tiles[1])
  );
  if (meldsAllPungs && isAllPungs(hand)) {
    fans.push({ name: '碰碰胡', value: 3 });
  }

  // 平胡（全順子 + 數牌雀頭，副露全為吃）
  if (isAllChows(hand, melds)) {
    fans.push({ name: '平胡', value: 1 });
  }

  // 門風 / 圈風刻子
  if (ctx.seatWind && (counts.get(`z${ctx.seatWind}`) ?? 0) >= 3) {
    fans.push({ name: `門風${HONOR_NAMES[ctx.seatWind]}刻`, value: 1 });
  }
  if (ctx.roundWind && (counts.get(`z${ctx.roundWind}`) ?? 0) >= 3) {
    fans.push({ name: `圈風${HONOR_NAMES[ctx.roundWind]}刻`, value: 1 });
  }

  // 自摸 / 槓上開花 / 搶槓胡 / 海底撈月
  if (ctx.selfDraw) fans.push({ name: '自摸', value: 1 });
  if (ctx.fromKong) fans.push({ name: '槓上開花', value: 1 });
  if (ctx.robKong) fans.push({ name: '搶槓胡', value: 1 });
  if (ctx.lastWall) fans.push({ name: '海底撈月', value: 1 });

  // 全帶幺（九蓮寶燈簡化：全數牌無中張 2-8 的順子結構，這裡用全幺九刻子+對）
  // 略

  // 無番時底番
  const total = fans.reduce((s, f) => s + f.value, 0);
  if (total === 0) fans.push({ name: '底胡', value: 1 });

  return { fans, total: Math.max(total, 1), minFan: 0 };
}

/** 只拆順子（不允許刻子）：用於平胡判定 */
function canFormChowsOnly(counts: Map<string, number>): boolean {
  const keys = [...counts.keys()].filter((k) => (counts.get(k) ?? 0) > 0);
  if (keys.length === 0) return true;
  const first = keys.sort(compareKeys)[0];
  const [suit, rankStr] = parseKey(first);
  if (suit === 'z') return false; // 字牌無法成順
  const rank = parseInt(rankStr, 10);
  const c = counts.get(first)!;
  const k2 = `${suit}${rank + 1}`;
  const k3 = `${suit}${rank + 2}`;
  if ((counts.get(k2) ?? 0) > 0 && (counts.get(k3) ?? 0) > 0) {
    const next = new Map(counts);
    next.set(first, c - 1);
    next.set(k2, counts.get(k2)! - 1);
    next.set(k3, counts.get(k3)! - 1);
    if (canFormChowsOnly(next)) return true;
  }
  return false;
}

/** 平胡判定：副露全為吃（順子），手牌拆為全順子 + 數牌雀頭 */
export function isAllChows(hand: TileDef[], melds: { tiles: TileDef[] }[] = []): boolean {
  for (const m of melds) {
    if (m.tiles.length !== 3) return false;
    const suit = m.tiles[0].suit;
    if (suit === 'z' || suit === 'f') return false;
    const ranks = m.tiles.map((t) => t.rank).sort((a, b) => a - b);
    if (m.tiles.some((t) => t.suit !== suit)) return false;
    if (ranks[1] !== ranks[0] + 1 || ranks[2] !== ranks[0] + 2) return false;
  }
  const counts = countTiles(hand);
  for (const [k, c] of counts) {
    if (c >= 2 && k[0] !== 'z') {
      const rest = new Map(counts);
      rest.set(k, c - 2);
      if (canFormChowsOnly(rest)) return true;
    }
  }
  return false;
}

function isAllPungs(hand: TileDef[]): boolean {
  // 手牌（副露之外）= 1對 + 全刻子；4 張同牌是「刻子 + 單張」，不成全刻子
  const counts = countTiles(hand);
  let pairFound = false;
  for (const c of counts.values()) {
    if (c === 3) continue;
    if (c === 2 && !pairFound) { pairFound = true; continue; }
    if (c === 1) return false;
    if (c === 2 && pairFound) return false;
    if (c === 4) return false;
  }
  return pairFound;
}

/** 聽牌判定：手牌（3n+1 張），返回所有可胡的牌 */
export function getWinningTiles(hand: TileDef[], melds: { type: string; tiles: TileDef[] }[] = []): TileDef[] {
  const results: TileDef[] = [];
  const wall = buildAllTiles();
  for (const t of wall) {
    if (hand.some((h) => tilesEqual(h, t)) && countTiles(hand).get(tileKey(t))! >= 4) continue;
    if (isWinningHand([...hand, t], melds)) {
      if (!results.some((r) => tilesEqual(r, t))) results.push(t);
    }
  }
  return results;
}

function buildAllTiles(): TileDef[] {
  const tiles: TileDef[] = [];
  const suits: Suit[] = ['m', 'p', 's'];
  for (const s of suits) for (let r = 1; r <= 9; r++) tiles.push(makeTile(s, r));
  for (let r = 1; r <= 7; r++) tiles.push(makeTile('z', r));
  return tiles;
}


