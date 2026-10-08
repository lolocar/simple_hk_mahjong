// 修正方案驗證：p0/p2 錨點外推 1.1，p1/p3 中心 x 夾到 [78, W-78]
import * as THREE from 'three';

const CAM_H = 6.6, CAM_T = 0.4, FOV = 44, BASE_D = 9.6;
const NEAR = 4.1, FAR = 4.1, HALF = 4.1;
const BW = 128, BH = 38;

function fitD(aspect: number, cam: THREE.PerspectiveCamera) {
  const corners = [[-HALF, NEAR], [HALF, NEAR], [-HALF, -FAR], [HALF, -FAR]] as [number, number][];
  const aim = (d: number) => {
    cam.position.set(0, CAM_H, d); cam.lookAt(0, 0, CAM_T); cam.updateMatrixWorld(true);
    let m = 0;
    for (const [x, z] of corners) { const v = new THREE.Vector3(x, 0, z).project(cam); m = Math.max(m, Math.abs(v.x), Math.abs(v.y)); }
    return m;
  };
  let d = BASE_D;
  for (let i = 0; i < 60 && aim(d) > 0.95; i++) d += 0.4;
  aim(d);
  return d;
}

const aspects: [string, number, number][] = [
  ['16:9', 1600, 900], ['16:10', 1440, 900], ['4:3', 1200, 900], ['1:1', 900, 900], ['3:4 豎屏', 675, 900],
];
const MARGIN = 78;

for (const [nm, W, H] of aspects) {
  const cam = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 120);
  const d = fitD(W / H, cam);
  const proj = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).project(cam);
    return { x: (v.x * 0.5 + 0.5) * W, yb: (v.y * 0.5 + 0.5) * H };
  };
  // 新錨點：p0/p2 外推 1.1
  const anchors: [number, number, number][] = [
    [-2.6, 0, NEAR + 1.1], [HALF + 0.6, 0, 0], [0, 0, -(FAR + 1.1)], [-(HALF + 0.6), 0, 0],
  ];
  console.log(`\n=== ${nm} ${W}x${H} d=${d.toFixed(1)} ===`);
  for (let p = 0; p < 4; p++) {
    const a = proj(...anchors[p]);
    const cx = Math.min(Math.max(a.x, MARGIN), W - MARGIN);
    const cyb = Math.min(Math.max(a.yb, MARGIN), H - MARGIN);
    const x0 = cx - BW / 2, x1 = cx + BW / 2, y0 = cyb - BH / 2, y1 = cyb + BH / 2;
    const onScreen = x0 >= 0 && x1 <= W && y0 >= 0 && y1 <= H;
    console.log(`  p${p} 中心(${cx.toFixed(0)},距底${cyb.toFixed(0)}) 矩形 x=${x0.toFixed(0)}~${x1.toFixed(0)} 距底=${y0.toFixed(0)}~${y1.toFixed(0)} 全在畫面=${onScreen ? 'Y' : 'N'}${cx !== a.x ? ' [夾x]' : ''}`);
  }
  const hands: [number, number, number][] = [
    [-1.404, 0.364, 2.78], [1.404, 0.364, 2.78],
    [2.72, 0.364, -1.404], [2.72, 0.364, 1.404],
    [-1.404, 0.364, -2.72], [1.404, 0.364, -2.72],
    [-2.72, 0.364, -1.404], [-2.72, 0.364, 1.404],
  ];
  const hp = hands.map((h) => proj(...h));
  const overlap = (r: [number, number, number, number], hx0: number, hx1: number, hy0: number, hy1: number) =>
    !(r[1] < hx0 || r[0] > hx1 || r[3] < hy0 || r[2] > hy1);
  for (let p = 0; p < 4; p++) {
    const a = proj(...anchors[p]);
    const cx = Math.min(Math.max(a.x, MARGIN), W - MARGIN);
    const cyb = Math.min(Math.max(a.yb, MARGIN), H - MARGIN);
    const r: [number, number, number, number] = [cx - BW / 2, cx + BW / 2, cyb - BH / 2, cyb + BH / 2];
    const h0 = hp[p * 2], h1 = hp[p * 2 + 1];
    const hx0 = Math.min(h0.x, h1.x), hx1 = Math.max(h0.x, h1.x);
    const hy0 = Math.min(h0.yb, h1.yb), hy1 = Math.max(h0.yb, h1.yb);
    console.log(`  p${p} 手牌 x=${hx0.toFixed(0)}~${hx1.toFixed(0)} 距底=${hy0.toFixed(0)}~${hy1.toFixed(0)} 氣泡蓋手牌=${overlap(r, hx0, hx1, hy0, hy1) ? '是' : '否'}`);
  }
  const a0 = proj(...anchors[0]);
  const cx0 = Math.min(Math.max(a0.x, MARGIN), W - MARGIN);
  const cyb0 = Math.min(Math.max(a0.yb, MARGIN), H - MARGIN);
  const r0: [number, number, number, number] = [cx0 - BW / 2, cx0 + BW / 2, cyb0 - BH / 2, cyb0 + BH / 2];
  const uiBands: [string, number, number, number][] = [
    ['手牌列', 16, 94, 14 * 38], ['按鈕', 100, 140, 300], ['倒數', 132, 160, 120], ['info-bar', 170, 202, 420],
  ];
  for (const [un, b0, b1, uw] of uiBands) {
    const ux0 = W / 2 - uw / 2, ux1 = W / 2 + uw / 2;
    console.log(`  p0 氣泡 vs ${un} 重疊=${overlap(r0, ux0, ux1, b0, b1) ? '是' : '否'}`);
  }
}
