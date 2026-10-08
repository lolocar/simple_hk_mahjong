// AI 對手：簡單策略（打孤張、留對/搭子、碰胡優先）

import { TileDef, tilesEqual } from '../game/tiles';
import { getWinningTiles } from '../game/hand';
import { Game, ClaimChoice } from '../game/game';

export class AIPlayer {
  constructor(private game: Game, private playerIdx: number) {}

  /** 選擇要打哪張牌（保證返回的牌一定在手牌中，絕不返回不存在的牌） */
  chooseDiscard(): TileDef {
    const hand = this.game.players[this.playerIdx].hand;
    const melds = this.game.players[this.playerIdx].melds;

    // 兜底：手牌為空時返回第一張（正常不會發生，但避免 undefined 導致 discard 被忽略）
    if (hand.length === 0) return hand[0];

    // 按「實際索引」逐張評分，避免對同一張牌多次 findIndex 造成的錯配
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < hand.length; i++) {
      const tile = hand[i];
      const rest = hand.filter((_, j) => j !== i);
      let score = 0;
      // 1. 打這張後能聽牌，聽口數越多越好
      try {
        score += getWinningTiles(rest, melds).length;
      } catch {
        // 胡牌判定異常不影響出牌，按 0 分處理
      }
      // 2. 孤立字牌（單張、無對子）優先打
      const cnt = hand.filter((t) => tilesEqual(t, tile)).length;
      if (tile.suit === 'z' && cnt === 1) score += 0.5;
      // 3. 孤立數牌（無相鄰 ±1）優先打
      if (tile.suit !== 'z') {
        const hasNeighbor =
          hand.some((t) => t.suit === tile.suit && Math.abs(t.rank - tile.rank) === 1) ||
          cnt >= 2;
        if (!hasNeighbor && cnt === 1) score += 1;
      }
      // 4. 微擾：完全同分时，優先打「對子/搭子以外」的牌，並用索引打破平局
      //    （避免 strict > 在等分時選到已被移出的牌）
      score += (i === bestIdx ? 0 : 0.01);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return hand[bestIdx];
  }

  /** 決定是否加槓（補槓）：有碰子且握有第 4 張即加槓，搏槓上開花。
   *  無可加槓牌時返回 null。 */
  chooseAddedKong(): TileDef | null {
    const opts = this.game.getAddedKongOptions(this.playerIdx);
    if (opts.length === 0) return null;
    return opts[0];
  }

  /** 決定如何回應 claim（胡 > 碰 > 吃 > 過） */
  respondClaim(options: { from: number; tile: TileDef; choices: ClaimChoice[] }): ClaimChoice {
    const myChoices = options.choices.filter((c) => c.player === this.playerIdx);
    if (myChoices.length === 0) return options.choices.find((c) => c.kind === 'pass')!;
    // 胡
    const win = myChoices.find((c) => c.kind === 'win');
    if (win) return win;
    // 碰（字牌或萬筒條刻子都碰，簡單策略：碰）
    const pong = myChoices.find((c) => c.kind === 'pong');
    if (pong) return pong;
    // 吃
    const chi = myChoices.find((c) => c.kind === 'chi');
    if (chi) return chi;
    return options.choices.find((c) => c.kind === 'pass')!;
  }
}
