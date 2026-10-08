// 遊戲狀態機：四人港式麻雀（推倒胡）

import { TileDef, Suit, fullWall, sortTiles, tilesEqual, makeTile, countTiles, isFlower } from './tiles';
import { isWinningHand, calcFans, FanResult, WinContext } from './hand';
import { START_SCORE, countFlowerFans, settleWin, SettleResult } from './score';
export type { FanResult };
export type { SettleResult };

export type PlayerAction =
  | { type: 'draw' }
  | { type: 'discard'; tile: TileDef }
  | { type: 'chi'; tiles: TileDef[]; from: number }
  | { type: 'pong'; tile: TileDef; from: number }
  | { type: 'kong'; tile: TileDef; from: number }
  | { type: 'win'; tile: TileDef }
  | { type: 'pass' };

export interface Meld {
  type: 'chi' | 'pong' | 'kong';
  tiles: TileDef[];
  from: number; // 來源玩家
  concealed?: boolean; // 暗槓（4 張全來自手牌，牌面朝下）
}

export interface PlayerState {
  hand: TileDef[];
  melds: Meld[];
  discards: TileDef[];
  flowers: TileDef[]; // 花牌（摸到後補花，不算番）
  isAI: boolean;
}

export interface GameEvent {
  type:
    | 'game_start'
    | 'dice'
    | 'draw'
    | 'discard'
    | 'chi'
    | 'pong'
    | 'kong'
    | 'flower'
    | 'win'
    | 'exhaustive_draw'
    | 'turn';
  player: number;
  tile?: TileDef;
  tiles?: TileDef[];
  from?: number;
  /** 槓的種類（僅 kong 事件）：明槓=吃弃牌、暗槓=手牌四張朝下、加槓=碰升級 */
  kongKind?: 'ming' | 'angang' | 'jigang';
  fans?: FanResult;
  dice?: number;
  /** 積分模式：本局結算（僅 win 事件攜帶） */
  settle?: SettleResult;
}

export type GamePhase = 'idle' | 'dealing' | 'turn' | 'claiming' | 'game_over';

export interface DiceResult {
  dice: [number, number, number];
  total: number;
  dealer: number; // 莊家座標 0-3
  startPlayer: number; // 發牌起點座標 0-3
}

export class Game {
  players: PlayerState[] = [];
  wall: TileDef[] = [];
  current: number = 0; // 當前出牌玩家
  phase: GamePhase = 'idle';
  roundWind: TileDef = makeTile('z', 1); // 東局
  turnCount = 0;
  dealer: number = 0; // 莊家座標
  diceResult: DiceResult | null = null;

  // 上一局結果（用於決定過莊/連莊）
  lastResult: 'dealer_win' | 'non_dealer_win' | 'exhaustive' | null = null;
  lastWinner: number | null = null; // 胡牌者座標

  // ===== 積分模式（一二蚊）=====
  /** 各家累計積分，開局每人 START_SCORE */
  scores: number[] = [START_SCORE, START_SCORE, START_SCORE, START_SCORE];
  /** 各家胡牌次數（自摸 + 出銃胡 + 搶槓胡） */
  wins: number[] = [0, 0, 0, 0];
  /** 各家放炮次數（打出被別家胡的牌；搶槓胡記在加槓者身上） */
  deals: number[] = [0, 0, 0, 0];
  /** 任一家積分 ≤ 0 即整場結束 */
  matchOver = false;
  /** 整場結束原因：積分見底 / 四圈完成（北圈結束） */
  overReason: 'bankrupt' | 'rounds' | null = null;

  // 事件回調
  onEvent: ((e: GameEvent) => void) | null = null;
  // 等待玩家決策的回調：返回可選操作
  onPrompt: ((options: ClaimOptions) => void) | null = null;

  private pendingClaim: ClaimOptions | null = null;
  /** 搶槓胡待決：加槓已從手牌移出該牌，等待別家搶胡 / 過牌 */
  private robPending: { p: number; tile: TileDef } | null = null;
  /** 剛完成槓後補牌（槓上開花判定） */
  private kongReplacement = false;

  // 玩家0 是否需要先手動摸牌（true=待摸牌，false=已摸牌可出牌）
  // AI 玩家不受影響（自動摸牌）。
  private awaitingDraw = false;

