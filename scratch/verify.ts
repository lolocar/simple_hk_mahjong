// 最終實現值總檢查：桌面 8.6×8.6 正方形、亮牌四家統一參數、標記 inset [0.8,0.45,0.45,0.45]、相機 fov44/h7/d9.6/t0.4
import * as THREE from 'three';

type Box = { x0: number; z0: number; x1: number; z1: number };
const S = 0.36, w = 0.6 * S, h = 0.8 * S, d = 0.26 * S;
const POS = [{ x: 0, z: 3 }, { x: 3, z: 0 }, { x: 0, z: -3 }, { x: -3, z: 0 }];
const TC = POS.map((p) => ({ x: -p.x / 3, z: -p.z / 3 }));
const PP = TC.map((t) => ({ x: -t.z, z: t.x }));
const NAMES = ['東(你)', '南(右家)', '西(對家)', '北(左家)'];
const flatHx = (p: number) => (Math.abs(PP[p].x) > 0.5 ? w / 2 : h / 2);
const flatHz = (p: number) => (Math.abs(PP[p].x) > 0.5 ? h / 2 : w / 2);

const boxes: Box[] = [];
const push = (cx: number, cz: number, hx: number, hz: number) =>
  boxes.push({ x0: cx - hx, z0: cz - hz, x1: cx + hx, z1: cz + hz });

for (let p = 0; p < 4; p++) { // 手牌 14
  const totalW = 13 * w, spreadX = Math.abs(PP[p].x) > 0.5;
  for (let i = 0; i < 14; i++) {
    const off = i * w - totalW / 2;
    const c = p === 0 ? { x: off, z: 2.78 }
      : { x: POS[p].x + TC[p].x * 0.28 + PP[p].x * off, z: POS[p].z + TC[p].z * 0.28 + PP[p].z * off };
    push(c.x, c.z, spreadX ? w / 2 : d / 2, spreadX ? d / 2 : w / 2);
  }
  for (let i = 0; i < 24; i++) { // 弃牌 24
    const row = Math.min(Math.floor(i / 12), 1), col = i % 12;
    const rowOff = [1.25, 1.6][row], colOff = (col - 5.5) * w;
    push(POS[p].x + TC[p].x * rowOff + PP[p].x * colOff, POS[p].z + TC[p].z * rowOff + PP[p].z * colOff, flatHx(p), flatHz(p));
  }
  const inward = -0.35; // 副露 4 組全槓（四家統一，往該家外推 0.35）
  const bx = POS[p].x + PP[p].x * (-2.2) + TC[p].x * inward, bz = POS[p].z + PP[p].z * (-2.2) + TC[p].z * inward;
  for (let mi = 0; mi < 4; mi++) {
    const col = Math.floor(mi / 2), rowInCol = mi % 2;
    const cx0 = bx + PP[p].x * (rowInCol * (w * 3 + 0.06) + w) + TC[p].x * (-col * 0.5);
    const cz0 = bz + PP[p].z * (rowInCol * (w * 3 + 0.06) + w) + TC[p].z * (-col * 0.5);
    for (let i = 0; i < 4; i++)
      push(cx0 + PP[p].x * ((i - 1.5) * w), cz0 + PP[p].z * ((i - 1.5) * w), flatHx(p), flatHz(p));
  }
  const lo = 2.7, io = -0.05, perRow = 4; // 花牌 8（四家統一 2 行×4，往該家外推 0.35）
  const fx = POS[p].x + PP[p].x * (-lo) + TC[p].x * io, fz = POS[p].z + PP[p].z * (-lo) + TC[p].z * io;
  for (let i = 0; i < 8; i++) {
    const col = Math.floor(i / perRow), rowInCol = i % perRow;
    push(fx + PP[p].x * (-rowInCol * w) + TC[p].x * (-col * 0.5), fz + PP[p].z * (-rowInCol * w) + TC[p].z * (-col * 0.5), flatHx(p), flatHz(p));
  }
}
{ // 牌牆 144
  const tileW = 0.26, half = 9 * tileW, hs = 8.5 * tileW, gap = 2 * tileW;
  const sides = [
    { bx: -hs + gap / 2, bz: half, ax: 1, az: 0, rot: 0 }, { bx: half, bz: -hs + gap / 2, ax: 0, az: 1, rot: 1 },
    { bx: hs - gap / 2, bz: half, ax: -1, az: 0, rot: 0 }, { bx: -half, bz: hs - gap / 2, ax: 0, az: -1, rot: 1 },
  ];
  for (let k = 0; k < 144; k++) {
    const s = sides[Math.floor(k / 36)], off = (k % 36) % 18 * tileW;
    push(s.bx + s.ax * off, s.bz + s.az * off, s.rot === 0 ? 0.27 / 2 : 0.36 / 2, s.rot === 0 ? 0.36 / 2 : 0.27 / 2);
  }
}
const ov = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const TABLE: Box = { x0: -4.1, z0: -4.1, x1: 4.1, z1: 4.1 };
const outside = boxes.filter((b) => b.x0 < TABLE.x0 || b.x1 > TABLE.x1 || b.z0 < TABLE.z0 || b.z1 > TABLE.z1).length;
console.log(`桌面 8.2×8.2：牌組總數=${boxes.length} 超出桌面=${outside}`);

