// 驗證：一家握有 3 張同牌時，「吃 / 槓 / 碰」三個選項必須同時出現（缺碰即 bug）
import { Game, pickBestClaim, CLAIM_RANK, ClaimOptions } from '../src/game/game';
import { TileDef, makeTile } from '../src/game/tiles';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };

const T = (s: 'm' | 'p' | 's' | 'z', r: number) => makeTile(s, r);

// 13 張、不構成胡牌、預設不含 5 筒
function filler(seed: number): TileDef[] {
  const base: TileDef[] = [
    T('m', 1), T('m', 2), T('m', 9), T('m', 9),
    T('s', 1), T('s', 7), T('s', 8), T('z', 1),
    T('z', 2), T('z', 3), T('s', 3), T('m', 5),
  ];
  return [...base, base[seed % base.length]];
}

const g = new Game();
g.onEvent = () => {};
let captured: ClaimOptions | null = null;
g.onPrompt = (o) => { captured = o; };

g.nextDealer();
g.rollDice();
g.prepareDeal();
g.resolveFlowers();
g.finishDeal();

// 玩家0：5筒×3 + 3筒 + 4筒 → 能吃(3-4)、能碰、能槓
g.players[0].hand = [T('p', 5), T('p', 5), T('p', 5), T('p', 3), T('p', 4), ...filler(0).slice(0, 8)];
g.players[1].hand = filler(1);
g.players[2].hand = filler(2);
// 玩家3（上家）手上要有 5筒 才能打出
g.players[3].hand = [T('p', 5), ...filler(3).slice(0, 12)];
for (let i = 0; i < 4; i++) { g.players[i].melds = []; g.players[i].discards = []; g.players[i].flowers = []; }

// 玩家3 打出 5筒 → 下家玩家0 可吃
g.current = 3;
g.phase = 'turn';
(g as any).awaitingDraw = false;
const dres = g.discard(3, T('p', 5));
ok(dres === true, `discard(3, 5筒) 成立並進入 claim (phase=${g.phase})`);
ok((g.phase as string) === 'claiming', `進入 claiming`);
ok(captured !== null, 'onPrompt 收到 claim 選項');

const opts = captured!;
const mine = opts.choices.filter((c) => c.player === 0).map((c) => c.kind);
ok(mine.includes('kong'), `玩家0 有「槓」選項 (${mine.join(',')})`);
ok(mine.includes('pong'), `玩家0 有「碰」選項（3 張時也必須給碰）(${mine.join(',')})`);
ok(mine.includes('chi'), `玩家0 有「吃」選項 (${mine.join(',')})`);
ok(mine.length >= 3, `玩家0 共 ${mine.length} 個可選（槓/碰/吃 齊備）`);

// 優先級：槓 > 碰 > 吃
ok(CLAIM_RANK.kong < CLAIM_RANK.pong && CLAIM_RANK.pong < CLAIM_RANK.chi, '優先級 槓>碰>吃');
const best = pickBestClaim(opts)!;
ok(best.player === 0 && best.kind === 'kong', `全局裁決 = 玩家0 槓 (${best.player}:${best.kind})`);

// 選「碰」：用掉 2 張、留 1 張
g.resolveClaim({ player: 0, kind: 'pong', tile: T('p', 5) });
const left = g.players[0].hand.filter((t) => t.suit === 'p' && t.rank === 5).length;
ok(left === 1, `碰後玩家0 手上剩 1 張 5筒 (剩 ${left})`);
ok(g.players[0].melds.some((m) => m.type === 'pong'), '碰副露成立');
ok(g.phase === 'turn' && g.current === 0, `碰後輪到玩家0 出牌 (phase=${g.phase} cur=${g.current})`);

console.log(`合計 pass=${pass} fail=${fail}`);