  /** 玩家0 是否處於「待摸牌」狀態 */
  get isAwaitingDraw(): boolean {
    return this.awaitingDraw;
  }

  /** 取得目前 pending claim 的「過」選項（供看門狗強制解決 claim 卡死） */
  getPendingClaimPass(): ClaimChoice | null {
    if (!this.pendingClaim) return null;
    return this.pendingClaim.choices.find((c) => c.kind === 'pass') ?? null;
  }

  /** 取得目前 pending claim 的完整選項（供玩家0 過牌後重新裁決別家 claim） */
  getPendingClaim(): ClaimOptions | null {
    return this.pendingClaim;
  }

  /** 擲 3 顆骰子決定開門方位（發牌起點）
   * 莊家以當前 this.dealer 為準（首局為 0，之後由 nextDealer 決定過莊/連莊），
   * 以自己作「1」，按逆時針（座標遞增）數 total 格，停下的位置即開門方位（配牌起點）。
   */
  rollDice(): DiceResult {
    const dice: [number, number, number] = [
      1 + Math.floor(Math.random() * 6),
      1 + Math.floor(Math.random() * 6),
      1 + Math.floor(Math.random() * 6),
    ];
    const total = dice[0] + dice[1] + dice[2];
    // 莊家沿用上一局決定的座標（this.dealer）
    const dealer = this.dealer;
    // 開門方位：以自己作 1，逆時針數 total 格 → (total-1) 步
    const startPlayer = (dealer + (total - 1)) % 4;
    this.dealer = dealer;
    this.diceResult = { dice, total, dealer, startPlayer };
    return this.diceResult;
  }

  /** 根據上一局結果決定新一局的莊家（港式推倒胡過莊規則）：
   *  - 莊家胡牌（自摸/被胡）→ 連莊
   *  - 閑家胡牌 → 過莊：莊位逆時針移給莊家下家（(dealer+1)%4），不隨胡牌者
   *  - 流局 → 過莊：莊位逆時針移給莊家下家（(dealer+1)%4）
   * 返回 { dealer, kind } 供 UI 顯示「連莊/過莊」提示 */
  nextDealer(): { dealer: number; kind: 'first' | 'lian' | 'guo' } {
    const prev = this.dealer;
    let dealer = prev;
    let kind: 'first' | 'lian' | 'guo' = 'first';
    if (this.lastResult === null) {
      // 首局：莊家固定為玩家0（東位）
      dealer = 0;
      kind = 'first';
    } else if (this.lastResult === 'dealer_win') {
      dealer = prev; // 連莊
      kind = 'lian';
    } else {
      // 閑家胡牌 或 流局：莊位一律逆時針過給莊家下家
      dealer = (prev + 1) % 4;
      kind = 'guo';
    }
    this.dealer = dealer;
    // 圈風 = 莊家座標風（東位莊=東圈、南位莊=南圈、西位莊=西圈、北位莊=北圈）
    this.roundWind = makeTile('z', dealer + 1);
    this.lastResult = null;
    this.lastWinner = null;
    return { dealer, kind };
  }