const cam = new THREE.PerspectiveCamera(44, 16 / 9, 0.1, 120);
cam.position.set(0, 6.6, 9.6); cam.lookAt(0, 0, 0.4); cam.updateMatrixWorld(true);
const ndc = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).project(cam);

const EDGE = [4.1, 4.1, 4.1, 4.1], INSET = [0.8, 0.45, 0.45, 0.45];
console.log('標記 0.6×0.6：');
for (let p = 0; p < 4; p++) {
  const dir = { x: POS[p].x / 3, z: POS[p].z / 3 };
  const cx = dir.x * (EDGE[p] - INSET[p]), cz = dir.z * (EDGE[p] - INSET[p]);
  const lb: Box = { x0: cx - 0.3, z0: cz - 0.3, x1: cx + 0.3, z1: cz + 0.3 };
  const inside = lb.x0 >= TABLE.x0 && lb.x1 <= TABLE.x1 && lb.z0 >= TABLE.z0 && lb.z1 <= TABLE.z1;
  const hits = boxes.filter((b) => ov(lb, b)).length;
  const cs = [[cx - 0.3, cz - 0.3], [cx + 0.3, cz - 0.3], [cx - 0.3, cz + 0.3], [cx + 0.3, cz + 0.3]].map(([x, z]) => ndc(x, 0.012, z));
  console.log(`  ${NAMES[p]} 中心(${cx.toFixed(2)},${cz.toFixed(2)}) 桌內=${inside ? 'Y' : 'N'} 遮擋=${hits} 四角在畫面=${cs.every((v) => Math.abs(v.x) < 1 && Math.abs(v.y) < 1) ? 'Y' : 'N'}`);
}

// fitCamera 行為
const corners: [number, number][] = [[-4.1, 4.1], [4.1, 4.1], [-4.1, -4.1], [4.1, -4.1]];
console.log('fitCamera 自動距離：');
for (const [name, W, H] of [['16:9', 1600, 900], ['16:10', 1600, 1000], ['4:3', 1200, 900], ['1:1', 900, 900], ['豎屏 3:4', 768, 1024]] as [string, number, number][]) {
  const c = new THREE.PerspectiveCamera(44, W / H, 0.1, 120);
  const aim = (dd: number) => {
    c.position.set(0, 6.6, dd); c.lookAt(0, 0, 0.4); c.updateMatrixWorld(true);
    let m = 0;
    for (const [x, z] of corners) { const v = new THREE.Vector3(x, 0, z).project(c); m = Math.max(m, Math.abs(v.x), Math.abs(v.y)); }
    return m;
  };
  let dd = 9.6, steps = 0;
  for (let i = 0; i < 60 && aim(dd) > 0.95; i++) { dd += 0.4; steps++; }
  const px = (v: THREE.Vector3) => (v.x + 1) / 2 * W, pyf = (v: THREE.Vector3) => (1 - v.y) / 2 * H;
  const a = px(ndcOf(c, 0, 0.22, 2.78)), b = px(ndcOf(c, 0.216, 0.22, 2.78));
  const dong = { y: pyf(ndcOf(c, 0, 0.012, 3.3)), lo: pyf(ndcOf(c, 0, 0.012, 3.6)), hi: pyf(ndcOf(c, 0, 0.012, 3.0)) };
  console.log(`  ${name.padEnd(9)} d=${dd.toFixed(1)}(退${steps}) |NDC|=${aim(dd).toFixed(2)} 牌 ${Math.abs(b - a).toFixed(1)}px 東標記距底 ${Math.min(H - dong.lo, H - dong.hi).toFixed(0)}~${Math.max(H - dong.lo, H - dong.hi).toFixed(0)}px`);
}
function ndcOf(c: THREE.PerspectiveCamera, x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z).project(c);
}
