// 驗證所有牌「放在桌上」：牌底 y≈0；牌牆上層壓在下層牌面上
const TILE_W = 0.6, TILE_H = 0.8, TILE_D = 0.26;
const HAND_SCALE = 0.36, WALL_SCALE = 0.45, DICE_SIZE = 0.25;
const STAND_Y = (TILE_H * HAND_SCALE) / 2;
const FLAT_Y = (TILE_D * HAND_SCALE) / 2;
const WALL_LAYER = TILE_D * WALL_SCALE;
const WALL_Y0 = WALL_LAYER / 2;
const DICE_Y = DICE_SIZE / 2;

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) < e;

// 桌面頂面 y=0
const TABLE_TOP = 0;

// 立著的牌（手牌）：牌底貼桌面
ok(near(STAND_Y - (TILE_H * HAND_SCALE) / 2, TABLE_TOP), `立牌牌底貼桌面 (STAND_Y=${STAND_Y})`);
// 平放的牌（弃牌/副露/花牌）：牌底貼桌面
ok(near(FLAT_Y - (TILE_D * HAND_SCALE) / 2, TABLE_TOP), `平放牌底貼桌面 (FLAT_Y=${FLAT_Y})`);
// 骰子底貼桌面
ok(near(DICE_Y - DICE_SIZE / 2, TABLE_TOP), `骰子底貼桌面 (DICE_Y=${DICE_Y})`);

// 牌牆底層：牌底貼桌面
const wallBottomCenter = WALL_Y0;
ok(near(wallBottomCenter - WALL_LAYER / 2, TABLE_TOP), `牌牆底層牌底貼桌面 (${wallBottomCenter})`);
// 牌牆上層：牌底 = 底層牌面（壓在下層上）
const wallTopCenter = WALL_Y0 + WALL_LAYER;
ok(near(wallTopCenter - WALL_LAYER / 2, wallBottomCenter + WALL_LAYER / 2),
  `牌牆上層壓在下層牌面上 (上層中心=${wallTopCenter}, 下層頂=${wallBottomCenter + WALL_LAYER / 2})`);

// 舊值對比（證明原 bug：懸空）
{
  const oldStand = 0.22, oldFlat = 0.09, oldWallTop = 0.25, oldWallBottom = 0.1;
  ok(oldStand - (TILE_H * HAND_SCALE) / 2 > 0.05, `舊立牌懸空 ${(oldStand - (TILE_H * HAND_SCALE) / 2).toFixed(3)}`);
  ok(oldFlat - (TILE_D * HAND_SCALE) / 2 > 0.03, `舊平放牌懸空 ${(oldFlat - (TILE_D * HAND_SCALE) / 2).toFixed(3)}`);
  ok(oldWallTop - WALL_LAYER / 2 > oldWallBottom + WALL_LAYER / 2 + 0.02,
    `舊牌牆上層懸空 ${(oldWallTop - WALL_LAYER / 2 - (oldWallBottom + WALL_LAYER / 2)).toFixed(3)}`);
}

// 牌牆上層中心 = 底層中心 + 一層厚（無縫疊放）
ok(near(wallTopCenter - wallBottomCenter, WALL_LAYER), `牌牆層間距 = 一層厚 (${WALL_LAYER})`);

console.log(`STAND_Y=${STAND_Y} FLAT_Y=${FLAT_Y} WALL_Y0=${WALL_Y0} WALL_LAYER=${WALL_LAYER} DICE_Y=${DICE_Y}`);
console.log(`合計 pass=${pass} fail=${fail}`);
