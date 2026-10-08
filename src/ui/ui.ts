// UI 層：操作按鈕、提示、繁體中文界面

import { TileDef, tileName } from '../game/tiles';
import { ClaimOptions, ClaimChoice, GameEvent, FanResult } from '../game/game';

const PLAYER_NAMES = ['你', '右家', '對家', '左家'];

export interface BubbleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 把新氣泡從與已顯示氣泡的重疊中移開：從原位按半徑逐圈試 8 個方向，
 *  取第一個「不重疊且在畫面內」的位置；實在找不到就取重疊面積最小的位置。
 *  氣泡座標為中心點。others 為其他家目前可見的氣泡。 */
export function separateBubble(
  r: BubbleRect,
  others: BubbleRect[],
  vw: number,
  vh: number,
  gap = 8
): { x: number; y: number } {
  const clampX = (x: number) => Math.min(Math.max(x, r.w / 2 + 4), vw - r.w / 2 - 4);
  const clampY = (y: number) => Math.min(Math.max(y, r.h / 2 + 4), vh - r.h / 2 - 4);
  const inBounds = (x: number, y: number) =>
    x - r.w / 2 >= 0 && x + r.w / 2 <= vw && y - r.h / 2 >= 0 && y + r.h / 2 <= vh;
  const clear = (x: number, y: number) =>
    inBounds(x, y) &&
    others.every(
      (o) =>
        Math.abs(x - o.x) >= (r.w + o.w) / 2 + 2 || Math.abs(y - o.y) >= (r.h + o.h) / 2 + 2
    );
  if (clear(r.x, r.y)) return { x: r.x, y: r.y };
  const DIRS: [number, number][] = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  for (let ring = 1; ring <= 14; ring++) {
    const rad = ring * gap;
    for (const [dx, dy] of DIRS) {
      const x = r.x + dx * rad;
      const y = r.y + dy * rad;
      if (clear(x, y)) return { x, y };
    }
  }
  // 無完全無重疊的位置：取重疊面積最小者
  let bestX = clampX(r.x);
  let bestY = clampY(r.y);
  let bestArea = Infinity;
  for (let ring = 0; ring <= 14; ring++) {
    const rad = ring * gap;
    for (const [dx, dy] of DIRS) {
      const x = clampX(r.x + dx * rad);
      const y = clampY(r.y + dy * rad);
      let area = 0;
      for (const o of others) {
        const ox = Math.min(x + r.w / 2, o.x + o.w / 2) - Math.max(x - r.w / 2, o.x - o.w / 2);
        const oy = Math.min(y + r.h / 2, o.y + o.h / 2) - Math.max(y - r.h / 2, o.y - o.h / 2);
        if (ox > 0 && oy > 0) area += ox * oy;
      }
      if (area < bestArea) {
        bestArea = area;
        bestX = x;
        bestY = y;
      }
    }
  }
  return { x: bestX, y: bestY };
}

export class GameUI {
  private root: HTMLElement;
  private btnArea: HTMLDivElement;
  private infoBar: HTMLDivElement;
  private winPanel: HTMLDivElement;
  private handRow: HTMLDivElement;
  private drawHint: HTMLDivElement;
  private countdownEl: HTMLDivElement;
  private countdownTimer: number | null = null;
  private countdownOnExpire: (() => void) | null = null;
  /** 各家範圍的即時提示（補花/吃/碰/槓），顯示 2 秒後自動消失 */
  private seatHints: HTMLDivElement[] = [];
  private seatHintTimers: (number | null)[] = [null, null, null, null];
  /** 各家目前可見氣泡的矩形（中心+尺寸），供新氣泡避讓重疊 */
  private seatHintRects: (BubbleRect | null)[] = [null, null, null, null];

