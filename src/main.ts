// 主入口：整合 3D 渲染、遊戲邏輯、UI

import { BoardRenderer } from './three/board';
import { Game, GameEvent, ClaimOptions, ClaimChoice, pickBestClaim } from './game/game';
import { AIPlayer } from './game/ai';
import { GameUI } from './ui/ui';
import { tileName } from './game/tiles';
import { isWinningHand } from './game/hand';

const CLAIM_LABEL: Record<ClaimChoice['kind'], string> = {
  win: '胡牌', pong: '碰', kong: '槓', chi: '吃', pass: '過',
};

class App {
  private renderer: BoardRenderer;
  private ui: GameUI;
  private game: Game;
  private ais: AIPlayer[] = [];
  /** 最近一次「該某玩家出牌」的時間戳，供看門狗判斷是否卡死 */
  private lastTurnAt = 0;
  /** 最近一次「遊戲狀態變化」的時間戳（任何事件），供看門狗判斷整體是否停擺 */
  private lastActivityAt = 0;
  /** claim 階段開始的時間戳，供看門狗判斷 claim 是否卡死 */
  private claimingAt = 0;
  /** 目前 claim 是否需要玩家0 手動決策（true 時由 UI 倒計時負責超時，看門狗不介入） */
  private claimNeedsPlayer = false;
  /** 除錯日誌環形緩衝（卡死時打印最近 N 條，方便定位） */
  private dbgLog: string[] = [];

  /** 記錄除錯日誌（同時輸出 console，保留最近 40 條） */
  private dbg(msg: string) {
    const t = Math.round(performance.now());
    const line = `[${t}] ${msg}`;
    this.dbgLog.push(line);
    if (this.dbgLog.length > 40) this.dbgLog.shift();
    console.log('%c[麻雀]', 'color:#d4af37', line);
  }

  /** 卡死時打印最近的狀態流水 */
  private dbgDump(tag: string) {
    console.warn(`%c[麻雀][${tag}] 最近狀態流水：`, 'color:#e74c3c;font-weight:bold');
    this.dbgLog.forEach((l) => console.warn('  ' + l));
  }

  constructor(container: HTMLElement) {
    // 先綁定事件，避免 startGame 同步發射事件時回調未就緒
    this.game = new Game();
    this.game.onEvent = (e) => this.handleEvent(e);
    this.game.onPrompt = (opts) => this.handlePrompt(opts);

    this.renderer = new BoardRenderer(container);
    this.ui = new GameUI(container);

    // 參考圖牌面載入完成：重新渲染所有玩家的牌
    this.renderer.onRefLoaded = () => this.refreshAllTiles();

    // 胡牌結算面板：用真實牌面圖展示（任何玩家胡牌都適用）
    this.ui.tileFaceUrl = (t) => this.renderer.tileFaceDataUrl(t);

    this.ui.onRestart = () => {
      // 整場結束（有人積分 ≤ 0）後點「重新開場」→ 積分重置
      if (this.game.matchOver) this.game.resetMatch();
      this.startGame();
    };
    this.ui.onClaimSelected = (c) => {
      // 玩家0 選擇「過」：重新裁決剩餘玩家，避免別家本可成立的碰/槓/胡被玩家0 的過牌擋掉
      const pending = this.game.getPendingClaim();
      if (c.kind === 'pass' && pending) {
        const best = pickBestClaim(pending, true);
        if (best) {
          this.dbg(`玩家0 過牌 → 讓位給 ${this.playerName(best.player)} ${CLAIM_LABEL[best.kind]}`);
          this.game.resolveClaim(best);
          return;
        }
      }
      this.game.resolveClaim(c);
    };

    this.startGame();
    this.animate();
  }