  /** 洗牌並發牌（同步，用於動畫前的準備）
   * 港式規則：配牌固定從莊家開始，逆時針（自己→右家→對家→左家）發給下家、對家、上家。
   * 骰子只決定牌牆取牌起點（開門方位），不影響發牌順序。
   * 本方法只做「配牌」，不補花：補花由 resolveFlowers() 在發牌動畫完成後執行，
   * 動畫期間桌上顯示的是補花前的原始配牌（花牌仍在手牌中，花牌區為空）。 */
  prepareDeal(): TileDef[][] {
    const dealer = this.diceResult?.dealer ?? 0;
    this.wall = fullWall();
    // 洗牌
    for (let i = this.wall.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.wall[i], this.wall[j]] = [this.wall[j], this.wall[i]];
    }
    this.players = [0, 1, 2, 3].map((i) => ({
      hand: [],
      melds: [],
      discards: [],
      flowers: [],
      isAI: i !== 0,
    }));
    // 發牌：每次 4 張（兩層每層 2 張）給一家，從莊家開始輪流，共 52 張
    const hands: TileDef[][] = [[], [], [], []];
    for (let round = 0; round < 3; round++) {
      for (let k = 0; k < 4; k++) {
        const p = (dealer + k) % 4;
        for (let c = 0; c < 4; c++) hands[p].push(this.wall.pop()!);
      }
    }
    for (let k = 0; k < 4; k++) {
      const p = (dealer + k) % 4;
      hands[p].push(this.wall.pop()!);
    }
    // 補花前的原始配牌直接入手的（花牌留在手牌裡，此時花牌區為空）
    // 手牌入局用排序後的；返回值保留「摸牌順序」（未排序），供發牌動畫按摸牌順序從少到多展示
    for (let p = 0; p < 4; p++) {
      this.players[p].hand = sortTiles(hands[p]);
    }
    this.current = this.dealer;
    this.turnCount = 0;
    // 配牌完成 ≠ 可以行牌：發牌動畫期間必須處於 'dealing'，
    // 否則看門狗 / 上局遺留定時任務會把 phase='turn' + current=莊家(AI) 當成合法回合，
    // 在動畫中途驅動 AI 出牌 → discard 事件讓 renderHand 瞬間画出全部 13 張手牌。
    // 真正的 'turn' 由 finishDeal() 在動畫與補花全部完成後才開啟。
    this.phase = 'dealing';
    this.awaitingDraw = false;
    return hands;
  }

  /** 補花：發牌動畫完成後呼叫。依莊家→下家→對家→上家（逆時針）依次補花。
   *  各家把配牌中的花牌移入花牌區，再從牌牆補回同等數量的非花牌；
   *  補到花牌時同樣入花牌區並繼續補，直到補滿。
   *  @returns 從牌牆補取的張數（供 3D 牌牆同步） */
  resolveFlowers(): number {
    const dealer = this.diceResult?.dealer ?? 0;
    let taken = 0;
    for (let k = 0; k < 4; k++) {
      const p = (dealer + k) % 4;
      const flowers = this.players[p].hand.filter((t) => isFlower(t));
      if (flowers.length === 0) continue;
      this.players[p].hand = this.players[p].hand.filter((t) => !isFlower(t));
      for (const t of flowers) {
        this.players[p].flowers.push(t);
        this.emit({ type: 'flower', player: p, tile: t });
      }
      // 補回同等數量的非花牌；補到花牌則入花牌區、繼續補
      let toFill = flowers.length;
      while (toFill > 0 && this.wall.length > 0) {
        const t = this.wall.pop()!;
        taken++;
        if (isFlower(t)) {
          this.players[p].flowers.push(t);
          this.emit({ type: 'flower', player: p, tile: t });
        } else {
          this.players[p].hand.push(t);
          toFill--;
        }
      }
      this.players[p].hand = sortTiles(this.players[p].hand);
    }
    return taken;
  }

  /** 返回發牌順序（座標数组），供動畫使用
   * 固定從莊家開始，逆時針（莊→下家→對家→上家） */
  getDealOrder(): number[] {
    const dealer = this.diceResult?.dealer ?? 0;
    const order: number[] = [];
    for (let round = 0; round < 3; round++) {
      for (let k = 0; k < 4; k++) {
        order.push((dealer + k) % 4);
      }
    }
    for (let k = 0; k < 4; k++) {
      order.push((dealer + k) % 4);
    }
    return order;
  }

  /** 發牌動畫完成後調用：莊家摸第一張並開始回合
   * 莊家為玩家0 時不自動摸牌，改由玩家點擊空白處手動摸牌 */
  finishDeal() {
    const d = this.dealer;
    // 發牌動畫與補花皆已完成，此時才進入可行牌的 'turn' 階段
    this.phase = 'turn';
    this.emit({ type: 'game_start', player: d });
    if (d === 0) {
      this.awaitingDraw = true;
      this.emit({ type: 'turn', player: d });
    } else {
      const t = this.drawTile(d);
      if (t) this.emit({ type: 'turn', player: d });
    }
  }

  /** 玩家0 手動摸牌（點擊空白處觸發）
   * 返回 true 表示摸牌成功；false 表示狀態不對（非玩家0回合 / 已摸過牌）。 */
  manualDraw(p: number): boolean {
    if (p !== this.current || this.phase !== 'turn' || !this.awaitingDraw) return false;
    this.awaitingDraw = false;
    const t = this.drawTile(p);
    if (t) this.emit({ type: 'turn', player: p });
    return true;
  }

  start() {
    this.rollDice();
    this.prepareDeal();
    this.resolveFlowers();
    this.finishDeal();
  }

  private emit(e: GameEvent) {
    this.onEvent?.(e);
  }

  /** 記錄本局結果（供 nextDealer 決定過莊/連莊） */
  private recordResult(winner: number | null) {
    if (winner === null) {
      this.lastResult = 'exhaustive';
      this.lastWinner = null;
    } else {
      this.lastResult = winner === this.dealer ? 'dealer_win' : 'non_dealer_win';
      this.lastWinner = winner;
    }
    // 圈數計算：莊家座標即圈風（東位=東圈…北位=北圈）。
    // 北圈莊家（座標3）本局非連莊（閑家胡或流局）→ 四圈全部完成 → 整場結束。
    if (this.dealer === 3 && this.lastResult !== 'dealer_win') {
      this.matchOver = true;
      if (this.overReason !== 'bankrupt') this.overReason = 'rounds';
    }
  }

  /** 積分結算（一二蚊・半銃制）：計分番數 = 牌型番（不含補底「底胡」，亦不含「自摸」——
   *  自摸已以「三家各出雙份」体现，計番再算一次即重複）+ 門風花牌番。
   *  自摸三家各出雙份；出銃者雙份、其餘兩家單份。結算後任一家積分 ≤ 0 → 整場結束。 */
  private settle(p: number, fans: FanResult, selfDraw: boolean, from: number | null): SettleResult {
    const flowerFans = countFlowerFans(this.players[p].flowers, p + 1);
    const baseFan = fans.fans
      .filter((f) => f.name !== '底胡' && f.name !== '自摸')
      .reduce((s, f) => s + f.value, 0);
    const res = settleWin({ winner: p, fan: baseFan + flowerFans, selfDraw, from });
    for (let q = 0; q < 4; q++) this.scores[q] += res.deltas[q];
    this.wins[p]++;
    if (!res.selfDraw && res.from !== null) this.deals[res.from]++;
    if (this.scores.some((s) => s <= 0)) {
      this.matchOver = true;
      this.overReason = 'bankrupt';
    }
    return res;
  }

  /** 重新開場：積分重置為開局分，並回到東圈（東位莊家） */
  resetMatch() {
    this.scores = [START_SCORE, START_SCORE, START_SCORE, START_SCORE];
    this.wins = [0, 0, 0, 0];
    this.deals = [0, 0, 0, 0];
    this.dealer = 0;
    this.roundWind = makeTile('z', 1);
    this.lastResult = null;
    this.lastWinner = null;
    this.matchOver = false;
    this.overReason = null;
  }

  private drawTile(p: number, fromTail = false): TileDef | null {
    // 嶺上補牌（槓後補牌）從牌牆尾端取；一般摸牌從當前摸牌口取
    const take = () => (fromTail ? this.wall.shift()! : this.wall.pop()!);
    if (!fromTail) this.kongReplacement = false; // 一般摸牌清空槓上標記
    if (this.wall.length === 0) {
      this.phase = 'game_over';
      this.recordResult(null);
      this.emit({ type: 'exhaustive_draw', player: p });
      return null;
    }
    let t = take();
    // 補花：摸到花牌時移出至花牌區，從牌牆補一張（遞迴直到非花牌或牌牆完）
    while (isFlower(t) && this.wall.length > 0) {
      this.players[p].flowers.push(t);
      this.emit({ type: 'flower', player: p, tile: t });
      t = take();
    }
    // 牌牆完時最後摸到的花牌也入花牌區
    if (isFlower(t)) {
      this.players[p].flowers.push(t);
      this.emit({ type: 'flower', player: p, tile: t });
      this.phase = 'game_over';
      this.recordResult(null);
      this.emit({ type: 'exhaustive_draw', player: p });
      return null;
    }
    // 新摸的牌放在最右方（出牌前保持不排序，符合麻將習慣）
    this.players[p].hand.push(t);
    this.turnCount++;
    this.emit({ type: 'draw', player: p, tile: t });

    // 自摸胡：AI 自動胡；玩家0 由 UI 顯示「自摸胡」按鈕（不自動結束）
    if (isWinningHand(this.players[p].hand, this.players[p].melds) && this.players[p].isAI) {
      const fans = calcFans(this.players[p].hand, this.players[p].melds, this.winCtx(p, true));
      this.phase = 'game_over';
      this.recordResult(p);
      this.emit({ type: 'win', player: p, tile: t, fans, settle: this.settle(p, fans, true, null) });
    }
    return t;
  }

  /** 本局是否已結束（胡牌/流局）。
   *  用 getter 封裝：drawTile 等呼叫可能在內部把 phase 改成 game_over，
   *  直接寫 `this.phase === 'game_over'` 會被 TS 的控制流縮窄判定為永不成立。 */
  private get isGameOver(): boolean {
    return this.phase === 'game_over';
  }

  /** 自摸情境番種判定用 */
  private winCtx(p: number, selfDraw: boolean): WinContext {
    return {
      selfDraw,
      seatWind: p + 1, // 門風：0東 1南 2西 3北
      roundWind: this.roundWind.rank,
      fromKong: selfDraw && this.kongReplacement,
      lastWall: selfDraw && this.wall.length === 0,
    };
  }

  /** 點炮情境番種判定用 */
  private ronCtx(p: number, robKong = false): WinContext {
    return {
      selfDraw: false,
      seatWind: p + 1,
      roundWind: this.roundWind.rank,
      robKong,
    };
  }

  // 玩家出牌（花牌不能打出，因為摸到就補花了）
  // 返回 true 表示出牌成功；false 表示被忽略（狀態不對 / 牌不在手牌 / 花牌）。
  // 呼叫方必須檢查回傳值——若為 false 且遊戲仍在等待該玩家出牌，需重新觸發，否則遊戲會卡死。
  discard(p: number, tile: TileDef): boolean {
    if (p !== this.current || this.phase !== 'turn') return false;
    if (p === 0 && this.awaitingDraw) return false; // 玩家0 尚未摸牌，不能出牌
    if (isFlower(tile)) return false; // 花牌不可打出
    const idx = this.players[p].hand.findIndex((t) => tilesEqual(t, tile));
    if (idx === -1) return false;
    this.players[p].hand.splice(idx, 1);
    // 打出一張後重新排序，讓剩餘手牌緊湊排列
    this.players[p].hand = sortTiles(this.players[p].hand);
    this.players[p].discards.push(tile);
    this.kongReplacement = false; // 出牌後槓上標記失效
    this.emit({ type: 'discard', player: p, tile });

    // 檢查其他玩家能否吃/碰/槓/胡
    const options = this.buildClaimOptions(p, tile);
    if (options && options.choices.length > 0) {
      this.phase = 'claiming';
      this.pendingClaim = options;
      this.onPrompt?.(options);
      return true;
    }
    this.nextTurn();
    return true;
  }

  buildClaimOptions(from: number, tile: TileDef): ClaimOptions | null {
    const choices: ClaimChoice[] = [];
    // 胡（任何玩家）
    for (let p = 1; p < 4; p++) {
      const pl = (from + p) % 4;
      if (isWinningHand([...this.players[pl].hand, tile], this.players[pl].melds)) {
        choices.push({ player: pl, kind: 'win', tile });
      }
    }
    // 碰 / 槓（任何玩家，除出牌者）
    // 握有 3 張時「槓」與「碰」都是合法選擇（碰用 2 張、留 1 張），必須同時提供，
    // 否則用 else-if 會讓玩家在能吃/能槓/能碰時看不到碰的按鈕。
    for (let p = 1; p < 4; p++) {
      const pl = (from + p) % 4;
      const cnt = this.players[pl].hand.filter((t) => tilesEqual(t, tile)).length;
      if (cnt >= 3) choices.push({ player: pl, kind: 'kong', tile });
      if (cnt >= 2) choices.push({ player: pl, kind: 'pong', tile });
    }
    // 吃（僅下家）
    const next = (from + 1) % 4;
    const chiOpts = this.getChiOptions(this.players[next].hand, tile);
    for (const co of chiOpts) {
      choices.push({ player: next, kind: 'chi', tile, chiTiles: co });
    }
    // 過
    choices.push({ player: -1, kind: 'pass' });
    return { from, tile, choices };
  }

  getChiOptions(hand: TileDef[], tile: TileDef): TileDef[][] {
    const results: TileDef[][] = [];
    if (tile.suit === 'z') return results;
    const find = (suit: string, rank: number) =>
      hand.find((t) => t.suit === suit && t.rank === rank);
    const r = tile.rank;
    const s = tile.suit;
    // r-2, r-1
    const a = find(s, r - 2), b = find(s, r - 1);
    if (a && b) results.push([a, b]);
    // r-1, r+1
    const c = find(s, r - 1), d = find(s, r + 1);
    if (c && d) results.push([c, d]);
    // r+1, r+2
    const e = find(s, r + 1), f = find(s, r + 2);
    if (e && f) results.push([e, f]);
    return results;
  }

  // 處理 Claim 選擇
  resolveClaim(choice: ClaimChoice) {
    // 只允許在 claiming 階段解決一次，防止重複呼叫（UI + 看門狗雙重觸發）
    if (this.phase !== 'claiming' || !this.pendingClaim) return;
    const opts = this.pendingClaim;
    const from = opts?.from;
    const tile = opts?.tile;
    const isRob = opts?.rob === true;
    this.pendingClaim = null;

    // ===== 搶槓胡情境：tile 不是棄牌，過牌則加槓成立 =====
    if (isRob) {
      const rp = this.robPending;
      this.robPending = null;
      if (!rp) return;
      if (choice.kind === 'pass') {
        const meld = this.players[rp.p].melds.find(
          (m) => m.type === 'pong' && m.tiles.some((t) => tilesEqual(t, rp.tile))
        );
        if (meld) this.commitAddedKong(rp.p, rp.tile, meld);
        return;
      }
      const p = choice.player;
      const pl = this.players[p];
      pl.hand.push(tile!);
      const fans = calcFans(pl.hand, pl.melds, this.ronCtx(p, true));
      this.current = p;
      this.phase = 'game_over';
      this.recordResult(p);
      this.emit({ type: 'win', player: p, tile: tile!, fans, from: rp.p, settle: this.settle(p, fans, false, rp.p) });
      return;
    }

    if (choice.kind === 'pass') {
      this.nextTurn();
      return;
    }
    const p = choice.player;
    const pl = this.players[p];
    // 從出牌者 discard 中移除
    const fi = this.players[from!].discards.length - 1;
    this.players[from!].discards.splice(fi, 1);

    if (choice.kind === 'win') {
      pl.hand.push(tile!);
      const fans = calcFans(pl.hand, pl.melds, this.ronCtx(p));
      this.current = p; // 確保當前玩家設為胡牌者
      this.phase = 'game_over';
      this.recordResult(p);
      this.emit({ type: 'win', player: p, tile: tile!, fans, from, settle: this.settle(p, fans, false, from!) });
      return;
    }
    if (choice.kind === 'pong') {
      const removed = this.removeN(pl.hand, tile!, 2);
      pl.melds.push({ type: 'pong', tiles: [tile!, ...removed], from: from! });
      pl.hand = sortTiles(pl.hand);
      this.current = p;
      this.phase = 'turn';
      this.emit({ type: 'pong', player: p, tile: tile!, from });
      // 碰後由該玩家出牌
      this.emit({ type: 'turn', player: p });
      return;
    }
    if (choice.kind === 'kong') {
      const removed = this.removeN(pl.hand, tile!, 3);
      pl.melds.push({ type: 'kong', tiles: [tile!, ...removed], from: from! });
      pl.hand = sortTiles(pl.hand);
      this.current = p;
      this.emit({ type: 'kong', player: p, tile: tile!, from, kongKind: 'ming' });
      // 槓後嶺上補摸
      this.kongReplacement = true;
      const drawn = this.drawTile(p, true);
      // 注意：drawTile 可能直接自摸結束（槓上開花），此時絕不可把 phase 改回 turn
      if (drawn && !this.isGameOver) {
        this.phase = 'turn';
        this.emit({ type: 'turn', player: p });
      }
      return;
    }
    if (choice.kind === 'chi') {
      const chiTiles = choice.chiTiles!;
      for (const t of chiTiles) {
        const i = pl.hand.findIndex((h) => tilesEqual(h, t));
        pl.hand.splice(i, 1);
      }
      const merged = sortTiles([tile!, ...chiTiles]);
      pl.melds.push({ type: 'chi', tiles: merged, from: from! });
      pl.hand = sortTiles(pl.hand);
      this.current = p;
      this.phase = 'turn';
      this.emit({ type: 'chi', player: p, tile: tile!, from, tiles: merged });
      this.emit({ type: 'turn', player: p });
      return;
    }
  }

  private removeN(hand: TileDef[], tile: TileDef, n: number): TileDef[] {
    const out: TileDef[] = [];
    for (let i = 0; i < n; i++) {
      const idx = hand.findIndex((t) => tilesEqual(t, tile));
      if (idx === -1) break;
      out.push(hand.splice(idx, 1)[0]);
    }
    return out;
  }

  nextTurn() {
    // 遊戲已結束（胡牌/流局）時不再推進，防止遺留定時任務把 game_over 拉回 turn
    // 'dealing' 同理：發牌動畫期間不允許任何遺留任務推進回合
    if (this.phase === 'game_over' || this.phase === 'idle' || this.phase === 'dealing') return;
    this.current = (this.current + 1) % 4;
    this.phase = 'turn';
    // 玩家0 手動摸牌：不自動摸，等待點擊空白處觸發 manualDraw
    if (this.current === 0) {
      this.awaitingDraw = true;
      this.emit({ type: 'turn', player: this.current });
      return;
    }
    const t = this.drawTile(this.current);
    if (t) this.emit({ type: 'turn', player: this.current });
  }

  // 玩家自摸胡
  winBySelf(p: number) {
    if (p !== this.current) return;
    const last = this.players[p].hand[this.players[p].hand.length - 1];
    const fans = calcFans(this.players[p].hand, this.players[p].melds, this.winCtx(p, true));
    this.phase = 'game_over';
    this.recordResult(p);
    this.emit({ type: 'win', player: p, tile: last, fans, settle: this.settle(p, fans, true, null) });
  }

  // 暗槓（手牌 4 張，牌面朝下）
  concealedKong(p: number, tile: TileDef): boolean {
    if (p !== this.current || this.phase !== 'turn') return false;
    if (p === 0 && this.awaitingDraw) return false; // 玩家0 尚未摸牌
    const pl = this.players[p];
    const cnt = pl.hand.filter((t) => tilesEqual(t, tile)).length;
    if (cnt < 4) return false;
    const removed: TileDef[] = [];
    for (let i = 0; i < 4; i++) {
      const idx = pl.hand.findIndex((t) => tilesEqual(t, tile));
      removed.push(pl.hand.splice(idx, 1)[0]);
    }
    pl.hand = sortTiles(pl.hand); // 重排，讓 UI 按鈕與 3D 手牌同步
    pl.melds.push({ type: 'kong', tiles: removed, from: p, concealed: true });
    this.emit({ type: 'kong', player: p, tile, from: p, kongKind: 'angang' });
    // 槓後嶺上補摸
    this.kongReplacement = true;
    const drawn = this.drawTile(p, true);
    // drawTile 可能直接自摸結束（槓上開花），此時絕不可把 phase 改回 turn
    if (drawn && !this.isGameOver) {
      this.phase = 'turn';
      this.emit({ type: 'turn', player: p });
    }
    return true;
  }

  /** 可加槓（補槓）的牌：自家已有「碰」副露，且手上握有第 4 張同牌 */
  getAddedKongOptions(p: number): TileDef[] {
    if (p !== this.current || this.phase !== 'turn') return [];
    if (p === 0 && this.awaitingDraw) return [];
    const pl = this.players[p];
    const out: TileDef[] = [];
    for (const m of pl.melds) {
      if (m.type !== 'pong') continue;
      const t = m.tiles[0];
      if (pl.hand.some((h) => tilesEqual(h, t))) out.push(t);
    }
    return out;
  }

  /** 加槓（補槓）：把第 4 張補到自家碰子上成槓。
   *  港式規則：加槓的瞬間其他玩家可用該牌「搶槓胡」；
   *  有人可搶時進入 claiming 階段，過牌後槓才成立並嶺上補摸。 */
  addedKong(p: number, tile: TileDef): boolean {
    if (p !== this.current || this.phase !== 'turn') return false;
    if (p === 0 && this.awaitingDraw) return false;
    const pl = this.players[p];
    const meld = pl.melds.find(
      (m) => m.type === 'pong' && m.tiles.some((t) => tilesEqual(t, tile))
    );
    if (!meld) return false;
    const idx = pl.hand.findIndex((t) => tilesEqual(t, tile));
    if (idx === -1) return false;

    // 先把槓出的牌移出（視為「正在打出」，搶槓成立時它歸胡牌者）
    pl.hand.splice(idx, 1);
    pl.hand = sortTiles(pl.hand);

    const robChoices: ClaimChoice[] = [];
    for (let k = 1; k < 4; k++) {
      const q = (p + k) % 4;
      if (isWinningHand([...this.players[q].hand, tile], this.players[q].melds)) {
        robChoices.push({ player: q, kind: 'win', tile });
      }
    }
    if (robChoices.length > 0) {
      this.robPending = { p, tile };
      this.phase = 'claiming';
      const options: ClaimOptions = {
        from: p,
        tile,
        choices: [...robChoices, { player: -1, kind: 'pass' }],
        rob: true,
      };
      this.pendingClaim = options;
      this.onPrompt?.(options);
      return true;
    }
    this.commitAddedKong(p, tile, meld);
    return true;
  }

  /** 加槓正式成立：碰 → 槓，並嶺上補摸 */
  private commitAddedKong(p: number, tile: TileDef, meld: Meld) {
    meld.tiles.push(tile);
    meld.type = 'kong';
    this.emit({ type: 'kong', player: p, tile, from: p, kongKind: 'jigang' });
    this.kongReplacement = true;
    const drawn = this.drawTile(p, true);
    // drawTile 可能直接自摸結束（槓上開花），此時絕不可把 phase 改回 turn
    if (drawn && !this.isGameOver) {
      this.phase = 'turn';
      this.emit({ type: 'turn', player: p });
    }
  }

  // 檢查手牌中哪些牌可以暗槓
  getConcealedKongOptions(p: number): TileDef[] {
    if (p !== this.current || this.phase !== 'turn') return [];
    if (p === 0 && this.awaitingDraw) return []; // 玩家0 尚未摸牌
    const pl = this.players[p];
    const counts = countTiles(pl.hand);
    const opts: TileDef[] = [];
    for (const [k, c] of counts) {
      if (c >= 4) {
        const [suit, rankStr] = [k[0], k.slice(1)];
        opts.push(makeTile(suit as Suit, parseInt(rankStr, 10)));
      }
    }
    return opts;
  }
}

