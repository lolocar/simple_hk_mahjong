// 氣泡錨點：把桌面邊緣外的世界點投影到螢幕，檢查與 UI 帶/牌的關係
import * as THREE from 'three';

const cam = new THREE.PerspectiveCamera(44, 16 / 9, 0.1, 120);
cam.position.set(0, 6.6, 9.6); cam.lookAt(0, 0, 0.4); cam.updateMatrixWorld(true);
const W = 1600, H = 900;
const proj = (x: number, y: number, z: number) => {
  const v = new THREE.Vector3(x, y, z).project(cam);
  return { x: (v.x * 0.5 + 0.5) * W, yb: (1 - ((-v.y * 0.5 + 0.5))) * H, ndc: v };
};
// yb = 距底像素
console.log('桌面四邊中點（z=±4.1 / x=±4.1）：');
for (const [nm, x, z] of [['你 近邊中', 0, 4.1], ['右家 邊中', 4.1, 0], ['對家 遠邊中', 0, -4.1], ['左家 邊中', -4.1, 0]] as [string, number, number][]) {
  const p = proj(x, 0, z);
  console.log(`  ${nm.padEnd(11)} 像素 x=${p.x.toFixed(0)} 距底=${p.yb.toFixed(0)} NDC=(${p.ndc.x.toFixed(2)},${p.ndc.y.toFixed(2)})`);
}
console.log('\n候選錨點（桌面邊緣外 0.5~0.8）：');
const cands: [string, number, number][] = [
  ['p0 近邊中外', 0, 4.7], ['p0 近邊偏左', -2.6, 4.7], ['p0 近邊偏左2', -3.2, 4.5],
  ['p1 右邊中', 4.7, 0], ['p1 右邊偏上', 4.7, -1.2],
  ['p2 遠邊中', 0, -4.7], ['p2 遠邊偏右', 2.2, -4.7],
  ['p3 左邊中', -4.7, 0], ['p3 左邊偏下', -4.7, 1.2],
];
for (const [nm, x, z] of cands) {
  const p = proj(x, 0, z);
  console.log(`  ${nm.padEnd(11)} 像素 x=${p.x.toFixed(0)} 距底=${p.yb.toFixed(0)} NDC=(${p.ndc.x.toFixed(2)},${p.ndc.y.toFixed(2)}) 在畫面=${Math.abs(p.ndc.x) < 1 && Math.abs(p.ndc.y) < 1 ? 'Y' : 'N'}`);
}
console.log('\nUI 帶（距底 px，900 高）：手牌 16~94 / btn 100~140 / 倒數 132~160 / info 170~202 / 東標記 212~268 / 3D手牌 290~314');
console.log('桌面四角：');
for (const [x, z] of [[-4.1, 4.1], [4.1, 4.1], [-4.1, -4.1], [4.1, -4.1]]) {
  const p = proj(x, 0, z);
  console.log(`  (${x},${z}) x=${p.x.toFixed(0)} 距底=${p.yb.toFixed(0)}`);
}
console.log('\n各家手牌兩端（氣泡不可蓋住手牌）：');
for (const [nm, x, z] of [['p0 手牌左', -1.404, 2.78], ['p0 手牌右', 1.404, 2.78], ['p2 手牌左', -1.404, -2.72], ['p2 手牌右', 1.404, -2.72]] as [string, number, number][]) {
  const p = proj(x, 0.364, z);
  console.log(`  ${nm.padEnd(9)} x=${p.x.toFixed(0)} 距底=${p.yb.toFixed(0)}`);
}
for (const [nm, x, z] of [['p1 手牌上', 2.72, -1.404], ['p1 手牌下', 2.72, 1.404], ['p3 手牌上', -2.72, -1.404], ['p3 手牌下', -2.72, 1.404]] as [string, number, number][]) {
  const p = proj(x, 0.364, z);
  console.log(`  ${nm.padEnd(9)} x=${p.x.toFixed(0)} 距底=${p.yb.toFixed(0)}`);
}