  private startGame() {
    // 先根據上一局結果決定新一局莊家（連莊/過莊），再擲骰子決定開門方位
    this.game.nextDealer();
    const dice = this.game.rollDice();
    this.ais = [0, 1, 2, 3]
      .filter((i) => i !== 0)
      .map((i) => new AIPlayer(this.game, i));
    // 顯示完整牌牆 + 莊家標記 + 方位
    this.renderer.buildWall();
    this.renderer.setDealer(dice.dealer);
    for (let i = 0; i < 4; i++) {
      // 清掉上一局的全部桌面物件：手牌 / 弃牌 / 副露 / 花牌
      // （花牌原先漏清，上局的花牌會留在桌上，直到新局第一次摸到花牌才被覆蓋）
      this.renderer.renderHand(i, []);
      this.renderer.renderDiscards(i, []);
      this.renderer.renderMelds(i, []);
      this.renderer.renderFlowers(i, []);
    }
    this.ui.clearSeatHints(); // 上局的補花/吃碰槓提示不可殘留
    this.ui.setInfo('莊家擲骰子…');
    // 播放 3D 骰子滾動動畫，定格後顯示結果並發牌
    this.renderer.showDice(dice.dice, () => {
      const openNames = ['自家（東）', '下家（南）', '對家（西）', '上家（北）'];
      this.ui.setInfo(`擲骰 ${dice.dice.join('+')}=${dice.total}，${openNames[dice.startPlayer]}開門`);
      // 準備發牌（洗牌+分牌），播放發牌動畫（骰子留在桌面中央）
      setTimeout(() => {
        const hands = this.game.prepareDeal();
        // 設定牌牆配牌起點：開門方位 + 跳過 total 棟（順時針）
        this.renderer.setWallStart(dice.startPlayer, dice.total);
        this.renderer.startDeal(hands, this.game.getDealOrder(), () => {
          // 動畫完成：此時手牌是「補花前」的原始配牌（花牌仍在手牌中、花牌區為空），先顯示
          this.refreshAllTiles();
          this.ui.setPlayersInfo(this.game.wall.length, this.game.current, this.game.dealer, this.game.scores);
    this.ui.setScores(this.game.scores, this.game.wins, this.game.deals);
          this.ui.setInfo('配牌完成，開始補花…');
          // 停頓讓玩家看清補花前的手牌，再補花並顯示補花后的手牌與花牌區
          setTimeout(() => {
            const taken = this.game.resolveFlowers();
            for (let i = 0; i < taken; i++) this.renderer.takeWallGroup(1); // 補花取走的牌要同步 3D 牌牆
            this.refreshAllTiles();
            this.ui.setPlayersInfo(this.game.wall.length, this.game.current, this.game.dealer, this.game.scores);
    this.ui.setScores(this.game.scores, this.game.wins, this.game.deals);
            this.game.finishDeal();
          }, 1200);
        });
      }, 900);
    });
  }

  private handleEvent(e: GameEvent) {
    const p = e.player;
    this.lastActivityAt = performance.now();
    if (e.type === 'discard' || e.type === 'draw' || e.type === 'turn') {
      this.dbg(`event ${e.type} p=${p} phase=${this.game.phase} cur=${this.game.current}`);
    }
    // 摸牌事件：從牌牆前方取 1 張（同步 3D 牌牆）
    if (e.type === 'draw') {
      this.renderer.takeWallGroup(1);
    }
    // 刷新 3D
    for (let i = 0; i < 4; i++) {
      this.renderer.renderHand(i, this.game.players[i].hand);
      this.renderer.renderDiscards(i, this.game.players[i].discards, i === p && e.type === 'discard');
      this.renderer.renderMelds(i, this.game.players[i].melds);
      this.renderer.renderFlowers(i, this.game.players[i].flowers);
    }
    this.renderer.setDealer(this.game.dealer);
    this.ui.setPlayersInfo(this.game.wall.length, this.game.current, this.game.dealer, this.game.scores);
    this.ui.setScores(this.game.scores, this.game.wins, this.game.deals);

    switch (e.type) {
      case 'dice':
        break;
      case 'discard':
        // 打牌後先隱藏手牌按鈕，等到摸牌/下家出牌再顯示
        if (p === 0) this.ui.clearHandButtons();
        this.ui.setInfo(`${this.playerName(p)} 打出 ${tileName(e.tile!)}`);
        break;
      case 'flower':
        this.ui.setInfo(`${this.playerName(p)} 摸到花牌 ${tileName(e.tile!)}，補花`);
        this.ui.showSeatHint(p, `補花 ${tileName(e.tile!)}`, this.renderer.seatHintScreenPos(p));
        break;
      case 'pong':
        this.ui.setInfo(`${this.playerName(p)} 碰 ${tileName(e.tile!)}`);
        this.ui.showSeatHint(p, `碰 ${tileName(e.tile!)}`, this.renderer.seatHintScreenPos(p));
        break;
      case 'chi':
        this.ui.setInfo(`${this.playerName(p)} 吃 ${tileName(e.tile!)}`);
        this.ui.showSeatHint(p, `吃 ${tileName(e.tile!)}`, this.renderer.seatHintScreenPos(p));
        break;
      case 'kong': {
        // 槓的種類由事件直接攜帶（明槓=吃弃牌、暗槓=手牌四張朝下、加槓=碰升級）
        const label = e.kongKind === 'angang' ? '暗槓' : e.kongKind === 'jigang' ? '加槓' : '明槓';
        // 暗槓不顯示牌名（牌面朝下，不洩漏暗槓的牌）
        const hint = e.kongKind === 'angang' ? label : `${label} ${tileName(e.tile!)}`;
        this.ui.setInfo(`${this.playerName(p)} ${hint}`);
        this.ui.showSeatHint(p, hint, this.renderer.seatHintScreenPos(p));
        break;
      }
      case 'win': {
        const note = this.dealerNoteFor(p);
        this.ui.setInfo(`${this.playerName(p)} 胡牌！`);
        this.ui.showWin(
          e,
          this.game.players[p].hand,
          this.game.players[p].melds,
          note,
          { over: this.game.matchOver, scores: this.game.scores, reason: this.game.overReason }
        );
        break;
      }
      case 'exhaustive_draw':
        this.ui.showDrawMessage(this.dealerNoteForDraw(), this.game.scores, { over: this.game.matchOver, reason: this.game.overReason });
        break;
      case 'turn':
        this.handleTurn(p);
        break;
    }
  }