export interface ClaimChoice {
  player: number;
  kind: 'win' | 'pong' | 'kong' | 'chi' | 'pass';
  tile?: TileDef;
  chiTiles?: TileDef[];
}

export interface ClaimOptions {
  from: number;
  tile: TileDef;
  choices: ClaimChoice[];
  /** true = 搶槓胡情境（tile 非棄牌，pass 後槓成立） */
  rob?: boolean;
}

/** 港式 claim 優先級：胡 > 槓 > 碰 > 吃 > 過（數值越小越優先） */
export const CLAIM_RANK: Record<ClaimChoice['kind'], number> = {
  win: 0, kong: 1, pong: 2, chi: 3, pass: 4,
};

/** 全局 claim 裁決：先比優先級（胡>槓>碰>吃），同級按座位順序
 * （由出牌者下家起數，越近越優先 —— 港式「一炮多響」取先胡者）。
 * excludePlayer0=true 時排除玩家0（玩家0 已選擇「過」）。
 * 無可操作選項時返回 null。 */
export function pickBestClaim(options: ClaimOptions, excludePlayer0 = false): ClaimChoice | null {
  const seatOrder = (p: number) => (p - options.from + 4) % 4;
  let best: ClaimChoice | null = null;
  for (const c of options.choices) {
    if (c.kind === 'pass' || c.player < 0) continue;
    if (excludePlayer0 && c.player === 0) continue;
    if (!best) { best = c; continue; }
    const cr = CLAIM_RANK[c.kind];
    const br = CLAIM_RANK[best.kind];
    if (cr < br || (cr === br && seatOrder(c.player) < seatOrder(best.player))) best = c;
  }
  return best;
}