  constructor(root: HTMLElement) {
    this.root = root;
    // 建立 UI 層（append 到 root，不清除 canvas）
    const uiRoot = document.createElement('div');
    uiRoot.id = 'ui-root';
    uiRoot.style.cssText = 'position:absolute;inset:0;pointer-events:none;font-family:"Noto Sans TC",sans-serif;z-index:10;';
    uiRoot.innerHTML = `
      <div id="info-bar" style="position:absolute;bottom:170px;left:50%;transform:translateX(-50%);
           background:rgba(0,0,0,0.55);color:#f5e9c8;padding:6px 18px;border-radius:20px;
           font-size:14px;pointer-events:none;"></div>
      <div id="hand-row" style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);
           display:flex;gap:4px;align-items:flex-end;pointer-events:auto;"></div>
      <div id="btn-area" style="position:absolute;bottom:100px;left:50%;transform:translateX(-50%);
           display:flex;gap:10px;pointer-events:auto;"></div>
      <div id="win-panel" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
           background:rgba(10,30,20,0.92);color:#f5e9c8;padding:28px 40px;border-radius:16px;
           text-align:center;border:2px solid #d4af37;pointer-events:auto;"></div>
      <div id="players-label" style="position:absolute;top:12px;left:16px;color:#7fb89a;font-size:12px;pointer-events:none;"></div>
      <div id="scoreboard" style="position:absolute;top:12px;right:16px;pointer-events:none;
           background:rgba(10,30,20,0.72);border:1px solid #d4af37;border-radius:12px;
           padding:10px 16px;color:#f5e9c8;min-width:236px;">
        <div style="font-size:15px;color:#d4af37;font-weight:bold;margin-bottom:6px;letter-spacing:2px;">記 分 板</div>
        <div id="scoreboard-body"></div>
      </div>
       <div id="draw-hint" style="display:none;position:absolute;bottom:44px;left:calc(50% + 170px);
            background:rgba(212,175,55,0.92);color:#1a1a1a;padding:8px 18px;
            border-radius:12px;font-size:16px;font-weight:bold;pointer-events:none;
            box-shadow:0 2px 8px rgba(0,0,0,0.4);animation:drawPulse 1.2s ease-in-out infinite;" >摸牌</div>
        <div id="claim-countdown" style="display:none;position:absolute;bottom:132px;left:50%;transform:translateX(-50%);background:rgba(192,57,43,0.92);color:#fff;padding:5px 18px;border-radius:16px;font-size:14px;font-weight:bold;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>
       <div id="seat-hint-0" class="seat-bubble seat-bubble-0" style="display:none;"></div>
       <div id="seat-hint-1" class="seat-bubble seat-bubble-1" style="display:none;"></div>
       <div id="seat-hint-2" class="seat-bubble seat-bubble-2" style="display:none;"></div>
       <div id="seat-hint-3" class="seat-bubble seat-bubble-3" style="display:none;"></div>
       <style>@keyframes drawPulse{0%,100%{transform:scale(1);opacity:.95}
            50%{transform:scale(1.08);opacity:1}}
       .seat-bubble{position:absolute;background:rgba(212,175,55,0.95);color:#1a1a1a;
            padding:8px 20px;border-radius:14px;font-size:22px;font-weight:bold;white-space:nowrap;
            pointer-events:none;box-shadow:0 3px 10px rgba(0,0,0,0.45);transform:translate(-50%,-50%);}
       .seat-bubble::after{content:'';position:absolute;width:0;height:0;}
       .seat-bubble-0::after{left:50%;bottom:-11px;transform:translateX(-50%);
            border-left:11px solid transparent;border-right:11px solid transparent;border-top:12px solid rgba(212,175,55,0.95);}
       .seat-bubble-1::after{top:50%;right:-11px;transform:translateY(-50%);
            border-top:11px solid transparent;border-bottom:11px solid transparent;border-left:12px solid rgba(212,175,55,0.95);}
       .seat-bubble-2::after{left:50%;top:-11px;transform:translateX(-50%);
            border-left:11px solid transparent;border-right:11px solid transparent;border-bottom:12px solid rgba(212,175,55,0.95);}
       .seat-bubble-3::after{top:50%;left:-11px;transform:translateY(-50%);
            border-top:11px solid transparent;border-bottom:11px solid transparent;border-right:12px solid rgba(212,175,55,0.95);}}</style>`;
    root.appendChild(uiRoot);
    this.infoBar = uiRoot.querySelector('#info-bar')!;
    this.btnArea = uiRoot.querySelector('#btn-area')!;
    this.winPanel = uiRoot.querySelector('#win-panel')!;
    this.handRow = uiRoot.querySelector('#hand-row')!;
    this.drawHint = uiRoot.querySelector('#draw-hint')!;
    this.countdownEl = uiRoot.querySelector('#claim-countdown')!;
    for (let p = 0; p < 4; p++) {
      this.seatHints.push(uiRoot.querySelector(`#seat-hint-${p}`)!);
    }
  }