  private playerName(p: number) {
    return ['你', '右家', '對家', '左家'][p];
  }

  /** 胡牌時的過莊/連莊提示（基於 game.lastResult / lastWinner，下一局 startGame 時會被 nextDealer 清掉） */
  private dealerNoteFor(winner: number): string {
    if (this.game.matchOver) return '';
    const d = this.game.dealer;
    if (winner === d) return `莊家胡牌，<b style="color:#d4af37;">連莊</b>（下局仍由 ${this.playerName(d)} 做莊）`;
    const next = (d + 1) % 4;
    return `過莊：莊位逆時針移給下家，下局由 <b style="color:#d4af37;">${this.playerName(next)}</b> 做莊`;
  }

  /** 流局時的過莊提示：莊家移給下家 */
  private dealerNoteForDraw(): string {
    if (this.game.matchOver) return '';
    const d = this.game.dealer;
    const next = (d + 1) % 4;
    return `流局過莊：下局由 <b style="color:#d4af37;">${this.playerName(next)}</b> 做莊`;
  }

  private handleTurn(p: number) {
    if (this.game.phase !== 'turn') {
      this.dbg(`handleTurn(${p}) 忽略：phase=${this.game.phase}`);
      return;
    }
    // 用 real-time current 而非事件參數 p，避免 turn 事件與 current 脫節（例如 win 後遺留任務）
    const cur = this.game.current;
    if (cur !== p) {
      this.dbg(`handleTurn 事件 p=${p} 與 current=${cur} 不一致，以 current 為準`);
      // 若 real-time current 是 AI 但事件卻指向別家（狀態脫節），立即驅動 current 這個 AI，
      // 避免它要等 700ms 後才因 current 不匹配被忽略而永久卡死
      if (cur !== 0) {
        this.ui.setInfo(`${this.playerName(cur)} 思考中...`);
        setTimeout(() => this.runAITurn(cur, 3), 50);
        return;
      }
    }
    this.lastTurnAt = performance.now();
    this.lastActivityAt = performance.now();

    if (cur === 0) {
      // 玩家操作
      this.ui.clearButtons();
      if (this.game.isAwaitingDraw) {
        // 摸牌階段：點擊空白處（或任意處）摸牌，並在手牌右側顯示「摸牌」提示
        this.renderer.onTileClick = () => this.game.manualDraw(0);
        this.renderer.onBlankClick = () => this.game.manualDraw(0);
        // 提示放在手牌最右側那張牌的右邊（用 3D 投影座標定位）
        this.ui.showDrawHint(true, this.renderer.getHand0RightScreen());
        this.ui.setInfo('點擊空白處摸牌');
      } else {
        this.ui.showDrawHint(false);
        // 出牌階段：點擊手牌直接打出
        this.renderer.onTileClick = (_index, tile) => {
          this.ui.clearButtons();
          this.game.discard(0, tile);
        };
        this.renderer.onBlankClick = null;
        const hand = this.game.players[0].hand;
        // 自摸胡？
        if (isWinningHand(hand, this.game.players[0].melds)) {
          this.ui.addButton('自摸胡！', () => {
            this.game.winBySelf(0);
          }, '#c0392b');
        }
        // 暗槓？（手牌 4 張同牌）
        const kongOpts = this.game.getConcealedKongOptions(0);
        for (const t of kongOpts) {
          this.ui.addButton(`暗槓 ${tileName(t)}`, () => {
            this.ui.clearButtons();
            this.game.concealedKong(0, t);
          }, '#8e44ad');
        }
        // 加槓？（已有碰子 + 手上第 4 張，可能被別家搶槓胡）
        const addedOpts = this.game.getAddedKongOptions(0);
        for (const t of addedOpts) {
          this.ui.addButton(`加槓 ${tileName(t)}`, () => {
            this.ui.clearButtons();
            this.game.addedKong(0, t);
          }, '#7d3c98');
        }
        this.ui.setInfo('點擊手牌出牌');
      }
    } else {
      // AI 操作：取消玩家點擊，加延遲（一律用 real-time current 驅動）
      this.renderer.onTileClick = null;
      this.renderer.onBlankClick = null;
      this.ui.showDrawHint(false);
      this.ui.setInfo(`${this.playerName(cur)} 思考中...`);
      this.dbg(`handleTurn AI cur=${cur} → 700ms 後 runAITurn`);
      setTimeout(() => this.runAITurn(cur), 700);
    }
  }

