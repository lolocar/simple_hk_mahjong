// Three.js 3D 場景：桌面、牌、牌牆、沉浸視角

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TileDef, HONOR_NAMES, FLOWER_NAMES } from '../game/tiles';

export const TILE_W = 0.6;
export const TILE_H = 0.8;
export const TILE_D = 0.26;

// 桌面頂面在 y=0（桌面 Box 高 0.3、中心 y=-0.15）。所有牌都要「放在桌上」：
// 立著的牌以牌底貼桌面，平放的牌以牌底貼桌面，上下疊放時上層壓在下層牌面上。
const HAND_SCALE = 0.36;
/** 立著的牌中心高度（牌高的一半，牌底貼桌面） */
export const STAND_Y = (TILE_H * HAND_SCALE) / 2; // 0.144
/** 平放的牌中心高度（牌厚的一半，牌底貼桌面） */
export const FLAT_Y = (TILE_D * HAND_SCALE) / 2;  // 0.0468
const WALL_SCALE = 0.45;
/** 牌牆一層的厚度（上層中心 = 下層中心 + 此值 → 正好壓在下層牌上） */
export const WALL_LAYER = TILE_D * WALL_SCALE;    // 0.117
/** 牌牆底層中心高度 */
export const WALL_Y0 = WALL_LAYER / 2;            // 0.0585
const DICE_SIZE = 0.25;
/** 骰子中心高度（骰子底貼桌面） */
const DICE_Y = DICE_SIZE / 2;                     // 0.125

export class BoardRenderer {
  /** 相機基準：高度與注視點固定，距離由 fitCamera() 依視窗比例調整。
   *  高度 6.6 → 俯角 atan(6.6/9.2) ≈ 35.7°；再低（≤6.5）自家弃牌會被自家手牌擋住。 */
  private static readonly CAM_HEIGHT = 6.6;
  private static readonly CAM_BASE_DIST = 9.6;
  private static readonly CAM_TARGET_Z = 0.4;

  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;

  // 玩家視角：0=自己(南)，1=右(西)，2=對家(北)，3=左(東)
  // 座標：玩家0在 z 正方向（螢幕下方），逆時針 1=右，2=上，3=左
  tableRadius = 3.2;

