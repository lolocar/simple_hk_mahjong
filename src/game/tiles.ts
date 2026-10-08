// 港式麻雀牌組：萬子 1-9、筒子 1-9、條子 1-9、東南西北中發白、春夏秋冬梅蘭菊竹（144張，含花牌）

export type Suit = 'm' | 'p' | 's' | 'z' | 'f';

export interface TileDef {
  suit: Suit;
  rank: number; // 1-9 for suited, 1-7 for honors, 1-8 for flowers
}

/** 花牌判定（春夏秋冬梅蘭菊竹，摸到需補花） */
export function isFlower(t: TileDef): boolean {
  return t.suit === 'f';
}

export function tileKey(t: TileDef): string {
  return `${t.suit}${t.rank}`;
}

export function makeTile(suit: Suit, rank: number): TileDef {
  return { suit, rank };
}

export function fullWall(): TileDef[] {
  const wall: TileDef[] = [];
  const suits: Suit[] = ['m', 'p', 's'];
  for (const s of suits) {
    for (let r = 1; r <= 9; r++) {
      for (let i = 0; i < 4; i++) wall.push(makeTile(s, r));
    }
  }
  for (let r = 1; r <= 7; r++) {
    for (let i = 0; i < 4; i++) wall.push(makeTile('z', r));
  }
  // 花牌：春夏秋冬梅蘭菊竹（各 1 張，共 8 張）
  for (let r = 1; r <= 8; r++) wall.push(makeTile('f', r));
  return wall; // 136 + 8 = 144
}

export function compareTiles(a: TileDef, b: TileDef): number {
  const suitOrder: Record<Suit, number> = { m: 0, p: 1, s: 2, z: 3, f: 4 };
  if (suitOrder[a.suit] !== suitOrder[b.suit]) return suitOrder[a.suit] - suitOrder[b.suit];
  return a.rank - b.rank;
}

export function sortTiles(tiles: TileDef[]): TileDef[] {
  return [...tiles].sort(compareTiles);
}

export function tilesEqual(a: TileDef, b: TileDef): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function countTiles(tiles: TileDef[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tiles) {
    const k = tileKey(t);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// 榮牌名稱（繁體）
export const HONOR_NAMES: Record<number, string> = {
  1: '東', 2: '南', 3: '西', 4: '北', 5: '中', 6: '發', 7: '白',
};

// 花牌名稱（繁體）
export const FLOWER_NAMES: Record<number, string> = {
  1: '春', 2: '夏', 3: '秋', 4: '冬', 5: '梅', 6: '蘭', 7: '菊', 8: '竹',
};

export function tileName(t: TileDef): string {
  if (t.suit === 'z') return HONOR_NAMES[t.rank];
  if (t.suit === 'f') return FLOWER_NAMES[t.rank];
  const num = ['一', '二', '三', '四', '五', '六', '七', '八', '九'][t.rank - 1];
  if (t.suit === 'm') return `${num}萬`;
  if (t.suit === 'p') return `${num}筒`;
  return `${num}條`;
}