  /** AI 出牌（自癒式）：若出牌被忽略但遊戲仍在等待該 AI，自動重試，
   *  並用看門狗防止任何異常路徑把遊戲永久卡死。 */
  private runAITurn(p: number, attempt = 0) {
    // 狀態已改變（重開 / 流局 / 被 claim）→ 不再行動
    if (this.game.phase !== 'turn' || this.game.current !== p) {
      this.dbg(`runAITurn(${p}) 忽略：phase=${this.game.phase} cur=${this.game.current} attempt=${attempt}`);
      return;
    }
    const ai = this.ais[p - 1];
    if (!ai) {
      // 安全網：AI 未初始化時直接過一輪，絕不停擺
      this.dbg(`runAITurn(${p}) AI 未初始化 → nextTurn`);
      this.game.nextTurn();
      return;
    }
    try {
      // 加槓優先（有碰子 + 握第 4 張）：可能觸發別家搶槓胡 claim
      const added = ai.chooseAddedKong();
      if (added && this.game.addedKong(p, added)) {
        this.dbg(`runAITurn(${p}) 加槓 ${tileName(added)}`);
        return;
      }
      const tile = ai.chooseDiscard();
      const ok = this.game.discard(p, tile);
      this.dbg(`runAITurn(${p}) discard ${tileName(tile)} ok=${ok} attempt=${attempt}`);
      if (!ok && this.game.phase === 'turn' && this.game.current === p) {
        // 出牌被忽略但仍輪到該 AI：重試（chooseDiscard 已保證返回有效牌，
        // 正常不會進來；這是防範狀態不同步的最後一道保險）
        if (attempt < 3) {
          this.dbg(`runAITurn(${p}) 出牌被忽略，200ms 後重試 #${attempt + 1}`);
          setTimeout(() => this.runAITurn(p, attempt + 1), 200);
        } else {
          this.dbg(`runAITurn(${p}) 連續失敗 → 強制 nextTurn`);
          this.game.nextTurn();
        }
      }
    } catch (err) {
      this.dbg(`runAITurn(${p}) 異常 → 強制 nextTurn: ${String(err)}`);
      this.game.nextTurn();
    }
  }