  /** 在該家螢幕範圍顯示一條即時提示，ms 毫秒後自動消失（預設 3 秒）。
   *  同一家連續觸發（例如補多張花）會重置計時器。 */
  showSeatHint(player: number, text: string, pos?: { x: number; y: number }, ms = 3000) {
    const el = this.seatHints[player];
    if (!el) return;
    el.textContent = text;
    el.className = `seat-bubble seat-bubble-${player}`;
    if (pos) {
      el.style.bottom = 'auto';
      el.style.right = 'auto';
      el.style.left = `${Math.round(pos.x)}px`;
      el.style.top = `${Math.round(pos.y)}px`;
    } else {
      // 無投影座標時的兜底位置（螢幕四邊）
      el.style.left = player === 1 ? 'auto' : player === 3 ? '12px' : '50%';
      el.style.top = player === 2 ? '12px' : player === 0 ? 'auto' : '50%';
      el.style.bottom = player === 0 ? '16px' : 'auto';
      el.style.right = player === 1 ? '12px' : 'auto';
    }
    el.style.display = 'block';
    if (pos) {
      // 量出自身尺寸，若與別家可見氣泡重疊則沿最小穿透軸推開
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const others: BubbleRect[] = [];
      for (let i = 0; i < 4; i++) {
        const q = i;
        const rect = this.seatHintRects[q];
        if (q !== player && rect) others.push(rect);
      }
      const placed = separateBubble(
        { x: pos.x, y: pos.y, w, h },
        others,
        window.innerWidth,
        window.innerHeight
      );
      el.style.left = `${Math.round(placed.x)}px`;
      el.style.top = `${Math.round(placed.y)}px`;
      this.seatHintRects[player] = { x: placed.x, y: placed.y, w, h };
    } else {
      this.seatHintRects[player] = null;
    }
    if (this.seatHintTimers[player] !== null) clearTimeout(this.seatHintTimers[player]);
    this.seatHintTimers[player] = window.setTimeout(() => {
      el.style.display = 'none';
      this.seatHintTimers[player] = null;
      this.seatHintRects[player] = null;
    }, ms);
  }

  /** 隱藏全部各家提示並清除計時器（開新局時調用，避免上局提示殘留） */
  clearSeatHints() {
    for (let i = 0; i < 4; i++) {
      const p = i;
      const timer = this.seatHintTimers[p];
      if (timer !== null) {
        clearTimeout(timer);
        this.seatHintTimers[p] = null;
      }
      if (this.seatHints[p]) this.seatHints[p].style.display = 'none';
      this.seatHintRects[p] = null;
    }
  }

