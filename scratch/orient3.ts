// 驗證門風標記朝向：head 是否 = -dir（朝桌心）、各家視角是否正立
import * as THREE from 'three';

const POS = [{ x: 0, z: 3 }, { x: 3, z: 0 }, { x: 0, z: -3 }, { x: -3, z: 0 }];
const NAMES = ['東(你)', '南(右家)', '西(對家)', '北(左家)'];
const EDGE = [4.1, 4.1, 4.6, 4.1], INSET = [0.8, 0.45, 0.45, 0.45];

// 與 board.ts 相同的構造
const build = (p: number) => {
  const dir = new THREE.Vector3(POS[p].x, 0, POS[p].z).normalize();
  const at = dir.clone().multiplyScalar(EDGE[p] - INSET[p]);
  at.y = 0.012;
  const m = new THREE.Object3D();
  m.rotation.x = -Math.PI / 2;
  m.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.atan2(dir.x, dir.z));
  m.position.copy(at);
  m.updateMatrixWorld(true);
  return { m, dir };
};

// 平面局部 +y = 字頭方向；換算到世界
const headOf = (m: THREE.Object3D) => new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion);

console.log('世界座標：head 應 = -dir（朝桌心）');
for (let p = 0; p < 4; p++) {
  const { m, dir } = build(p);
  const head = headOf(m);
  const want = dir.clone().negate();
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion);
  console.log(`  ${NAMES[p]} head=(${head.x.toFixed(3)},${head.z.toFixed(3)}) 期望-dir=(${want.x.toFixed(3)},${want.z.toFixed(3)}) ` +
    `吻合=${head.dot(want) > 0.999 ? 'Y' : 'N'} 面朝上=${normal.y.toFixed(2)}`);
}

const camAngle = (cam: THREE.PerspectiveCamera, m: THREE.Object3D) => {
  const o = m.position.clone();
  const a = o.clone().add(headOf(m).multiplyScalar(0.3)).project(cam);
  const b = o.clone().add(headOf(m).multiplyScalar(-0.3)).project(cam);
  return (Math.atan2(a.y - b.y, a.x - b.x) * 180) / Math.PI;
};

console.log('\n各家自己視角（相機在該家座位後方、看向桌心）：字頭應指向上（螢幕角 ≈ +90°）');
for (let p = 0; p < 4; p++) {
  const { m, dir } = build(p);
  const cam = new THREE.PerspectiveCamera(44, 16 / 9, 0.1, 120);
  cam.position.set(dir.x * 5.2, 3.4, dir.z * 5.2);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  const deg = camAngle(cam, m);
  console.log(`  ${NAMES[p]} 字頭螢幕角=${deg.toFixed(1)}° ${Math.abs(deg - 90) < 8 ? '正立✓' : '不正立✗'}`);
}

console.log('\n本視角（玩家0 相機 fov44 h7 d9.6 t0.4）：');
{
  const cam = new THREE.PerspectiveCamera(44, 16 / 9, 0.1, 120);
  cam.position.set(0, 7.0, 9.6); cam.lookAt(0, 0, 0.4); cam.updateMatrixWorld(true);
  for (let p = 0; p < 4; p++) {
    const { m } = build(p);
    const v = m.position.clone().project(cam);
    console.log(`  ${NAMES[p]} 字頭螢幕角=${camAngle(cam, m).toFixed(1)}° NDC=(${v.x.toFixed(2)},${v.y.toFixed(2)}) ` +
      `在畫面=${Math.abs(v.x) < 1 && Math.abs(v.y) < 1 ? 'Y' : 'N'}`);
  }
}