  /** 看門狗：若遊戲卡在「該某 AI 出牌」狀態超過 3 秒（例如 setTimeout 被吞、
   *  分頁休眠、例外逃逸），強制重新驅動該回合，保證遊戲永不卡死。 */
  private watchdogTick() {
    const g = this.game;
    // 1) AI 出牌卡死：該 AI 出牌但超過 3 秒未推進
    if (g.phase === 'turn' && g.current !== 0 && g.current !== undefined) {
      const stalled = performance.now() - this.lastTurnAt > 3000;
      if (stalled) {
        this.lastTurnAt = performance.now(); // 避免連續觸發
        this.dbgDump(`看門狗：AI ${g.current} 回合超時 3s`);
        console.warn(`看門狗：AI ${g.current} 回合超時，強制驅動`);
        this.runAITurn(g.current, 3);
      }
    }
    // 2) claim 卡死：僅在「純 AI 自動處理」的 claim 上生效（setTimeout 被吞 / AI 回應異常）。
    //    玩家0 需手動決策的 claim 由 UI 的 10 秒倒計時負責超時，看門狗不得搶先過牌。
    if (g.phase === 'claiming' && this.claimingAt > 0 && !this.claimNeedsPlayer) {
      if (performance.now() - this.claimingAt > 3000) {
        this.claimingAt = performance.now(); // 避免連續觸發
        this.dbgDump('看門狗：claim 超時 3s，強制過牌');
        console.warn('看門狗：claim 超時，強制 resolveClaim(pass)');
        // 強制以 pass 結束 claim，避免永久卡死
        const pass = g.getPendingClaimPass();
        if (pass) g.resolveClaim(pass);
      }
    }
    // 3) 整體停擺檢測：任何非 game_over 狀態 8 秒無事件 → 打印流水（僅診斷，不強行重置）
    //    'dealing' 期間本來就沒有事件（擲骰 + 發牌動畫 + 補花停頓），不計入停擺
    if (g.phase !== 'idle' && g.phase !== 'game_over' && g.phase !== 'dealing') {
      if (performance.now() - this.lastActivityAt > 8000) {
        this.lastActivityAt = performance.now(); // 避免每帧重打
        this.dbgDump(`停擺診斷：phase=${g.phase} cur=${g.current} wall=${g.wall.length}`);
      }
    }
  }

  private handlePrompt(opts: ClaimOptions) {
    // claim 階段：玩家0 不能摸牌/出牌，先停用 3D 點擊（改由 claim 按鈕操作）
    this.renderer.onTileClick = null;
    this.renderer.onBlankClick = null;
    this.ui.showDrawHint(false);
    this.claimingAt = performance.now();
    this.lastActivityAt = performance.now();
    this.dbg(`handlePrompt from=${opts.from} tile=${tileName(opts.tile)} rob=${opts.rob ? 1 : 0} choices=[${opts.choices.map((c) => `${c.player}:${c.kind}`).join(', ')}]`);

    // 全局優先級裁決：胡 > 槓 > 碰 > 吃，同級按座位順序（出牌者下家起數）
    const best = pickBestClaim(opts);
    if (!best) {
      this.dbg('claim：無可操作選項 → pass');
      this.game.resolveClaim(opts.choices.find((c) => c.kind === 'pass')!);
      return;
    }

    if (best.player === 0) {
      // 玩家0 的 claim 已是全局最高優先級 → 交由玩家決策（含「過」，過牌後讓位給別家）
      this.claimNeedsPlayer = true;
      this.ui.showClaimOptions(opts, true);
      return;
    }

    // 最高優先級屬於 AI：玩家0 的低優先級選項（如可碰但別家可胡）依規則被壓制
    const suppressed = opts.choices.some((c) => c.player === 0 && c.kind !== 'pass');
    this.claimNeedsPlayer = false;
    this.ui.showClaimOptions(opts, false);
    if (suppressed) {
      this.ui.setInfo(
        `${this.playerName(best.player)} ${CLAIM_LABEL[best.kind]}，優先級高於您的選項，自動由 ${this.playerName(best.player)} 執行`
      );
    }
    setTimeout(() => {
      if (this.game.phase !== 'claiming') {
        this.dbg('claim 自動處理：phase 已變，跳過');
        return;
      }
      this.dbg(`claim 自動處理：${this.playerName(best.player)} ${CLAIM_LABEL[best.kind]}`);
      this.game.resolveClaim(best);
    }, 600);
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    this.renderer.render();
    this.watchdogTick();
  };

  /** 參考圖牌面載入完成後，重新渲染所有玩家的牌 */
  private refreshAllTiles() {
    for (let i = 0; i < 4; i++) {
      this.renderer.renderHand(i, this.game.players[i].hand);
      this.renderer.renderDiscards(i, this.game.players[i].discards);
      this.renderer.renderMelds(i, this.game.players[i].melds);
      this.renderer.renderFlowers(i, this.game.players[i].flowers);
    }
  }
}

const container = document.getElementById('app')!;
container.style.cssText = 'position:relative;width:100vw;height:100vh;margin:0;overflow:hidden;';
try {
  new App(container);
} catch (err) {
  console.error('App init failed:', err);
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#c0392b;color:#fff;padding:16px 24px;border-radius:8px;font-family:monospace;font-size:13px;max-width:80vw;white-space:pre-wrap;z-index:9999;';
  errDiv.textContent = `初始化錯誤：\n${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`;
  document.body.appendChild(errDiv);
}