  /** 啟動 claim 倒計時（秒），歸零時回調 onExpire（自動過牌）。
   *  顯示紅底「剩餘 Xs」標籤，每秒更新。 */
  startClaimCountdown(seconds: number, onExpire: () => void) {
    this.stopClaimCountdown();
    this.countdownOnExpire = onExpire;
    let remaining = seconds;
    this.countdownEl.textContent = `剩餘 ${remaining}s，超時自動過牌`;
    this.countdownEl.style.display = 'block';
    this.countdownTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.stopClaimCountdown();
        const cb = this.countdownOnExpire;
        this.countdownOnExpire = null;
        cb?.();
      } else {
        this.countdownEl.textContent = `剩餘 ${remaining}s，超時自動過牌`;
        // 最後 3 秒變深紅提醒
        if (remaining <= 3) this.countdownEl.style.background = 'rgba(140,20,20,0.95)';
      }
    }, 1000);
  }

  /** 停止 claim 倒計時並隱藏標籤（玩家已操作 / claim 被解決時調用） */
  stopClaimCountdown() {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownEl.style.display = 'none';
    this.countdownEl.style.background = 'rgba(192,57,43,0.92)';
  }

  /** 顯示/隱藏「摸牌」提示（等待玩家0 手動摸牌時顯示）
   *  pos: 手牌最右側的螢幕座標（相對 canvas 像素），提示放在其右側；null 時用預設位置 */
  showDrawHint(show: boolean, pos?: { x: number; y: number } | null) {
    this.drawHint.style.display = show ? 'block' : 'none';
    if (show && pos) {
      // 左緣貼在牌右側，垂直居中於牌頂端
      this.drawHint.style.left = `${pos.x + 10}px`;
      this.drawHint.style.top = `${pos.y - 18}px`;
      this.drawHint.style.bottom = 'auto';
    } else if (show) {
      // 無座標時退回預設位置（手牌右側偏上）
      this.drawHint.style.left = 'calc(50% + 170px)';
      this.drawHint.style.top = 'auto';
      this.drawHint.style.bottom = '44px';
    }
  }

  setInfo(text: string) {
    this.infoBar.textContent = text;
  }

  setPlayersInfo(wallCount: number, current: number, dealer: number, scores?: number[]) {
    const el = this.root.querySelector('#players-label')!;
    const winds = ['東', '南', '西', '北'];
    el.innerHTML = `牌牆剩 ${wallCount}<br>當前：${PLAYER_NAMES[current]}<br>莊家：${winds[dealer]}家${dealer === 0 ? '（你）' : ''}｜${winds[dealer]}圈`;
    void scores;
  }

  /** 記分板：按積分由高到低排列，附胡牌數 / 放炮數 */
  setScores(scores: number[], wins: number[], deals: number[]) {
    const el = this.root.querySelector('#scoreboard-body');
    if (!el) return;
    const order = scores
      .map((s, i) => ({ s, i }))
      .sort((a, b) => b.s - a.s || a.i - b.i);
    let html = '';
    order.forEach((o, r) => {
      const scoreColor = o.s <= 0 ? '#e74c3c' : r === 0 ? '#d4af37' : '#f5e9c8';
      html += `<div style="display:flex;align-items:baseline;gap:10px;margin:3px 0;">` +
        `<span style="font-size:14px;color:#7fb89a;width:16px;">${r + 1}</span>` +
        `<span style="font-size:18px;width:48px;">${PLAYER_NAMES[o.i]}</span>` +
        `<span style="font-size:24px;font-weight:bold;color:${scoreColor};flex:1;text-align:right;">${o.s}</span>` +
        `<span style="font-size:14px;color:#7fb89a;width:78px;text-align:right;">胡${wins[o.i]} 炮${deals[o.i]}</span>` +
        `</div>`;
    });
    el.innerHTML = html;
  }

  clearButtons() {
    this.btnArea.innerHTML = '';
    // 按鈕清空時一併停止 claim 倒計時（claim 已被處理 / 階段切換）
    this.stopClaimCountdown();
  }

  // 清除手牌按鈕（打牌後、摸牌前隱藏）
  clearHandButtons() {
    this.handRow.innerHTML = '';
  }

  addButton(label: string, onClick: () => void, color = '#2e7d52') {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `padding:10px 22px;border:none;border-radius:10px;background:${color};
      color:#fff;font-size:15px;cursor:pointer;font-family:inherit;box-shadow:0 2px 6px rgba(0,0,0,0.3);`;
    btn.onclick = onClick;
    this.btnArea.appendChild(btn);
    return btn;
  }

  // 顯示 claim 選項
  showClaimOptions(options: ClaimOptions, isMyTurn: boolean) {
    this.clearButtons();
    if (!isMyTurn) {
      this.setInfo(`右家/對家/左家 可操作...`);
      return;
    }
    const myChoices = options.choices.filter((c) => c.player === 0);
    const labels: Record<string, string> = { win: '胡', pong: '碰', kong: '槓', chi: '吃' };
    // 非吃牌類只顯示一次；吃牌有多種組合時每種各一個按鈕
    const seen = new Set<string>();
    for (const c of myChoices) {
      if (c.kind !== 'chi' && seen.has(c.kind)) continue;
      seen.add(c.kind);
      // 吃牌按鈕標上具體的牌組合，方便選擇
      const label = c.kind === 'chi' && c.chiTiles
        ? `吃 ${c.chiTiles.map((t) => tileName(t)).join('')}`
        : labels[c.kind];
      this.addButton(label, () => {
        this.clearButtons();
        this.onClaimSelected?.(c);
      }, c.kind === 'win' ? '#c0392b' : '#2e7d52');
    }
    if (myChoices.length > 0) {
      this.addButton('過', () => {
        this.clearButtons();
        this.onClaimSelected?.({ player: -1, kind: 'pass' });
      }, '#555');
    }
    this.setInfo(`有人打出 ${tileName(options.tile)}，請選擇：`);
    // 玩家0 需決策：啟動 10 秒倒計時，超時自動「過」
    this.startClaimCountdown(10, () => {
      this.clearButtons();
      this.onClaimSelected?.({ player: -1, kind: 'pass' });
    });
  }

  onClaimSelected: ((c: ClaimChoice) => void) | null = null;

  // 顯示手牌按鈕（點擊出牌）
  showHandButtons(hand: TileDef[], onDiscard: (t: TileDef) => void) {
    this.handRow.innerHTML = '';
    hand.forEach((t) => {
      const b = document.createElement('button');
      b.textContent = tileName(t);
      b.style.cssText = `writing-mode:vertical-lr;padding:8px 6px;min-width:34px;min-height:70px;
        border:1px solid #8a7a55;border-radius:6px;background:linear-gradient(#fdf8ec,#e8dcc0);
        color:#1c2833;font-size:13px;cursor:pointer;font-family:inherit;`;
      if (t.suit === 'z') b.style.color = '#1c2833';
      b.onclick = () => onDiscard(t);
      this.handRow.appendChild(b);
    });
  }

  showWin(
    e: GameEvent,
    hand?: TileDef[],
    melds?: { tiles: TileDef[] }[],
    dealerNote?: string,
    match?: { over: boolean; scores: number[]; reason?: 'bankrupt' | 'rounds' | null }
  ) {
    this.winPanel.style.display = 'block';
    // 清除手牌按鈕，避免胡牌後殘留
    this.handRow.innerHTML = '';
    this.btnArea.innerHTML = '';
    const fans: FanResult | undefined = e.fans;
    const name = PLAYER_NAMES[e.player];
    let html = `<h2 style="margin:0 0 12px;color:#d4af37;">${name} 胡牌！</h2>`;
    // 自摸 / 放炮 說明
    const st0 = e.settle;
    if (st0) {
      const mode = st0.selfDraw
        ? `<span style="color:#7fb89a;">${name} 自摸食糊</span>`
        : `<span style="color:#e74c3c;">${PLAYER_NAMES[st0.from!]} 放炮</span>` +
          `（${fans?.fans.some((f) => f.name === '搶槓胡') ? '搶槓' : '出銃'}），${name} 食糊`;
      html += `<div style="margin:0 0 12px;font-size:16px;">${mode}</div>`;
    }
    if (dealerNote) {
      html += `<div style="margin:-4px 0 12px;font-size:14px;color:#f5e9c8;">${dealerNote}</div>`;
    }
    // 單張牌：有牌面圖生成器時用牌面圖展示（任何玩家都適用），否則退回文字
    const tileSpan = (t: TileDef, border: string, bg: string) => {
      const url = this.tileFaceUrl?.(t);
      if (url) {
        return `<img src="${url}" alt="${tileName(t)}" style="height:56px;border:1px solid ${border};
          border-radius:5px;background:#faf6ec;display:inline-block;">`;
      }
      return `<span style="writing-mode:vertical-lr;padding:6px 4px;min-width:26px;min-height:56px;
        border:1px solid ${border};border-radius:5px;background:${bg};
        color:#1c2833;font-size:12px;display:inline-block;">${tileName(t)}</span>`;
    };
    // 展示胡牌牌型
    if (hand && hand.length > 0) {
      html += `<div style="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin-bottom:12px;">`;
      for (const t of hand) {
        html += tileSpan(t, '#8a7a55', 'linear-gradient(#fdf8ec,#e8dcc0)');
      }
      html += `</div>`;
    }
    if (melds && melds.length > 0) {
      html += `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:12px;">`;
      for (const m of melds) {
        html += `<div style="display:flex;gap:2px;">`;
        for (const t of m.tiles) {
          html += tileSpan(t, '#6a5a35', 'linear-gradient(#f0e8d0,#d8c8a0)');
        }
        html += `</div>`;
      }
      html += `</div>`;
    }
    if (e.tile) {
      html += `<div style="font-size:16px;margin-bottom:12px;display:flex;align-items:center;gap:8px;">胡牌：`
        + tileSpan(e.tile, '#d4af37', 'linear-gradient(#fdf8ec,#e8dcc0)') + `</div>`;
    }
    // 番數計算 + 積分結算（合併為一個區塊，避免重疊）
    const st = e.settle;
    if (fans || st) {
      const baseFan = fans
        ? fans.fans.filter((f) => f.name !== '底胡').reduce((s, f) => s + f.value, 0)
        : 0;
      const flowerFans = st ? st.fan - baseFan : 0;
      html += `<div style="display:table;margin:0 auto 16px;text-align:left;border-top:1px solid #d4af37;padding-top:8px;">`;
      if (fans) {
        for (const f of fans.fans) {
          if (f.name === '自摸') continue; // 自摸以「三家出雙份」体现，不重複計番
          html += f.name === '底胡'
            ? `<div>底胡（雞胡）</div>`
            : `<div>${f.name} × ${f.value} 番</div>`;
        }
        if (flowerFans > 0) html += `<div>門風花 × ${flowerFans} 番</div>`;
      }
      if (st) {
        html += `<div style="margin-top:6px;border-top:1px solid #d4af37;padding-top:6px;">` +
          `共 <b style="color:#d4af37;">${st.fan}</b> 番（一二蚊）→ 單份 <b>${st.unit}</b> 蚊</div>`;
        html += `<div>${st.selfDraw
          ? `自摸：三家各出雙份（${2 * st.unit} 蚊）`
          : `${PLAYER_NAMES[st.from!]} 出銃出雙份（${2 * st.unit} 蚊），其餘單份（${st.unit} 蚊）`}</div>`;
        html += `<div style="margin-top:6px;">` +
          st.deltas
            .map((d, i) => `${PLAYER_NAMES[i]} <b style="color:${d >= 0 ? '#7fb89a' : '#e74c3c'}">${d >= 0 ? '+' : ''}${d}</b>`)
            .join('  ') +
          `</div>`;
        if (match && match.scores) {
          html += `<div style="margin-top:4px;color:#f5e9c8;">積分 ` +
            match.scores.map((s, i) => `${PLAYER_NAMES[i]}<b style="color:${s <= 0 ? '#e74c3c' : '#d4af37'}">${s}</b>`).join('  ') +
            `</div>`;
        }
      }
      html += `</div>`;
    }
    if (match && match.over) {
      const order = match.scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s || a.i - b.i);
      html += `<div style="margin:0 auto 16px;display:inline-block;text-align:left;border-top:1px solid #d4af37;padding-top:8px;">`;
      html += `<div style="color:#e74c3c;font-weight:bold;">${match.reason === 'rounds' ? '四圈完成（北圈結束）' : '積分見底'}，整場結束</div>`;
      order.forEach((o, r) => {
        html += `<div>${r + 1}. ${PLAYER_NAMES[o.i]} <b style="color:${o.s <= 0 ? '#e74c3c' : '#d4af37'}">${o.s}</b></div>`;
      });
      html += `</div>`;
    }
    const btnLabel = match && match.over ? '重新開場' : '再玩一局';
    html += `<div><button id="btn-restart" style="padding:10px 28px;border:none;border-radius:10px;
      background:#d4af37;color:#1a1a1a;font-size:15px;cursor:pointer;font-family:inherit;">${btnLabel}</button></div>`;
    this.winPanel.innerHTML = html;
    const btn = this.root.querySelector('#btn-restart') as HTMLButtonElement;
    btn.onclick = () => {
      this.winPanel.style.display = 'none';
      this.onRestart?.();
    };
  }

  onRestart: (() => void) | null = null;

  /** 牌面圖生成器（由 App 注入，通常綁定 BoardRenderer.tileFaceDataUrl）
   *  提供時胡牌面板用真實牌面圖展示；null 時退回文字牌 */
  tileFaceUrl: ((t: TileDef) => string) | null = null;

  showDrawMessage(dealerNote?: string, scores?: number[], match?: { over: boolean; reason?: 'bankrupt' | 'rounds' | null }) {
    this.winPanel.style.display = 'block';
    let noteHtml = dealerNote ? `<div style="margin:-4px 0 12px;font-size:14px;color:#f5e9c8;">${dealerNote}</div>` : '';
    let scoreHtml = '';
    if (scores && scores.length === 4) {
      scoreHtml = `<div style="margin-top:12px;color:#f5e9c8;">積分 ` +
        scores.map((s, i) => `${PLAYER_NAMES[i]}<b style="color:${s <= 0 ? '#e74c3c' : '#d4af37'}">${s}</b>`).join(' ') +
        `</div>`;
    }
    let overHtml = '';
    let btnLabel = '再玩一局';
    if (match && match.over) {
      btnLabel = '重新開場';
      const reasonText = match.reason === 'rounds' ? '四圈完成（北圈結束）' : '積分見底';
      const order = (scores ?? []).map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s || a.i - b.i);
      overHtml = `<div style="margin-top:12px;display:inline-block;text-align:left;border-top:1px solid #d4af37;padding-top:8px;">` +
        `<div style="color:#e74c3c;font-weight:bold;">${reasonText}，整場結束</div>`;
      order.forEach((o, r) => {
        overHtml += `<div>${r + 1}. ${PLAYER_NAMES[o.i]} <b style="color:${o.s <= 0 ? '#e74c3c' : '#d4af37'}">${o.s}</b></div>`;
      });
      overHtml += `</div>`;
    }
    this.winPanel.innerHTML = `<h2 style="margin:0 0 16px;color:#7fb89a;">流局</h2>
      <div>牌牆已摸完，無人胡牌。</div>
      ${noteHtml}
      ${scoreHtml}
      ${overHtml}
      <div style="margin-top:16px;"><button id="btn-restart" style="padding:10px 28px;border:none;border-radius:10px;
      background:#d4af37;color:#1a1a1a;font-size:15px;cursor:pointer;font-family:inherit;">${btnLabel}</button></div>`;
    const btn = this.root.querySelector('#btn-restart') as HTMLButtonElement;
    btn.onclick = () => {
      this.winPanel.style.display = 'none';
      this.onRestart?.();
    };
  }
}
