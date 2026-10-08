// 積分模式：一二蚊（半銃制、辣辣上）結算
//
// 規則（參考粵語維基「廣東麻雀籌碼計法」）：
//   一二蚊單份金額：0番=1, 1番=2, 2番=4, 3番=8, 4番=16, 5番=32 …（辣辣上：每番翻倍 = 2^番）
//   出銃（點炮）：出銃者出雙份，其餘兩家出單份（半銃）
//   自摸：三家各出雙份（位位收錢）
//   花牌：與門風相符的花牌逐張計 1 番（春/梅=東，夏/蘭=南，秋/竹=西，冬/菊=北）

import { TileDef } from './tiles';

/** 開局每人積分 */
export const START_SCORE = 1000;

/** 花牌 rank → 對應門風 rank（1東 2南 3西 4北）
 *  1春 2夏 3秋 4冬 5梅 6蘭 7菊 8竹 */
export const FLOWER_WIND: Record<number, number> = {
  1: 1, 2: 2, 3: 3, 4: 4, 5: 1, 6: 2, 7: 4, 8: 3,
};

/** 與門風相符的花牌逐張計 1 番 */
export function countFlowerFans(flowers: TileDef[], seatWind: number): number {
  return flowers.filter((f) => FLOWER_WIND[f.rank] === seatWind).length;
}

/** 一二蚊（辣辣上）單份金額 = 2^番 */
export function fanToUnit(fan: number): number {
  return Math.pow(2, Math.max(0, Math.floor(fan)));
}

export interface SettleParams {
  winner: number;
  /** 計分番數（已含花牌番，未含「底胡」補底） */
  fan: number;
  selfDraw: boolean;
  /** 出銃者座標（自摸時為 null） */
  from: number | null;
}

export interface SettleResult {
  winner: number;
  fan: number;
  /** 單份金額 */
  unit: number;
  selfDraw: boolean;
  from: number | null;
  /** 四家積分變化（和為 0） */
  deltas: number[];
}

/** 半銃制結算：返回四家積分變化（自摸 6×unit；出銃 4×unit） */
export function settleWin(params: SettleParams): SettleResult {
  const unit = fanToUnit(params.fan);
  const deltas = [0, 0, 0, 0];
  const { winner, selfDraw } = params;

  if (selfDraw) {
    for (let q = 0; q < 4; q++) {
      deltas[q] = q === winner ? 6 * unit : -2 * unit;
    }
    return { winner, fan: params.fan, unit, selfDraw, from: null, deltas };
  }

  // 出銃：出銃者雙份，其餘兩家單份
  const from = params.from !== null && params.from !== undefined && params.from !== winner
    ? params.from
    : (winner + 1) % 4; // 兜底：缺出銃者時記在下家
  deltas[winner] = 4 * unit;
  deltas[from] = -2 * unit;
  for (let q = 0; q < 4; q++) {
    if (q !== winner && q !== from) deltas[q] = -unit;
  }
  return { winner, fan: params.fan, unit, selfDraw, from, deltas };
}

/** 積分排名（由高到低），同分按座位序 */
export function rankScores(scores: number[]): { player: number; score: number }[] {
  return scores
    .map((score, player) => ({ player, score }))
    .sort((a, b) => b.score - a.score || a.player - b.player);
}