  private tileMeshes = new Map<number, THREE.Group>(); // key: 玩家idx*1000 + 牌idx
  private discardGroups: (THREE.Group | null)[] = [];
  private meldGroups: (THREE.Group | null)[] = [];
  private flowerGroups: (THREE.Group | null)[] = [];
  // 發牌動畫
  private dealQueue: { player: number; start: number; count: number }[] = [];
  private playersRef: TileDef[][] = [];
  private dealDone: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a2e22);
    this.scene.fog = new THREE.Fog(0x0a2e22, 16, 40);

    // 相機：FOV 44、高度 7.0，讓整張桌面連同四周留白入鏡。
    // 原 38/5.2 的取景比畫面還寬（桌面近端兩角落在 NDC ±1.08，完全在畫面外），
    // 看起來就是「桌子大到超出螢幕」；現取景佔畫面約 0.66×0.56。
    // 距離由 fitCamera() 依視窗比例自動調整（窄窗自動拉遠）。
    this.camera = new THREE.PerspectiveCamera(44, container.clientWidth / container.clientHeight, 0.1, 120);
    // 沉浸視角：從玩家0背後偏高位置，俯瞰桌面與手牌（與桌邊保持距離）
    this.camera.position.set(0, BoardRenderer.CAM_HEIGHT, BoardRenderer.CAM_BASE_DIST);
    this.camera.lookAt(0, 0, BoardRenderer.CAM_TARGET_Z);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.buildTable();
    this.buildLights();
    this.buildWall();
    this.fitCamera(); // 桌面尺寸已知，依視窗比例定距離

    // 載入參考圖牌面，完成後回調讓上層重新渲染所有牌
    this.loadRefImage().then(() => {
      this.onRefLoaded?.();
    });

    window.addEventListener('resize', this.onResize);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
  }

  /** 參考圖牌面載入完成回調 */
  onRefLoaded: (() => void) | null = null;

  // ===== 玩家0 手牌點擊（3D 射線偵測）=====
  /** 點擊玩家0 的手牌時觸發（index=手牌索引，tile=該牌） */
  onTileClick: ((index: number, tile: TileDef) => void) | null = null;
  /** 點擊空白處（非玩家0 手牌）時觸發 */
  onBlankClick: (() => void) | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  /** 玩家0 的手牌 mesh 清單（供射線偵測用，renderHand(0) 時重建）
   *  hit: 不可見 hitbox，覆蓋「原始位置 + 抬高後位置」的整個範圍，選牌區域固定不隨懸停移動 */
  private hand0Entries: { mesh: THREE.Mesh; hit: THREE.Mesh; index: number; tile: TileDef }[] = [];
  /** 玩家0 手牌最右側的螢幕座標（供「摸牌」提示定位，renderHand(0) 時更新） */
  private hand0RightScreen: { x: number; y: number } | null = null;
  /** 桌面 mesh（只有點到桌面才算「摸牌」） */
  private tableMesh: THREE.Mesh | null = null;
  /** 各家桌沿「距中心的距離」（桌面為正方形，四家相同） */
  private tableNearDist = 4.1;  // 玩家0 一側 (+z)
  private tableFarDist = 4.1;   // 對家一側 (-z)
  private tableHalf = 4.1;      // 左右兩側 (±x)
  /** 目前懸停中的手牌 mesh（null=無懸停） */
  private hoveredTile: THREE.Mesh | null = null;

  private wallGroup: THREE.Group | null = null;
  private dealerMarker: THREE.Mesh | null = null;
  private windLabels: THREE.Mesh[] = [];
  private diceGroup: THREE.Group | null = null;
  private diceMeshes: THREE.Mesh[] = [];

  // 牌牆：桌面中央方形雙層牌牆（牌背朝上，像實體麻將桌）
  buildWall() {
    this.wallRemoved = new Set();
    this.wallPile = 0;
    this.singleLayerTop = true;
    this.rebuildWall();
  }

  // 牌牆狀態：
  // - wallPile：下一個要取的「棟」索引（0..71，共 72 棟 = 4 邊 × 18 棟）
  //   順時針編號：北(上)0-17、東(右)18-35、南(下)36-53、西(左)54-71
  //   港式「順時針摸牌」即沿著棟索引遞增方向取牌
  // - wallRemoved：已被拿走（不顯示）的牌 k 索引
  private wallPile = 0;
  private wallRemoved = new Set<number>();
  // 單張發牌時的層交替：true=上層，false=下層（上、下、上、下...）
  private singleLayerTop = true;

  /** 設定牌牆配牌起點：開門方位 + 跳過 total 棟
   * 港式規則：在開門方位的牌牆中，由開始處順時針數起，跳過 total 棟，從第 total+1 棟開始配牌 */
  setWallStart(startPlayer: number, total: number) {
    // 玩家 p 前方的牌牆邊（自己疊的牌在自己面前）：
    // 玩家0(下/南邊)→南邊牌牆(棟36-53)，玩家1(右/東邊)→東邊(18-35)，
    // 玩家2(上/北邊)→北邊(0-17)，玩家3(左/西邊)→西邊(54-71)
    const base = ((((2 - startPlayer) % 4) + 4) % 4) * 18;
    // 跳過 total 棟（順時針），超過 18 棟則銜接到下一邊
    this.wallPile = (base + total) % 72;
    this.singleLayerTop = true;
  }

  /** 牌牆剩餘張數 */
  get wallCount(): number {
    return 144 - this.wallRemoved.size;
  }

  /** 第 pile 棟（0..71）的底層/上層牌 k 值 */
  private pileKs(pile: number): [number, number] {
    const side = Math.floor(pile / 18);
    const i = pile % 18;
    return [side * 36 + i, side * 36 + 18 + i];
  }

  /** 牌牆幾何參數（takeWallGroup 與 rebuildWall 共用，確保索引一致）
   * 每邊 18 棟（共 144 張 = 4 邊 × 18 棟 × 2 層），標準港式牌牆
   * 棟索引沿順時針連續：北(上)左→右、東(右)上→下、南(下)右→左、西(左)下→上 */
  private wallGeo() {
    const tileW = 0.26;
    const half = 9 * tileW;   // 中心到邊距離
    const hs = 8.5 * tileW;   // 18 棟跨半寬（保持 18 棟/邊）
    // 風車式布局：每邊兩端各縮 gap/2，四角缺口均勻對稱
    const gap = 2 * tileW;
    // base = 該邊第 0 棟（順時針起點，已含縮進），axis = 順時針方向
    const sides = [
      { base: new THREE.Vector3(-hs + gap / 2, 0, -half), axis: new THREE.Vector3(1, 0, 0),  rot: 0 },            // 北：左→右
      { base: new THREE.Vector3(half, 0, -hs + gap / 2),  axis: new THREE.Vector3(0, 0, 1),  rot: Math.PI / 2 }, // 東：上→下
      { base: new THREE.Vector3(hs - gap / 2, 0, half),   axis: new THREE.Vector3(-1, 0, 0), rot: 0 },            // 南：右→左
      { base: new THREE.Vector3(-half, 0, hs - gap / 2),  axis: new THREE.Vector3(0, 0, -1), rot: Math.PI / 2 }, // 西：下→上
    ];
    return { tileW, half, sides };
  }

  /** 第 k 張牌（0..143，順序：每邊先底層 18 張再上層 18 張）的世界座標 */
  private wallTilePos(k: number): THREE.Vector3 {
    const { tileW, sides } = this.wallGeo();
    const side = Math.floor(k / 36); // 每邊 36 張
    const inSide = k % 36;
    const layer = Math.floor(inSide / 18); // 0=底層 18 張，1=上層 18 張
    const i = inSide % 18;
    const s = sides[side];
    const off = i * tileW; // 從該邊順時針起點第 0 棟開始
    return s.base.clone().add(s.axis.clone().multiplyScalar(off)).setY(WALL_Y0 + layer * WALL_LAYER);
  }

  /** 從牌牆當前棟拿走 count 張，返回被拿走牌的位置（供發牌動畫起點）
   * count=4 時：2 棟 × 2 層（沿順時針方向）
   * count=1 時：單張，按「上、下、上、下」交替層 */
  takeWallGroup(count: number): THREE.Vector3[] {
    const positions: THREE.Vector3[] = [];
    if (this.wallRemoved.size >= 144) return positions;
    if (count === 4) {
      // 2 棟 × 2 層
      for (const pile of [this.wallPile, (this.wallPile + 1) % 72]) {
        const [kb, kt] = this.pileKs(pile);
        for (const k of [kb, kt]) {
          if (!this.wallRemoved.has(k)) {
            this.wallRemoved.add(k);
            positions.push(this.wallTilePos(k));
          }
        }
      }
      this.wallPile = (this.wallPile + 2) % 72;
    } else {
      // 單張：按上、下、上、下交替層
      const pile = this.wallPile;
      const [kb, kt] = this.pileKs(pile);
      const k = this.singleLayerTop ? kt : kb;
      if (!this.wallRemoved.has(k)) {
        this.wallRemoved.add(k);
        positions.push(this.wallTilePos(k));
      }
      // 該棟兩層都取完才推進到下一棟
      if (this.wallRemoved.has(kb) && this.wallRemoved.has(kt)) {
        this.wallPile = (pile + 1) % 72;
      }
      this.singleLayerTop = !this.singleLayerTop;
    }
    this.rebuildWall();
    return positions;
  }

  private rebuildWall() {
    if (this.wallGroup) {
      this.scene.remove(this.wallGroup);
      this.wallGroup = null;
    }
    if (this.wallRemoved.size >= 144) return;

    const g = new THREE.Group();
    const scale = WALL_SCALE;
    const { sides } = this.wallGeo();
    // 保留未被拿走的牌（共 144 張 = 4 邊 × 18 棟 × 2 層）
    for (let k = 0; k < 144; k++) {
      if (this.wallRemoved.has(k)) continue;
      const m = this.makeTileMesh(null, false);
      m.scale.setScalar(scale);
      m.position.copy(this.wallTilePos(k));
      // 牌背朝上
      m.rotation.x = Math.PI / 2;
      // 朝向：根據所在邊旋轉
      const side = Math.floor(k / 36);
      m.rotation.z = sides[side].rot;
      g.add(m);
    }
    this.scene.add(g);
    this.wallGroup = g;
  }

  /** 依視窗比例調整相機距離：桌面四角連同留白都要入鏡，窄窗自動拉遠。
   *  垂直 FOV 固定，故只需沿 z 退；先假定基準距離，不夠再逐段後退（最多 60 段）。 */
  private fitCamera() {
    const corners: [number, number][] = [
      [-this.tableHalf, this.tableNearDist], [this.tableHalf, this.tableNearDist],
      [-this.tableHalf, -this.tableFarDist], [this.tableHalf, -this.tableFarDist],
    ];
    const aim = (d: number) => {
      this.camera.position.set(0, BoardRenderer.CAM_HEIGHT, d);
      this.camera.lookAt(0, 0, BoardRenderer.CAM_TARGET_Z);
      this.camera.updateMatrixWorld(true);
      let worst = 0;
      for (const [x, z] of corners) {
        const v = new THREE.Vector3(x, 0, z).project(this.camera);
        worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
      }
      return worst;
    };
    let d = BoardRenderer.CAM_BASE_DIST;
    for (let i = 0; i < 60 && aim(d) > 0.95; i++) d += 0.4;
    aim(d);
  }

  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.fitCamera();
  };

  /** 玩家0 點擊偵測：命中手牌 → onTileClick；命中桌面 → onBlankClick（摸牌）；
   *  點到其他物件（對手牌、牌牆、骰子等）一律無效 */
  private onPointerDown = (ev: PointerEvent) => {
    if (!this.onTileClick && !this.onBlankClick) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // 1) 玩家0 手牌（最前層優先）：用固定 hitbox 檢測，覆蓋原始與抬高後兩個位置
    if (this.onTileClick && this.hand0Entries.length > 0) {
      const hits = this.raycaster.intersectObjects(
        this.hand0Entries.map((e) => e.hit), false);
      if (hits.length > 0) {
        const entry = this.hand0Entries.find((e) => e.hit === (hits[0].object as THREE.Mesh));
        if (entry) {
          this.onTileClick(entry.index, entry.tile);
          return;
        }
      }
    }
    // 2) 桌面：只有點到桌面才算摸牌（方位標記也算桌面的一部分，點到字不影響摸牌）
    if (this.onBlankClick && this.tableMesh) {
      const hits = this.raycaster.intersectObjects([this.tableMesh, ...this.windLabels], false);
      if (hits.length > 0) {
        this.onBlankClick();
        return;
      }
    }
    // 3) 其他位置（對手牌、牌牆、骰子、背景）：無效點擊
  };

  /** 更新指針的 NDC 座標 */
  private updatePointer(ev: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /** 懸停偵測：滑鼠移到玩家0 手牌上時點亮該牌（發光 + 微抬 + 手型指標）
   *  用固定 hitbox 檢測，滑鼠停在原始位置或抬高後位置都會命中 */
  private onPointerMove = (ev: PointerEvent) => {
    this.updatePointer(ev);
    let target: THREE.Mesh | null = null;
    if (this.hand0Entries.length > 0) {
      const hits = this.raycaster.intersectObjects(
        this.hand0Entries.map((e) => e.hit), false);
      if (hits.length > 0) {
        const entry = this.hand0Entries.find((e) => e.hit === (hits[0].object as THREE.Mesh));
        if (entry) target = entry.mesh;
      }
    }
    if (target === this.hoveredTile) return;
    // 取消舊的懸停
    if (this.hoveredTile) this.setTileHighlight(this.hoveredTile, false);
    // 設新的懸停
    this.hoveredTile = target;
    if (target) this.setTileHighlight(target, true);
    // 滑鼠移到可點的手牌上時顯示手型指標
    this.renderer.domElement.style.cursor = target ? 'pointer' : 'default';
  };

  private onPointerLeave = () => {
    if (this.hoveredTile) this.setTileHighlight(this.hoveredTile, false);
    this.hoveredTile = null;
    this.renderer.domElement.style.cursor = 'default';
  };

  /** 建立不可見的選牌 hitbox：固定覆蓋「原始位置 + 抬高後位置」的整段高度，
   *  使選牌區域不隨懸停移動。寬度=牌寬（與間距貼齊，不與相鄰牌重疊） */
  private makeHitBox(x: number, z: number, tileScale: number): THREE.Mesh {
    const halfTileH = (TILE_H * tileScale) / 2;
    const baseY = STAND_Y;        // 原始中心（牌底貼桌面）
    const raisedY = STAND_Y + 0.14; // 抬高後中心（取最大抬高值，涵蓋懸停與高亮）
    const bottom = baseY - halfTileH;
    const top = raisedY + halfTileH;
    const height = top - bottom;
    const centerY = (top + bottom) / 2;
    const geo = new THREE.BoxGeometry(TILE_W * tileScale, height, TILE_D * tileScale);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const hit = new THREE.Mesh(geo, mat);
    hit.position.set(x, centerY, z);
    return hit;
  }

  /** 點亮/取消點亮一張手牌（ emissive 發光 + 微微抬高） */
  private setTileHighlight(mesh: THREE.Mesh, on: boolean) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std.emissive) {
        std.emissive.setHex(on ? 0xffd700 : 0x000000);
        std.emissiveIntensity = on ? 0.55 : 0;
      }
    }
    // 懸停時微微抬高（手牌基準 y=STAND_Y，點亮時升到 STAND_Y+0.12）
    mesh.position.y = on ? STAND_Y + 0.12 : STAND_Y;
  }

  private buildTable() {
    // 桌面 8.2 × 8.2 正方形：亮牌外推 0.3 + 副露列距 0.5 後，牌佔地為對稱的 ±3.944，留 0.156 餘量。
    const nearZ = 4.1;      // 靠近玩家一側桌緣
    const farZ = -4.1;      // 對家一側桌緣
    const sizeX = 8.2;      // 左右寬度（亮牌最遠 ±3.944）
    const sizeZ = nearZ - farZ;        // 8.2
    const centerZ = (nearZ + farZ) / 2; // 0
    // 記錄各家桌沿距中心的距離，供方位標記定位
    this.tableNearDist = nearZ;
    this.tableFarDist = -farZ;
    this.tableHalf = sizeX / 2;
    const tableGeo = new THREE.BoxGeometry(sizeX, 0.3, sizeZ);
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x1a6b4a, roughness: 0.8 });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.position.set(0, -0.15, centerZ);
    table.receiveShadow = true;
    this.scene.add(table);
    this.tableMesh = table;

    // 桌面邊框
    const frameGeo = new THREE.BoxGeometry(sizeX + 0.4, 0.25, sizeZ + 0.4);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0e4d36, roughness: 0.9 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, -0.27, centerZ);
    this.scene.add(frame);

    // 東南西北方位標記（平放桌面）
    this.buildWindLabels();
  }

  // 東南西北方位標記：平放桌面，放在各家「正前方、橫向置中、貼近桌沿」的位置
  // 港式門風逆時針（與指南針相反）：0=你(東/下)，1=右家(南/右)，2=對家(西/上)，3=左家(北/左)
  //
  // 朝向：各家「朝向自己」——字頭指向桌心（該家的反方向），該家低頭讀自己那個字是正的，
  //       與真實牌桌一致。平放桌上「字頭远离讀者才可讀」，故 head = -dir（中心→該家）。
  //       玩家0 的字頭 = -z = 螢幕上方，所以自己那個字在本視角仍正立；
  //       對家的字在本視角上下顛倒、左右兩家的字橫向 90°，這正是各家看各家的效果。
  //
  // 尺寸/距離以「14 張手牌 + 24 張弃牌 + 4 組槓 + 8 張花牌 + 144 張牌牆」的最壞情況逐張算
  // AABB 驗證過：四家標記皆落在桌面內、被牌遮擋數 0、四角全在畫面內。
  // 統一 0.6×0.6 正方形；中心距桌沿：左右兩家與對家 0.45，玩家0 為 0.80。
  // 玩家0 多留 0.35 是為了避開 UI：桌緣 4.1 時若 inset 0.45，該字落在螢幕下方
  // 172~230px，正好被 info-bar（bottom:170px）壓住；inset 0.80 時落在 212~266px，
  // 位於 info-bar（170~202px）之上、手牌（290~314px）之下，兩邊都不碰。
  private buildWindLabels() {
    const texts = ['東', '南', '西', '北'];
    const planeSize = 0.6;      // 正方形：高度軸→世界 z、寬度軸→世界 x
    const insets = [0.8, 0.45, 0.45, 0.45]; // 各家中心距桌沿的距離
    for (let p = 0; p < 4; p++) {
      const { pos } = this.getPlayerPos(p);
      // 該家軸向單位向量（中心→該家）與該家桌沿距中心的距離
      const dir = pos.clone().setY(0).normalize();
      const edge =
        p === 0 ? this.tableNearDist :
        p === 2 ? this.tableFarDist :
        this.tableHalf;
      const at = dir.clone().multiplyScalar(edge - insets[p]);
      at.y = 0.012; // 貼在桌面（桌面頂 y=0）之上，避免與桌面閃爍
      const label = this.makeFlatTextPlane(texts[p], 0xd4af37, 72, planeSize, planeSize, false);
      label.rotation.x = -Math.PI / 2; // 平放：此時字頭朝 -z、寬度軸朝 +x
      // 各家朝向自己：字頭轉向桌心（= 該家的反方向），該家低頭讀就是正的。
      // 平放桌上「字頭远离讀者才可讀」，故 head = -dir；繞世界 Y 軸 θ=atan2(dir.x, dir.z)
      // 可把字頭由 -z 转到 -dir（東 0、南 π/2、西 π、北 -π/2）。
      // 與莊家「莊」标记同一套約定（setDealer 用 atan2(toDealer.x, toDealer.z)）。
      label.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.atan2(dir.x, dir.z));
      label.position.copy(at);
      this.scene.add(label);
      this.windLabels.push(label);
    }
  }

  // ===== 3D 骰子 =====

  // 點數紋理（1-6）
  private makeDiceFaceTexture(pips: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f8f4e8';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#c8b890';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 120, 120);
    // 點位佈局
    const layouts: Record<number, [number, number][]> = {
      1: [[64, 64]],
      2: [[38, 38], [90, 90]],
      3: [[38, 38], [64, 64], [90, 90]],
      4: [[38, 38], [90, 38], [38, 90], [90, 90]],
      5: [[38, 38], [90, 38], [64, 64], [38, 90], [90, 90]],
      6: [[38, 34], [90, 34], [38, 64], [90, 64], [38, 94], [90, 94]],
    };
    ctx.fillStyle = '#1a1a1a';
    for (const [x, y] of layouts[pips] ?? []) {
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return tex;
  }

  private makeDiceMesh(value: number): THREE.Mesh {
    const size = 0.25;
    const geo = new THREE.BoxGeometry(size, size, size);
    // 面順序：+x, -x, +y, -y, +z, -z
    // 對面之和 = 7：1-6, 2-5, 3-4
    const faces = [
      this.makeDiceFaceTexture(2), // +x
      this.makeDiceFaceTexture(5), // -x
      this.makeDiceFaceTexture(3), // +y
      this.makeDiceFaceTexture(4), // -y
      this.makeDiceFaceTexture(1), // +z
      this.makeDiceFaceTexture(6), // -z
    ];
    const mats = faces.map(
      (tex) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 })
    );
    const mesh = new THREE.Mesh(geo, mats);
    mesh.castShadow = true;
    // 讓 value 面朝上（+y）：找到 value 所在面，旋轉 mesh
    const faceOfValue: Record<number, number> = { 1: 4, 2: 0, 3: 2, 4: 3, 5: 1, 6: 5 };
    const fi = faceOfValue[value];
    // 右手定則：繞 +x +90° 使 +z→-y；繞 +z +90° 使 +x→+y
    const rotations: Record<number, [number, number, number]> = {
      0: [0, 0, Math.PI / 2],    // +x → +y（繞 z 軸 +90°）
      1: [0, 0, -Math.PI / 2],   // -x → +y（繞 z 軸 -90°）
      2: [0, 0, 0],              // +y → +y
      3: [Math.PI, 0, 0],        // -y → +y（繞 x 軸 180°）
      4: [-Math.PI / 2, 0, 0],   // +z → +y（繞 x 軸 -90°）
      5: [Math.PI / 2, 0, 0],    // -z → +y（繞 x 軸 +90°）
    };
    const [rx, ry, rz] = rotations[fi];
    mesh.rotation.set(rx, ry, rz);
    return mesh;
  }

  /** 顯示 3 顆骰子並播放滾動動畫 */
  showDice(values: [number, number, number], onDone: () => void) {
    this.clearDice();
    const g = new THREE.Group();
    // 骰子放在桌面中央，整局保留
    const baseX = -0.3;
    // 目標四元數（value 面朝上）
    const targetQuats: THREE.Quaternion[] = [];
    for (let i = 0; i < 3; i++) {
      const mesh = this.makeDiceMesh(1 + Math.floor(Math.random() * 6));
      mesh.position.set(baseX + i * 0.32, DICE_Y, 0);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      g.add(mesh);
      this.diceMeshes.push(mesh);
      targetQuats.push(this.makeDiceMesh(values[i]).quaternion.clone());
    }
    this.scene.add(g);
    this.diceGroup = g;

    // 滾動動畫：隨機旋轉 0.9 秒，最後 0.3 秒平滑定格
    const start = performance.now();
    const dur = 1200;
    const animate = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      this.diceMeshes.forEach((mesh, i) => {
        if (t < 0.7) {
          // 隨機滾動
          mesh.rotation.x += 0.28;
          mesh.rotation.y += 0.22;
          mesh.rotation.z += 0.18;
          mesh.position.y = DICE_Y + Math.abs(Math.sin(now * 0.015 + i * 2)) * 0.09;
        } else {
          // 平滑插值到目標朝向
          const k = (t - 0.7) / 0.3;
          mesh.quaternion.slerpQuaternions(
            mesh.quaternion,
            targetQuats[i],
            Math.min(k * 2.5, 1)
          );
          mesh.position.y = DICE_Y;
        }
      });
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        this.diceMeshes.forEach((mesh, i) => {
          mesh.quaternion.copy(targetQuats[i]);
          mesh.position.y = DICE_Y;
        });
        onDone();
      }
    };
    requestAnimationFrame(animate);
  }

  clearDice() {
    if (this.diceGroup) {
      this.scene.remove(this.diceGroup);
      this.diceGroup = null;
    }
    this.diceMeshes = [];
  }

  // 莊家標記：金色「莊」字，平放桌面、放在骰子朝向莊家的一側（字頭朝莊家，莊家低頭可讀）
  setDealer(p: number) {
    if (this.dealerMarker) {
      this.scene.remove(this.dealerMarker);
      this.dealerMarker = null;
    }
    const { pos } = this.getPlayerPos(p);
    // 骰子在桌面中央 (≈0,0)，朝向莊家的方向 = 莊家位置方向（水平）
    const toDealer = new THREE.Vector3(pos.x, 0, pos.z).normalize();
    const marker = this.makeFlatTextPlane('莊', 0xffd700, 72, 0.55);
    // 平放桌面（面朝上）
    marker.rotation.x = -Math.PI / 2;
    // 平放後字頭朝 -z；旋轉使「字底」朝莊家（字頭朝外，莊家看到的字是倒的，符合牌桌習慣）
    marker.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.atan2(toDealer.x, toDealer.z));
    // 放在骰子前（朝莊家偏移 0.62，避開骰子佔位 x∈[-0.42,0.46]）
    marker.position.copy(toDealer).multiplyScalar(0.62);
    marker.position.y = 0.02;
    this.scene.add(marker);
    this.dealerMarker = marker;
  }

  /** 建立平放的文字平面（canvas 貼圖 + PlaneGeometry），供桌面標記用
   *  planeW / planeH 可不等（長方形貼紙）；canvas 依比例生成，避免文字被拉伸變形
   *  withBg=false 時不畫金色圓底，只留文字（方位標記用） */
  private makeFlatTextPlane(
    text: string, color: number, fontSize = 48, planeW = 0.5, planeH = planeW, withBg = true
  ): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = Math.max(32, Math.round(128 * (planeH / planeW)));
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext('2d')!;
    if (withBg) {
      // 淡金色圓/橢圓底，讓字在綠色桌面上更醒目
      ctx.fillStyle = 'rgba(212,175,55,0.22)';
      ctx.beginPath();
      ctx.ellipse(cw / 2, ch / 2, cw / 2 - 6, ch / 2 - 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.font = `bold ${fontSize}px "Noto Sans TC", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2);
    const tex = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(planeW, planeH);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    return new THREE.Mesh(geo, mat);
  }

  private buildLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xfff4e0, 1.0);
    dir.position.set(4, 8, 3);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -8;
    dir.shadow.camera.right = 8;
    dir.shadow.camera.top = 8;
    dir.shadow.camera.bottom = -8;
    this.scene.add(dir);
    const point = new THREE.PointLight(0xffe9c0, 0.5, 20);
    point.position.set(0, 4, 0);
    this.scene.add(point);
  }

  // ===== 參考圖牌面切圖 =====
  private refImg: HTMLImageElement | null = null;
  private refLoaded: Promise<void> | null = null;

  /** 載入參考圖（5 行 × 9 列網格，每格約 213×288 px） */
  private loadRefImage(): Promise<void> {
    if (this.refLoaded) return this.refLoaded;
    this.refLoaded = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { this.refImg = img; resolve(); };
      img.onerror = () => resolve(); // 載入失敗時退回文字牌面
      img.src = '/src/assets/mahjong_ref.jpg';
    });
    return this.refLoaded;
  }

  /** 從參考圖切出指定格的牌面，繪製到 128×170 canvas
   * row: 0=筒, 1=條, 2=萬, 3=字牌(1-7), 4=花牌(1-8) */
  private cropRefTile(_canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, row: number, col: number) {
    if (!this.refImg) return;
    const img = this.refImg;
    const cellW = img.width / 9;
    const cellH = img.height / 5;
    // 切出格子內側（去掉牌間縫隙）
    const sx = col * cellW + cellW * 0.04;
    const sy = row * cellH + cellH * 0.04;
    const sw = cellW * 0.92;
    const sh = cellH * 0.92;
    ctx.fillStyle = '#faf6ec';
    ctx.fillRect(0, 0, 128, 170);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 128, 170);
  }

  // 生成牌面紋理（從參考圖切牌面 + 綠色條紋牌背）
  private makeTileTexture(tile: TileDef | null): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 170;
    const ctx = canvas.getContext('2d')!;

    if (tile) {
      // 從參考圖切牌面（已載入時），否則用文字
      const useRef = this.refImg !== null;
      if (useRef) {
        let row = -1, col = -1;
        if (tile.suit === 'p') { row = 0; col = tile.rank - 1; }
        else if (tile.suit === 's') { row = 1; col = tile.rank - 1; }
        else if (tile.suit === 'm') { row = 2; col = tile.rank - 1; }
        else if (tile.suit === 'z') { row = 3; col = tile.rank - 1; }
        else if (tile.suit === 'f') { row = 4; col = tile.rank - 1; }
        this.cropRefTile(canvas, ctx, row, col);
      } else {
        this.drawTextFace(ctx, tile);
      }
    } else {
      // 牌背：綠色條紋（模擬光滑塑料質感）
      ctx.fillStyle = '#3a9d4a';
      ctx.fillRect(0, 0, 128, 170);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      for (let y = 4; y < 170; y += 6) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(128, y);
        ctx.stroke();
      }
      const bgrad = ctx.createLinearGradient(0, 0, 0, 170);
      bgrad.addColorStop(0, 'rgba(255,255,255,0.3)');
      bgrad.addColorStop(0.2, 'rgba(255,255,255,0)');
      bgrad.addColorStop(1, 'rgba(0,0,0,0.15)');
      ctx.fillStyle = bgrad;
      ctx.fillRect(0, 0, 128, 170);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 8;
    return tex;
  }

  /** 生成單張牌的牌面圖（data URL），供 2D UI（如胡牌結算面板）使用
   *  參考圖已載入時用真實牌面切圖，否則退回文字牌面 */
  tileFaceDataUrl(tile: TileDef): string {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 170;
    const ctx = canvas.getContext('2d')!;
    const useRef = this.refImg !== null;
    if (useRef) {
      let row = -1, col = -1;
      if (tile.suit === 'p') { row = 0; col = tile.rank - 1; }
      else if (tile.suit === 's') { row = 1; col = tile.rank - 1; }
      else if (tile.suit === 'm') { row = 2; col = tile.rank - 1; }
      else if (tile.suit === 'z') { row = 3; col = tile.rank - 1; }
      else if (tile.suit === 'f') { row = 4; col = tile.rank - 1; }
      this.cropRefTile(canvas, ctx, row, col);
    } else {
      this.drawTextFace(ctx, tile);
    }
    return canvas.toDataURL('image/png');
  }

  /** 文字牌面（參考圖載入前的備選） */
  private drawTextFace(ctx: CanvasRenderingContext2D, tile: TileDef) {
    ctx.fillStyle = '#faf6ec';
    ctx.fillRect(0, 0, 128, 170);
    ctx.textAlign = 'center';
    if (tile.suit === 'f') {
      ctx.fillStyle = tile.rank <= 4 ? '#c0392b' : '#1e8449';
      ctx.font = 'bold 76px "Noto Sans TC", serif';
      ctx.fillText(FLOWER_NAMES[tile.rank], 64, 110);
    } else if (tile.suit === 'z') {
      let color = '#1a1a1a';
      if (tile.rank === 5) color = '#c0392b';
      else if (tile.rank === 6) color = '#1e8449';
      else if (tile.rank === 7) color = '#555';
      ctx.fillStyle = color;
      if (tile.rank === 7) {
        ctx.strokeStyle = '#8a8a8a';
        ctx.lineWidth = 6;
        ctx.strokeRect(34, 45, 60, 80);
      } else {
        ctx.font = 'bold 76px "Noto Sans TC", serif';
        ctx.fillText(HONOR_NAMES[tile.rank], 64, 110);
      }
    } else {
      const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九'][tile.rank - 1];
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 58px "Noto Sans TC", serif';
      ctx.fillText(cn, 64, 74);
      const suitChar = tile.suit === 'm' ? '萬' : tile.suit === 'p' ? '筒' : '條';
      ctx.fillStyle = tile.suit === 'm' ? '#c0392b' : tile.suit === 'p' ? '#2471a3' : '#1e8449';
      ctx.font = 'bold 50px "Noto Sans TC", serif';
      ctx.fillText(suitChar, 64, 140);
    }
  }

  private makeTileMesh(tile: TileDef | null, _faceUp = true): THREE.Mesh {
    // 圓角牌：RoundedBoxGeometry（光滑瓷質風格）
    const radius = Math.min(TILE_D, 0.1) * 0.5;
    const geo = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_D, 5, radius);
    const faceTex = this.makeTileTexture(tile);
    const backTex = this.makeTileTexture(null);
    // 光滑瓷質材質：低粗糙度 + 高金屬度模擬高光
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e0, roughness: 0.15, metalness: 0.05 });
    const mats = [
      sideMat, sideMat, // left, right
      sideMat, sideMat, // top, bottom
      new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.12, metalness: 0.05 }), // front
      new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.12, metalness: 0.05 }), // back
    ];
    const mesh = new THREE.Mesh(geo, mats);
    mesh.castShadow = true;
    return mesh;
  }

  // 玩家位置/朝向（在牌牆外側）
  getPlayerPos(p: number): { pos: THREE.Vector3; rotY: number } {
    const R = 3.0; // 玩家距中心距離（牌牆半寬 2.38 之外）
    switch (p) {
      case 0: return { pos: new THREE.Vector3(0, 0, R), rotY: 0 };
      case 1: return { pos: new THREE.Vector3(R, 0, 0), rotY: Math.PI / 2 };
      case 2: return { pos: new THREE.Vector3(0, 0, -R), rotY: Math.PI };
      default: return { pos: new THREE.Vector3(-R, 0, 0), rotY: -Math.PI / 2 };
    }
  }

  // 渲染玩家手牌（玩家0立起朝上，其他立起顯示牌背）
  renderHand(p: number, hand: TileDef[], highlight: Set<number> = new Set()) {
    // 移除該玩家的舊手牌 mesh
    const toRemove: number[] = [];
    for (const k of this.tileMeshes.keys()) {
      if (Math.floor(k / 1000) === p) toRemove.push(k);
    }
    for (const k of toRemove) {
      this.scene.remove(this.tileMeshes.get(k)!);
      this.tileMeshes.delete(k);
    }

    const { pos, rotY } = this.getPlayerPos(p);
    const faceUp = p === 0;
    const n = hand.length;
    const tileScale = 0.36; // 牌縮放
    // 牌實際寬 = TILE_W(0.6) × 0.36 = 0.216，間距貼齊
    const spacing = TILE_W * tileScale;
    const totalW = (n - 1) * spacing;

    // 排列方向（垂直於玩家朝向）
    const toCenter = new THREE.Vector3(-pos.x, 0, -pos.z).normalize();
    const perp = new THREE.Vector3(-toCenter.z, 0, toCenter.x);

    // 玩家0 的手牌 mesh 供射線偵測（每次重建）
    if (p === 0) {
      // 移除舊 hitbox（不可見選牌區域）
      for (const e of this.hand0Entries) this.scene.remove(e.hit);
      this.hand0Entries = [];
      // 手牌重繪後舊 mesh 已移除：清掉懸停狀態，避免殘留發光
      if (this.hoveredTile) {
        this.setTileHighlight(this.hoveredTile, false);
        this.hoveredTile = null;
      }
    }

    hand.forEach((tile, i) => {
      const m = this.makeTileMesh(tile, faceUp);
      m.scale.setScalar(tileScale);
      const x = i * spacing - totalW / 2;
      if (faceUp) {
        // 自己手牌：立起，正面朝玩家（+z 方向），靠近玩家，簡單並列無側角度
        m.position.set(x, STAND_Y, pos.z - 0.22);
        m.rotation.y = 0;
        if (highlight.has(i)) m.position.y = STAND_Y + 0.14;
        // 不可見 hitbox：固定覆蓋「原始位置 + 抬高後位置」的整段，
        // 讓選牌區域不隨懸停移動——滑鼠停在原處或抬高處都能選中
        const hit = this.makeHitBox(x, pos.z - 0.22, tileScale);
        this.scene.add(hit);
        this.hand0Entries.push({ mesh: m, hit, index: i, tile });
      } else {
        // 對手手牌：立起，牌背朝玩家0，靠近對家
        m.position.copy(pos).add(toCenter.clone().multiplyScalar(0.28));
        m.position.y = STAND_Y;
        m.position.add(perp.clone().multiplyScalar(x));
        m.rotation.y = rotY;
      }
      this.scene.add(m);
      this.tileMeshes.set(p * 1000 + i, m as unknown as THREE.Group);
    });

    // 玩家0：計算手牌最右側牌的螢幕座標（供「摸牌」提示定位）
    if (p === 0 && this.hand0Entries.length > 0) {
      const last = this.hand0Entries[this.hand0Entries.length - 1].mesh;
      // 牌中心偏右半寬（TILE_W×0.36/2 ≈ 0.108），再留一點縫隙
      const v = last.position.clone();
      v.x += TILE_W * tileScale / 2 + 0.08;
      v.y += TILE_H * tileScale / 2; // 取牌的頂端，讓提示在牌上方右側
      const proj = v.project(this.camera);
      const w = this.renderer.domElement.clientWidth;
      const h = this.renderer.domElement.clientHeight;
      this.hand0RightScreen = { x: (proj.x * 0.5 + 0.5) * w, y: (-proj.y * 0.5 + 0.5) * h };
    }
  }

  /** 玩家0 手牌最右側的螢幕座標（相對 canvas 像素），無手牌時 null */
  getHand0RightScreen(): { x: number; y: number } | null {
    return this.hand0RightScreen;
  }

  /** 各家「說話氣泡」的錨點：桌面該家邊緣外的世界點投影到 canvas 像素。
   *  玩家0 往左偏 2.6 以避開底部置中的 UI 堆疊（手牌列/按鈕/info-bar）；
   *  上下家外推 1.1 以避開自家站立手牌；最後夾進畫面，窄屏時不溢出邊緣。 */
  seatHintScreenPos(p: number): { x: number; y: number } {
    const w = new THREE.Vector3();
    if (p === 0) w.set(-2.6, 0, this.tableNearDist + 1.1);
    else if (p === 1) w.set(this.tableHalf + 0.6, 0, 0);
    else if (p === 2) w.set(0, 0, -(this.tableFarDist + 1.1));
    else w.set(-(this.tableHalf + 0.6), 0, 0);
    const proj = w.project(this.camera);
    const cw = this.renderer.domElement.clientWidth;
    const ch = this.renderer.domElement.clientHeight;
    // 氣泡寬約 128px（含尾巴），中心至少留 78px 才不會溢出畫面
    const margin = 78;
    const x = Math.min(Math.max((proj.x * 0.5 + 0.5) * cw, margin), cw - margin);
    const y = Math.min(Math.max((-proj.y * 0.5 + 0.5) * ch, margin), ch - margin);
    return { x, y };
  }

  // 渲染打出的牌（中央區域，兩行排列，每行最多 12 張）
  renderDiscards(p: number, discards: TileDef[], _highlightLast = false) {
    // 先移除該玩家舊的 discard
    const oldGroup = this.discardGroups[p];
    if (oldGroup) {
      this.scene.remove(oldGroup);
      this.discardGroups[p] = null;
    }
    const g = new THREE.Group();
    const { pos, rotY } = this.getPlayerPos(p);
    const toCenter = new THREE.Vector3(-pos.x, 0, -pos.z).normalize();
    const perp = new THREE.Vector3(-toCenter.z, 0, toCenter.x);
    const tileScale = 0.36;
    const spacing = TILE_W * tileScale; // 無間距貼齊
    const perRow = 12; // 每行最多 12 張
    // 第一行中心沿 toCenter 方向 1.25，第二行 1.6（更靠中間）
    const rowOffsets = [1.25, 1.6];
    discards.forEach((tile, i) => {
      const m = this.makeTileMesh(tile, true);
      m.scale.setScalar(tileScale);
      const row = Math.floor(i / perRow);      // 0 或 1
      const col = i % perRow;                   // 0..11
      const rowOff = rowOffsets[Math.min(row, 1)];
      const colOff = (col - (perRow - 1) / 2) * spacing;
      m.position.copy(pos).add(toCenter.clone().multiplyScalar(rowOff));
      m.position.y = FLAT_Y;
      m.position.add(perp.clone().multiplyScalar(colOff));
      // 牌面朝上
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rotY + Math.PI;
      g.add(m);
    });
    this.scene.add(g);
    this.discardGroups[p] = g;
  }

  // 渲染吃碰槓（放在玩家手牌的左下方）
  renderMelds(p: number, melds: { type: string; tiles: TileDef[]; concealed?: boolean }[]) {
    const oldGroup = this.meldGroups[p];
    if (oldGroup) {
      this.scene.remove(oldGroup);
      this.meldGroups[p] = null;
    }
    const g = new THREE.Group();
    const { pos, rotY } = this.getPlayerPos(p);
    const toCenter = new THREE.Vector3(-pos.x, 0, -pos.z).normalize();
    const perp = new THREE.Vector3(-toCenter.z, 0, toCenter.x); // 玩家视角的「右」
    // 放在玩家左手邊角落（-perp = 左），2×2 網格排列（每列最多 2 組），
    // inwardOffset=-0.35：亮牌往該家方向外推。相機降到 6.6 後，對家副露近排又會被
    // 對家手牌擋住 3 張；外推 0.35 越過手牌頂部，四家亮牌遮擋歸零（0.3 在 6.6 下擋 3 張）。
    // 佔地最遠端 = 玩家距心 3.0 + 外推 + rowGap + 半牌寬，與 cornerOffset 無關。
    const cornerOffset = 2.2;
    const inwardOffset = -0.35;
    // 角落起點（玩家左手邊桌角內側）
    const base = pos.clone()
      .add(perp.clone().multiplyScalar(-cornerOffset))    // 左
      .add(toCenter.clone().multiplyScalar(inwardOffset));// 向中心收進
    base.y = FLAT_Y;
    const tileScale = 0.36;
    const tileSpacing = TILE_W * tileScale; // 無間距貼齊
    const meldSpacing = tileSpacing * 3 + 0.06; // 各 meld 間距（3 張寬 + 小間隔，更緊湊）
    const rowGap = 0.5; // 前後兩列間距（牌高 0.288 + 0.212 縫隙；決定桌面最遠端）
    melds.forEach((meld, mi) => {
      const isKong = meld.type === 'kong';
      const n = isKong ? 4 : 3;
      // 暗槓（concealed）4 張牌面朝下；吃/碰/明槓牌面朝上
      const faceUp = !(isKong && meld.concealed);
      // 2×2 網格：每列 2 組（沿 +perp），第 3 組起換到更靠近玩家的一列（-toCenter）
      const col = Math.floor(mi / 2);
      const rowInCol = mi % 2;
      const c = base.clone()
        .add(perp.clone().multiplyScalar(rowInCol * meldSpacing + tileSpacing)) // 列內第 0/1 組
        .add(toCenter.clone().multiplyScalar(-col * rowGap));                    // 第 2 列往玩家方向
      for (let i = 0; i < n; i++) {
        const m = this.makeTileMesh(meld.tiles[i], faceUp);
        m.scale.setScalar(tileScale);
        const x = (i - (n - 1) / 2) * tileSpacing;
        m.position.copy(c);
        m.position.add(perp.clone().multiplyScalar(x));
        // 平放桌面，牌面朝上（或朝下）
        m.rotation.x = -Math.PI / 2;
        // 讓牌頭朝向該玩家（與打出的牌方向一致）
        m.rotation.z = rotY + Math.PI;
        m.position.y = FLAT_Y;
        g.add(m);
      }
    });
    this.scene.add(g);
    this.meldGroups[p] = g;
  }

  // 渲染花牌（放在玩家右手邊、比吃碰杠更靠近玩家的一排，牌面朝上）
  renderFlowers(p: number, flowers: TileDef[]) {
    const oldGroup = this.flowerGroups[p];
    if (oldGroup) {
      this.scene.remove(oldGroup);
      this.flowerGroups[p] = null;
    }
    if (flowers.length === 0) return;
    const g = new THREE.Group();
    const { pos, rotY } = this.getPlayerPos(p);
    const toCenter = new THREE.Vector3(-pos.x, 0, -pos.z).normalize();
    const perp = new THREE.Vector3(-toCenter.z, 0, toCenter.x); // 玩家视角的「右」
    // 放在玩家左手邊（與吃碰杠同側），但更靠近桌面中心的一行
    // 起點 (leftOffset=2.7) 需越過牌牆角落（牆邊 2.34、角落延伸約 2.47）。
    // inwardOffset=-0.05：與副露同步外推 0.35（原 0.3 向心 → -0.05）。四家同一套參數。
    const leftOffset = 2.7;
    const inwardOffset = -0.05;
    const base = pos.clone()
      .add(perp.clone().multiplyScalar(-leftOffset))    // 左（與吃碰杠同側）
      .add(toCenter.clone().multiplyScalar(inwardOffset)); // 向中心（內側第二行）
    base.y = FLAT_Y;
    const tileScale = 0.36;
    const tileSpacing = TILE_W * tileScale;
    // 每行 4 張、最多 2 行（第 2 行往該家方向外推 rowGap）。
    // 排成單行 8 張會把桌面撐大：玩家0 的花牌延伸到 x=-4.32、右家到 z=4.32。
    // 四家一律 2 行×4（對家原先的單行特例已移除：其副露 inwardOffset 改回 0 後，
    // 副露與花牌在該角落分別佔 x∈[0.944,2.516] 與 x∈[2.592,3.456]，互不重疊）。
    const perRow = 4;
    const rowGap = 0.5; // 與副露的第二列間距一致
    flowers.forEach((t, i) => {
      const m = this.makeTileMesh(t, true);
      m.scale.setScalar(tileScale);
      const col = Math.floor(i / perRow), rowInCol = i % perRow;
      const c = base.clone()
        .add(perp.clone().multiplyScalar(-rowInCol * tileSpacing))
        .add(toCenter.clone().multiplyScalar(-col * rowGap));
      m.position.copy(c);
      // 平放桌面，牌面朝上
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rotY + Math.PI;
      m.position.y = FLAT_Y;
      g.add(m);
    });
    this.scene.add(g);
    this.flowerGroups[p] = g;
  }

  /** 除錯用：返回場景中的物件數 */
  debugInfo() {
    let count = 0;
    this.scene.traverse(() => count++);
    return { sceneObjects: count, cameraPos: this.camera.position.toArray() };
  }

  // ===== 發牌動畫 =====

  /** 開始發牌：每次 4 張（兩層×每層 2 張）一組飛到一家，按 dealOrder 順序 */
  startDeal(players: TileDef[][], dealOrder: number[], onDone: () => void) {
    this.dealQueue = [];
    // dealOrder: 前 12 個是 4 張組（3 輪×4 家），後 4 個是 1 張
    for (let i = 0; i < 12; i++) {
      const p = dealOrder[i];
      const round = Math.floor(i / 4);
      this.dealQueue.push({ player: p, start: round * 4, count: 4 });
    }
    for (let i = 12; i < 16; i++) {
      const p = dealOrder[i];
      this.dealQueue.push({ player: p, start: 12, count: 1 });
    }
    this.playersRef = players;
    this.dealDone = onDone;
    this.dealStep();
  }

  private dealStep() {
    if (this.dealQueue.length === 0) {
      this.dealDone?.();
      return;
    }
    const { player, start, count } = this.dealQueue.shift()!;
    // 從牌牆拿走 count 張（count=4 時 2 張 × 2 層），返回實際位置
    const wallPositions = this.takeWallGroup(count);
    // 同時生成 count 張牌的飛行 mesh（起點用牌牆實際位置）
    // 飛行全程保持「平放、牌背朝上」（與牌牆姿勢一致），不做任何翻轉/立起動作，
    // 避免橫穿桌面中央時露出 NPC 牌面；到達手牌位置後由 renderHand 立起並擺正朝向。
    const meshes: THREE.Mesh[] = [];
    for (let k = 0; k < count; k++) {
      const index = start + k;
      // 落點用「本組落地後的手牌張數」做置中，與 renderHand(slice(0, start+count)) 的排布一致；
      // 若用整副手牌張數(13)，飛行的牌會先飛到 13 張的寬排布，落地後又被 renderHand 吸回緊湊排布 → 手牌跳動。
      const target = this.getHandTilePos(player, index, start + count);
      // 平放的牌兩面都朝上下，用 null 貼牌背即可（玩家0 也先用牌背，落座時才顯示牌面）
      const mesh = this.makeTileMesh(null, false);
      mesh.scale.setScalar(0.5);
      // 平放：牌背朝上（與牌牆 rebuildWall 的 rotation.x=π/2 同姿勢）
      mesh.rotation.x = Math.PI / 2;
      // 起點：牌牆實際位置（若有），否則用牌牆底層高度
      const startPos = wallPositions[k] ?? new THREE.Vector3(0, WALL_Y0, 0);
      mesh.position.copy(startPos);
      this.scene.add(mesh);
      meshes.push(mesh);
      (mesh as any).userData.target = target;
    }

    const startT = performance.now();
    const dur = 220; // 一組 220ms
    const animate = (now: number) => {
      const t = Math.min((now - startT) / dur, 1);
      const ease = t * (2 - t); // easeOut
      for (const mesh of meshes) {
        const target = (mesh as any).userData.target as THREE.Vector3;
        mesh.position.copy((mesh.userData.startPos as THREE.Vector3)).lerp(target, ease);
      }
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        for (const mesh of meshes) this.scene.remove(mesh);
        // 更新手牌顯示
        this.renderHand(player, this.playersRef[player].slice(0, start + count));
        setTimeout(() => this.dealStep(), 60);
      }
    };
    // 記錄起點
    for (const mesh of meshes) {
      mesh.userData.startPos = mesh.position.clone();
    }
    requestAnimationFrame(animate);
  }

  private getHandTilePos(p: number, index: number, total: number): THREE.Vector3 {
    const { pos } = this.getPlayerPos(p);
    const toCenter = new THREE.Vector3(-pos.x, 0, -pos.z).normalize();
    const perp = new THREE.Vector3(-toCenter.z, 0, toCenter.x);
    const spacing = p === 0 ? 0.36 : 0.28;
    const x = index * spacing - (total - 1) * spacing / 2;
    if (p === 0) return new THREE.Vector3(x, STAND_Y, pos.z - 0.25);
    const v = pos.clone().add(toCenter.clone().multiplyScalar(0.3));
    v.y = STAND_Y;
    v.add(perp.clone().multiplyScalar(x));
    return v;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.renderer.dispose();
  }
}
