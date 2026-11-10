// Fictional sport firearm definitions + procedural high-detail 3D models with gloved hands.
// All recoil/sway values are stylised game curves, not real-world performance data.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js';

export const OPTICS = {
  iron: { id: 'iron', name: 'MATCH IRON SIGHTS', kr: '기계식 조준기', type: 'iron', mags: [1] },
  diopter: { id: 'diopter', name: 'DIOPTER / GLOBE', kr: '디옵터 정밀 조준기', type: 'diopter', mags: [1] },
  rd1: { id: 'rd1', name: 'RD-1 RED DOT 1×', kr: '1배 도트 사이트', type: 'scope', mags: [1], lensR: 0.27, tube: 0.05, style: 'reddot', reticles: ['dot'] },
  ps2: { id: 'ps2', name: 'PS-2 PISTOL SCOPE 2×', kr: '2배 권총 스코프', type: 'scope', mags: [2], lensR: 0.3, tube: 0.08, style: 'pistol', reticles: ['duplex', 'fine', 'dot'] },
  lv14: { id: 'lv14', name: 'LV 1–4×24', kr: '저배율 가변 1–4배', type: 'scope', mags: [1, 2, 3, 4], lensR: 0.4, tube: 0.06, style: 'lpvo', reticles: ['dot', 'duplex', 'fine', 'mildot'] },
  mr312: { id: 'mr312', name: 'MR 3–12×44', kr: '중배율 가변 3–12배', type: 'scope', mags: [3, 4, 6, 8, 10, 12], lensR: 0.42, tube: 0.06, style: 'mid', reticles: ['duplex', 'mildot', 'fine', 'dot'] },
  fx6: { id: 'fx6', name: 'FX 6×42 FIXED', kr: '6배 고정', type: 'scope', mags: [6], lensR: 0.41, tube: 0.06, style: 'mid', reticles: ['duplex', 'fine', 'mildot'] },
  hx416: { id: 'hx416', name: 'HX 4–16×50', kr: '고배율 가변 4–16배', type: 'scope', mags: [4, 6, 8, 10, 12, 16], lensR: 0.44, tube: 0.055, style: 'big', reticles: ['mildot', 'fine', 'duplex', 'dot'] },
  hx816: { id: 'hx816', name: 'HX 8–16×56 COMPETITION', kr: '경기용 8–16배', type: 'scope', mags: [8, 10, 12, 16], lensR: 0.45, tube: 0.05, style: 'big', reticles: ['fine', 'mildot', 'dot'] },
};
export const RETICLES = { duplex: 'DUPLEX', mildot: 'MIL-DOT', fine: 'FINE CROSS', dot: 'CENTER DOT' };
export const RETICLE_COLORS = { black: 'BLACK', red: 'ILLUM. RED', green: 'ILLUM. GREEN' };
export const FINISHES = {
  graphite: { name: 'GRAPHITE', metal: 0x2a2c2f, metalRough: 0.38, metalness: 0.9, accent: 0x3b3f44 },
  titanium: { name: 'TITANIUM', metal: 0x9a9ea3, metalRough: 0.28, metalness: 1.0, accent: 0x6d7278 },
  royal: { name: 'ROYAL BLUE', metal: 0x1f2a44, metalRough: 0.3, metalness: 0.9, accent: 0x2457c5 },
  desert: { name: 'DESERT', metal: 0x9c8462, metalRough: 0.6, metalness: 0.25, accent: 0x7d6a4e },
  olive: { name: 'OLIVE', metal: 0x4c5238, metalRough: 0.6, metalness: 0.25, accent: 0x3e4430 },
};
export const STOCKS = {
  walnut: { name: 'WALNUT', tone: '#6a3f22', rough: 0.45 },
  laminate: { name: 'GREY LAMINATE', tone: '#5d6266', rough: 0.4 },
  synthetic: { name: 'SYNTHETIC', tone: null, rough: 0.7 },
};

export const WEAPONS = [
  {
    id: 'p10', name: 'SPORT P-10', cls: 'pistol', kr: '경기용 정밀 권총',
    desc: '가벼운 시각적 반동과 빠른 조준 복귀. 해부학적 그립의 경기용 반자동 정밀 권총. 입문자에게 추천.',
    stats: { difficulty: 2, stability: 6, recoil: 2, speed: 9 },
    mag: 10, action: 'semi', fireInterval: 0.2, triggerDelay: 0, reloadTime: 1.9,
    optics: ['iron', 'rd1'], adsZoom: 1.55, adsSpeed: 7.5,
    sway: { amp: 0.22, hip: 2.4, inertia: 1.0 },
    recoil: { pitch: 1.1, yaw: 0.25, shake: 0.5, k: 210, c: 22, model: 0.035, modelRot: 0.16, mk: 520, mc: 30, residual: 0.03, heat: 0.12 },
    hipSpread: 1.0, holeR: 0.0028, velocity: 330, faceStyle: 'pistol', handed: 'pistol',
  },
  {
    id: 'p20', name: 'SPORT P-20', cls: 'pistol', kr: '리볼버 스타일 스포츠 권총',
    desc: '방아쇠를 당기면 해머가 젖혀지고 실린더가 회전한 뒤 격발된다. 격발 타이밍을 읽는 것이 핵심.',
    stats: { difficulty: 5, stability: 5, recoil: 6, speed: 4 },
    mag: 6, action: 'revolver', fireInterval: 0.42, triggerDelay: 0.22, reloadTime: 2.8,
    optics: ['iron', 'ps2'], adsZoom: 1.55, adsSpeed: 6.5,
    sway: { amp: 0.26, hip: 2.4, inertia: 1.25 },
    recoil: { pitch: 2.6, yaw: 0.5, shake: 1.0, k: 120, c: 15, model: 0.05, modelRot: 0.38, mk: 300, mc: 20, residual: 0.06, heat: 0.22 },
    hipSpread: 1.2, holeR: 0.0045, velocity: 300, faceStyle: 'pistol', handed: 'pistol',
  },
  {
    id: 'r10', name: 'SPORT R-10', cls: 'rifle', kr: '경기용 소총',
    desc: '알루미늄 섀시와 디옵터·글로브 조준기를 갖춘 정밀 경기용 소총. 흔들림이 작고 중거리에 특화.',
    stats: { difficulty: 4, stability: 8, recoil: 2, speed: 6 },
    mag: 10, action: 'single', fireInterval: 0.55, triggerDelay: 0, reloadTime: 2.2,
    optics: ['diopter'], adsZoom: 2.1, adsSpeed: 5,
    sway: { amp: 0.1, hip: 3.0, inertia: 1.6 },
    recoil: { pitch: 0.55, yaw: 0.12, shake: 0.35, k: 150, c: 18, model: 0.02, modelRot: 0.05, mk: 400, mc: 28, residual: 0.015, heat: 0.06 },
    hipSpread: 1.8, holeR: 0.0028, velocity: 330, faceStyle: 'rifle', handed: 'rifle',
  },
  {
    id: 'r20', name: 'SPORT R-20', cls: 'rifle', kr: '광학 조준경 스포츠 소총',
    desc: '피카티니 레일에 다양한 광학 조준경을 장착할 수 있는 반자동 스포츠 소총. 원거리 표적에 적합.',
    stats: { difficulty: 5, stability: 7, recoil: 4, speed: 7 },
    mag: 10, action: 'semi', fireInterval: 0.3, triggerDelay: 0, reloadTime: 2.3,
    optics: ['mr312', 'lv14', 'fx6'], adsZoom: 1.2, adsSpeed: 4.6,
    sway: { amp: 0.075, hip: 3.2, inertia: 1.8 },
    recoil: { pitch: 1.4, yaw: 0.35, shake: 0.8, k: 110, c: 14, model: 0.045, modelRot: 0.07, mk: 300, mc: 22, residual: 0.02, heat: 0.15 },
    hipSpread: 2.0, holeR: 0.0035, velocity: 850, faceStyle: 'rifle', handed: 'rifle',
  },
  {
    id: 'x1', name: 'PRECISION X-1', cls: 'rifle', kr: '장거리 정밀 소총',
    desc: '헤비 플루티드 배럴과 섀시 스톡을 갖춘 볼트액션 장거리 정밀 소총. 고배율에서 심박이 그대로 보인다. 최고 난이도.',
    stats: { difficulty: 9, stability: 6, recoil: 8, speed: 2 },
    mag: 5, action: 'bolt', fireInterval: 0.9, triggerDelay: 0, reloadTime: 3.0,
    optics: ['hx416', 'hx816'], adsZoom: 1.2, adsSpeed: 3.6,
    sway: { amp: 0.055, hip: 4.0, inertia: 2.4 },
    recoil: { pitch: 3.0, yaw: 0.6, shake: 1.4, k: 70, c: 10, model: 0.07, modelRot: 0.1, mk: 220, mc: 16, residual: 0.012, heat: 0.3 },
    hipSpread: 2.6, holeR: 0.0042, velocity: 900, faceStyle: 'long', handed: 'rifle',
  },
];
export const weaponById = (id) => WEAPONS.find((w) => w.id === id);

// ---------------- geometry helpers ----------------
function rbox(w, h, d, mat, x = 0, y = 0, z = 0, r) {
  const rad = r ?? Math.min(w, h, d) * 0.18;
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, rad), mat);
  m.position.set(x, y, z); m.castShadow = true; return m;
}
function zcyl(r1, r2, len, mat, x = 0, y = 0, z = 0, seg = 24) {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg); g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.castShadow = true; return m;
}
// side profile (z,y) extruded along x
function profile(pts, thick, mat, bevel = 0.004) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -thick / 2);
  g.rotateY(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
}
function smoothProfile(ctrl, thick, mat, bevel = 0.004) {
  const s = new THREE.Shape();
  s.moveTo(ctrl[0][0], ctrl[0][1]);
  const pts = ctrl.map(([a, b]) => new THREE.Vector2(a, b));
  s.splineThru(pts.slice(1));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 40 });
  g.translate(0, 0, -thick / 2); g.rotateY(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
}

export function makeMaterials(finishId = 'graphite', stockId = 'walnut') {
  const f = FINISHES[finishId] || FINISHES.graphite;
  const st = STOCKS[stockId] || STOCKS.walnut;
  const brushed = TX.brushed([1, 1], '#9a9da1');
  const woodTex = st.tone ? TX.wood([1, 1], st.tone, 0, stockId === 'laminate' ? 31 : 9) : null;
  return {
    metal: new THREE.MeshStandardMaterial({ color: f.metal, metalness: f.metalness, roughness: f.metalRough, roughnessMap: f.metalness > 0.5 ? brushed.roughnessMap : null }),
    accent: new THREE.MeshStandardMaterial({ color: f.accent, metalness: 0.85, roughness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x141517, metalness: 0.8, roughness: 0.42 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0.3, roughness: 0.55 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 1, roughness: 0.22, roughnessMap: brushed.roughnessMap }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x18191b, metalness: 0, roughness: 0.62 }),
    wood: woodTex ? new THREE.MeshStandardMaterial({ map: woodTex.map, roughnessMap: woodTex.roughnessMap, bumpMap: woodTex.bumpMap, bumpScale: 0.3, roughness: st.rough, metalness: 0 })
      : new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.75, metalness: 0 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc89b45, metalness: 1, roughness: 0.25 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x223a52, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc8341f, roughness: 0.4, metalness: 0.3 }),
    fiber: new THREE.MeshStandardMaterial({ color: 0xff3a1a, emissive: 0xff3a1a, emissiveIntensity: 0.9, roughness: 0.3 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.82, metalness: 0 }),
    gloveAccent: new THREE.MeshStandardMaterial({ color: 0x4a4f56, roughness: 0.7 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x31363d, roughness: 0.95 }),
  };
}

// ---------------- gloved hand ----------------
function makeHand(M, side = 1, wrap = 0.022) {
  const g = new THREE.Group();
  const palm = rbox(0.03, 0.085, 0.075, M.glove, side * -0.012, 0, 0.0, 0.012);
  g.add(palm);
  // fingers wrapped around a vertical grip in front (−z)
  for (let i = 0; i < 4; i++) {
    const len = [0.07, 0.078, 0.074, 0.062][i];
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, len, 4, 10), M.glove);
    f.rotation.z = Math.PI / 2;
    f.position.set(side * 0.01, 0.03 - i * 0.021, -0.045);
    f.castShadow = true; g.add(f);
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), M.gloveAccent);
    knuckle.position.set(side * -0.02, 0.03 - i * 0.021, -0.03); g.add(knuckle);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, 0.055, 4, 10), M.glove);
  thumb.rotation.x = Math.PI / 2 - 0.3; thumb.position.set(side * -0.032, 0.04, -0.035); g.add(thumb);
  const cuff = zcyl(0.034, 0.036, 0.04, M.gloveAccent, side * -0.01, -0.005, 0.055);
  cuff.rotation.x = 0; g.add(cuff);
  g.add(forearm(M, side * -0.01, -0.01, 0.07, 0.8, side * 0.5));
  return g;
}
function makeSupportHand(M) {
  // palm-up support under a fore-end
  const g = new THREE.Group();
  g.add(rbox(0.085, 0.028, 0.09, M.glove, 0, 0, 0, 0.012));
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.05, 4, 8), M.glove);
    f.position.set(0.05, 0.025, -0.03 + i * 0.02); f.rotation.x = Math.PI / 2; f.rotation.z = 0.2; f.castShadow = true; g.add(f);
  }
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.05, 4, 8), M.glove);
  th.position.set(-0.05, 0.022, -0.02); th.rotation.x = Math.PI / 2; g.add(th);
  g.add(forearm(M, -0.01, -0.03, 0.05, 0.75, -0.35));
  return g;
}
// forearm sleeve angled down/back from the wrist toward the shoulder (out of the sight line)
function forearm(M, x, y, z, pitch, yaw) {
  const piv = new THREE.Group(); piv.position.set(x, y, z);
  piv.rotation.set(pitch, yaw, 0);
  const len = 0.3;
  piv.add(zcyl(0.031, 0.04, len, M.sleeve, 0, 0, len / 2, 16));
  return piv;
}

// ---------------- optics models ----------------
function buildOpticModel(optic, M) {
  const g = new THREE.Group();
  const s = optic.style;
  let len = 0.3, tubeR = 0.0127, obj = 0.022, eye = 0.02;
  if (s === 'reddot') {
    const body = rbox(0.03, 0.03, 0.05, M.dark, 0, 0, 0, 0.006); g.add(body);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.011, 24), M.glass); lens.position.set(0, 0.003, -0.026); g.add(lens);
    const lens2 = lens.clone(); lens2.position.z = 0.026; lens2.rotation.y = Math.PI; g.add(lens2);
    g.add(rbox(0.008, 0.012, 0.012, M.dark, 0.018, 0.004, 0));
    g.userData = { eyeZ: 0.38, front: -0.03, rear: 0.03 };
    return g;
  }
  if (s === 'pistol') { len = 0.22; tubeR = 0.012; obj = 0.016; eye = 0.017; }
  if (s === 'lpvo') { len = 0.26; obj = 0.018; eye = 0.021; tubeR = 0.015; }
  if (s === 'mid') { len = 0.33; obj = 0.025; eye = 0.021; }
  if (s === 'big') { len = 0.38; tubeR = 0.017; obj = 0.031; eye = 0.022; }
  g.add(zcyl(tubeR, tubeR, len * 0.6, M.dark, 0, 0, 0));
  g.add(zcyl(obj, tubeR, len * 0.22, M.dark, 0, 0, -len * 0.41));
  g.add(zcyl(obj, obj, len * 0.12, M.dark, 0, 0, -len * 0.58));
  g.add(zcyl(eye, tubeR * 1.05, len * 0.16, M.dark, 0, 0, len * 0.38));
  g.add(zcyl(eye * 1.04, eye * 1.04, len * 0.06, M.rubber, 0, 0, len * 0.49));
  const lensF = new THREE.Mesh(new THREE.CircleGeometry(obj * 0.88, 32), M.glass); lensF.position.z = -len * 0.64; lensF.rotation.y = Math.PI; g.add(lensF);
  const lensR = new THREE.Mesh(new THREE.CircleGeometry(eye * 0.85, 32), M.glass); lensR.position.z = len * 0.52; g.add(lensR);
  // turrets
  const t1 = new THREE.Mesh(new THREE.CylinderGeometry(tubeR * 0.95, tubeR * 0.95, tubeR * 1.6, 20), M.dark); t1.position.set(0, tubeR * 1.5, -0.01); g.add(t1);
  const t2 = t1.clone(); t2.rotation.z = Math.PI / 2; t2.position.set(tubeR * 1.5, 0, -0.01); g.add(t2);
  const pm = new THREE.Mesh(new THREE.CylinderGeometry(eye * 0.95, eye * 0.95, 0.012, 24), M.accent); pm.rotation.x = Math.PI / 2; pm.position.z = len * 0.3; g.add(pm);
  if (s === 'big') { const shade = zcyl(obj * 1.02, obj * 1.02, 0.06, M.dark, 0, 0, -len * 0.68); g.add(shade); }
  // rings & mount
  for (const z of [-len * 0.18, len * 0.16]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(tubeR + 0.003, 0.004, 8, 24), M.dark); ring.position.z = z; g.add(ring);
    g.add(rbox(0.022, 0.02, 0.016, M.dark, 0, -tubeR - 0.01, z));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { eyeZ: len * 0.52 + 0.085, front: -len * 0.64, rear: len * 0.52 };
  return g;
}

// ---------------- weapon models ----------------
// Convention: model points down −Z, sight line at (0, sightH, z), eye at (0, sightH, eyeZ)
export function buildWeaponModel(def, loadout, M, opts = {}) {
  const root = new THREE.Group();
  const parts = {};
  const optic = OPTICS[loadout.optic] || OPTICS[def.optics[0]];
  let sightH = 0, eyeZ = 0.6, muzzle = new THREE.Vector3(), eject = new THREE.Vector3();
  const B = {
    p10: () => {
      // anatomical match grip with palm shelf
      const grip = smoothProfile([[0.035, 0.0], [-0.012, -0.004], [-0.02, -0.05], [-0.016, -0.1], [-0.028, -0.125], [0.012, -0.13], [0.06, -0.12], [0.07, -0.07], [0.055, -0.02]], 0.044, M.wood, 0.006);
      root.add(grip);
      const frame = rbox(0.026, 0.028, 0.15, M.metal, 0, 0.012, -0.055); root.add(frame);
      const slide = new THREE.Group(); slide.add(rbox(0.024, 0.022, 0.1, M.accent, 0, 0, 0, 0.004));
      for (let i = 0; i < 5; i++) slide.add(rbox(0.0245, 0.016, 0.002, M.dark, 0, 0, 0.03 + i * 0.004, 0.0005));
      slide.position.set(0, 0.035, -0.03); root.add(slide); parts.slide = slide;
      root.add(zcyl(0.0085, 0.0085, 0.2, M.steel, 0, 0.03, -0.17));
      root.add(rbox(0.024, 0.024, 0.14, M.metal, 0, 0.012, -0.19, 0.004));
      root.add(rbox(0.02, 0.022, 0.05, M.dark, 0, -0.012, -0.21, 0.004)); // weight
      root.add(zcyl(0.011, 0.011, 0.02, M.dark, 0, 0.03, -0.275));
      // trigger guard + trigger
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0035, 8, 24, Math.PI), M.metal);
      guard.rotation.y = Math.PI / 2; guard.rotation.x = Math.PI; guard.position.set(0, -0.002, -0.025); root.add(guard);
      const trig = rbox(0.005, 0.02, 0.006, M.red, 0, -0.012, -0.022); root.add(trig); parts.trigger = trig;
      // sights
      sightH = 0.064;
      const rs = new THREE.Group();
      rs.add(rbox(0.026, 0.014, 0.018, M.dark, 0, sightH - 0.009, 0.012, 0.002));
      rs.add(rbox(0.009, 0.01, 0.006, M.dark, -0.0085, sightH - 0.001, 0.016, 0.001));
      rs.add(rbox(0.009, 0.01, 0.006, M.dark, 0.0085, sightH - 0.001, 0.016, 0.001));
      root.add(rs);
      root.add(rbox(0.0034, 0.024, 0.008, M.dark, 0, sightH - 0.011, -0.255, 0.0008));
      const mag = rbox(0.018, 0.012, 0.04, M.dark, 0, -0.128, 0.02); root.add(mag); parts.mag = mag;
      muzzle.set(0, 0.03, -0.29); eject.set(0.014, 0.04, -0.03); eyeZ = 0.62;
    },
    p20: () => {
      const grip = smoothProfile([[0.04, 0.0], [0.0, -0.01], [-0.005, -0.06], [0.0, -0.115], [0.03, -0.122], [0.06, -0.105], [0.068, -0.05], [0.06, 0.0]], 0.04, M.wood, 0.006);
      root.add(grip);
      root.add(rbox(0.032, 0.05, 0.075, M.metal, 0, 0.012, -0.015, 0.006)); // frame
      root.add(rbox(0.03, 0.012, 0.075, M.metal, 0, 0.058, -0.06, 0.003)); // top strap
      root.add(rbox(0.03, 0.02, 0.03, M.metal, 0, -0.005, -0.075, 0.004));
      // cylinder on crane
      const crane = new THREE.Group(); crane.position.set(-0.012, 0.006, -0.06);
      const cyl = new THREE.Group(); cyl.position.set(0.012, 0.024, 0);
      const cylBody = zcyl(0.02, 0.02, 0.042, M.metal, 0, 0, 0, 32); cyl.add(cylBody);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const flute = zcyl(0.0045, 0.0045, 0.03, M.dark, Math.cos(a) * 0.0195, Math.sin(a) * 0.0195, 0, 10); cyl.add(flute);
        const ch = new THREE.Mesh(new THREE.CircleGeometry(0.0042, 14), M.black);
        ch.position.set(Math.cos(a + Math.PI / 6) * 0.012, Math.sin(a + Math.PI / 6) * 0.012, -0.0215); ch.rotation.y = Math.PI; cyl.add(ch);
        const rim = new THREE.Mesh(new THREE.CircleGeometry(0.0046, 14), M.brass);
        rim.position.set(Math.cos(a + Math.PI / 6) * 0.012, Math.sin(a + Math.PI / 6) * 0.012, 0.0215); cyl.add(rim);
      }
      crane.add(cyl); root.add(crane); parts.cylinder = cyl; parts.crane = crane;
      // barrel + rib + underlug
      root.add(zcyl(0.0105, 0.0105, 0.16, M.metal, 0, 0.034, -0.16));
      root.add(rbox(0.018, 0.012, 0.16, M.metal, 0, 0.047, -0.16, 0.003));
      root.add(rbox(0.016, 0.02, 0.15, M.metal, 0, 0.014, -0.165, 0.004));
      // hammer
      const hammer = new THREE.Group(); hammer.position.set(0, 0.045, 0.02);
      hammer.add(rbox(0.008, 0.03, 0.01, M.dark, 0, 0.012, 0, 0.002));
      hammer.add(rbox(0.012, 0.006, 0.016, M.dark, 0, 0.026, 0.006, 0.002));
      root.add(hammer); parts.hammer = hammer;
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0035, 8, 24, Math.PI), M.metal);
      guard.rotation.y = Math.PI / 2; guard.rotation.x = Math.PI; guard.position.set(0, -0.012, -0.03); root.add(guard);
      const trig = rbox(0.005, 0.022, 0.007, M.steel, 0, -0.018, -0.028); root.add(trig); parts.trigger = trig;
      sightH = 0.068;
      root.add(rbox(0.024, 0.01, 0.014, M.dark, 0, sightH - 0.005, 0.0, 0.002));
      root.add(rbox(0.0035, 0.018, 0.022, M.fiber, 0, sightH - 0.009, -0.232, 0.001));
      muzzle.set(0, 0.034, -0.245); eject.set(0, 0, 0); eyeZ = 0.62;
    },
    r10: () => {
      root.add(rbox(0.042, 0.05, 0.27, M.accent, 0, 0.0, -0.05, 0.008)); // receiver
      root.add(zcyl(0.015, 0.015, 0.62, M.metal, 0, 0.005, -0.5)); // shroud
      root.add(zcyl(0.017, 0.017, 0.04, M.dark, 0, 0.005, -0.82));
      root.add(rbox(0.05, 0.06, 0.42, M.metal, 0, -0.045, -0.31, 0.01)); // fore-end
      root.add(rbox(0.04, 0.02, 0.1, M.rubber, 0, -0.08, -0.36, 0.006)); // hand stop
      const grip = smoothProfile([[0.06, -0.02], [0.04, -0.04], [0.035, -0.1], [0.045, -0.15], [0.07, -0.17], [0.12, -0.16], [0.13, -0.11], [0.11, -0.03], [0.09, -0.02]], 0.045, M.wood, 0.006);
      root.add(grip);
      root.add(rbox(0.04, 0.06, 0.3, M.metal, 0, -0.035, 0.25, 0.01)); // butt rail
      root.add(rbox(0.035, 0.035, 0.16, M.wood, 0, 0.035, 0.22, 0.01)); // cheek
      const hook = smoothProfile([[0.38, 0.05], [0.42, 0.05], [0.43, -0.05], [0.42, -0.16], [0.38, -0.2], [0.37, -0.15], [0.39, -0.05]], 0.05, M.accent, 0.005);
      root.add(hook);
      sightH = 0.07;
      // front globe tunnel + ring insert (seen in ADS)
      const globe = new THREE.Group(); globe.position.set(0, sightH, -0.86);
      const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 32, 1, true), M.dark); tunnel.rotation.x = Math.PI / 2;
      tunnel.material = M.dark.clone(); tunnel.material.side = THREE.DoubleSide; globe.add(tunnel);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0012, 10, 48), M.black); globe.add(ring);
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.0075, 0.001), M.black); spoke.position.y = -0.0225; globe.add(spoke);
      globe.add(rbox(0.012, sightH - 0.02, 0.02, M.dark, 0, -(sightH) / 2 - 0.004, 0, 0.002));
      root.add(globe); parts.globe = globe;
      const rear = new THREE.Group();
      rear.add(rbox(0.02, 0.03, 0.06, M.dark, 0, sightH - 0.03, 0.02, 0.004));
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 32), M.rubber); disc.rotation.x = Math.PI / 2; disc.position.set(0, sightH, 0.05); rear.add(disc);
      root.add(rear); parts.rear = rear;
      const bolt = new THREE.Group(); bolt.position.set(0.024, 0.012, 0.02);
      bolt.add(zcyl(0.004, 0.004, 0.035, M.steel, 0.015, 0, 0).rotateY(Math.PI / 2));
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 10), M.dark); knob.position.set(0.032, 0, 0); bolt.add(knob);
      root.add(bolt); parts.bolt = bolt;
      muzzle.set(0, 0.005, -0.88); eject.set(0.024, 0.02, 0.0); eyeZ = 0.075;
    },
    r20: () => {
      root.add(rbox(0.04, 0.055, 0.25, M.metal, 0, 0.0, -0.03, 0.008));
      root.add(zcyl(0.012, 0.0115, 0.52, M.dark, 0, 0.01, -0.42));
      root.add(zcyl(0.015, 0.015, 0.05, M.dark, 0, 0.01, -0.69));
      // synthetic stock with thumbhole profile
      const stock = smoothProfile([[-0.42, -0.005], [-0.12, -0.02], [0.02, -0.03], [0.07, -0.09], [0.06, -0.16], [0.1, -0.17], [0.14, -0.07], [0.2, -0.04], [0.44, -0.06], [0.45, -0.17], [0.47, 0.05], [0.25, 0.04], [0.12, 0.02], [-0.42, 0.02]], 0.048, M.wood, 0.008);
      root.add(stock);
      root.add(rbox(0.05, 0.22, 0.02, M.rubber, 0, -0.06, 0.465, 0.005));
      root.add(rbox(0.024, 0.012, 0.22, M.dark, 0, 0.033, -0.03, 0.002)); // rail
      for (let i = 0; i < 12; i++) root.add(rbox(0.026, 0.004, 0.006, M.dark, 0, 0.041, -0.13 + i * 0.018, 0.001));
      const mag = rbox(0.025, 0.07, 0.07, M.dark, 0, -0.06, -0.06, 0.004); root.add(mag); parts.mag = mag;
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 8, 24, Math.PI), M.dark);
      guard.rotation.y = Math.PI / 2; guard.rotation.x = Math.PI; guard.position.set(0, -0.03, 0.03); root.add(guard);
      const bolt = new THREE.Group(); bolt.position.set(0.022, 0.012, 0.02);
      bolt.add(rbox(0.03, 0.008, 0.012, M.steel, 0.012, 0, 0, 0.002)); root.add(bolt); parts.bolt = bolt;
      sightH = 0.075;
      muzzle.set(0, 0.01, -0.72); eject.set(0.022, 0.02, -0.02); eyeZ = 0.3;
    },
    x1: () => {
      root.add(rbox(0.05, 0.06, 0.26, M.metal, 0, 0.0, -0.02, 0.008)); // chassis
      root.add(zcyl(0.032, 0.032, 0.44, M.metal, 0, 0.0, -0.37, 8)); // octagonal handguard
      root.add(zcyl(0.016, 0.0155, 0.62, M.dark, 0, 0.0, -0.53));
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; root.add(rbox(0.004, 0.004, 0.28, M.black, Math.cos(a) * 0.015, Math.sin(a) * 0.015, -0.72, 0.001)); }
      const brake = rbox(0.034, 0.034, 0.07, M.dark, 0, 0, -0.87, 0.006); root.add(brake);
      for (let i = 0; i < 3; i++) root.add(rbox(0.036, 0.022, 0.006, M.black, 0, 0, -0.85 - i * 0.018, 0.001));
      // pistol grip
      const pg = smoothProfile([[0.06, -0.025], [0.045, -0.05], [0.045, -0.13], [0.07, -0.15], [0.1, -0.14], [0.105, -0.06], [0.1, -0.025]], 0.036, M.polymer, 0.006);
      root.add(pg);
      // skeleton stock
      root.add(rbox(0.03, 0.03, 0.36, M.metal, 0, -0.01, 0.3, 0.006));
      const lower = rbox(0.03, 0.03, 0.3, M.metal, 0, -0.1, 0.33, 0.006); lower.rotation.x = 0.12; root.add(lower);
      root.add(rbox(0.04, 0.035, 0.18, M.polymer, 0, 0.04, 0.26, 0.01)); // cheek riser
      root.add(rbox(0.05, 0.19, 0.03, M.rubber, 0, -0.06, 0.49, 0.008));
      const mag = rbox(0.032, 0.075, 0.08, M.dark, 0, -0.06, -0.06, 0.005); root.add(mag); parts.mag = mag;
      // folded bipod
      for (const s of [-1, 1]) root.add(zcyl(0.005, 0.005, 0.2, M.dark, s * 0.012, -0.04, -0.47));
      root.add(rbox(0.05, 0.016, 0.03, M.dark, 0, -0.033, -0.57));
      const bolt = new THREE.Group(); bolt.position.set(0.026, 0.014, 0.06);
      const arm = zcyl(0.004, 0.004, 0.05, M.steel, 0.025, 0, 0); arm.rotation.y = Math.PI / 2; bolt.add(arm);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.011, 14, 12), M.polymer); knob.position.set(0.05, -0.006, 0); bolt.add(knob);
      bolt.add(zcyl(0.009, 0.009, 0.06, M.steel, 0, 0.01, 0));
      root.add(bolt); parts.bolt = bolt;
      root.add(rbox(0.024, 0.012, 0.25, M.dark, 0, 0.036, -0.02, 0.002));
      sightH = 0.085;
      muzzle.set(0, 0, -0.91); eject.set(0.026, 0.02, 0.02); eyeZ = 0.3;
    },
  };
  B[def.id]();

  // optic
  if (optic.type === 'scope') {
    const om = buildOpticModel(optic, M);
    let mountY = sightH, mountZ = -0.04;
    if (def.cls === 'pistol') { mountY = 0.09; mountZ = -0.06; }
    else { mountY = def.id === 'x1' ? 0.085 : 0.078; mountZ = -0.04; }
    if (optic.style === 'reddot') mountY = 0.072;
    om.position.set(0, mountY, mountZ);
    root.add(om); parts.optic = om;
    sightH = mountY + (optic.style === 'reddot' ? 0.003 : 0);
    eyeZ = mountZ + om.userData.eyeZ;
  }

  // hands
  const handR = makeHand(M, 1);
  const handL = def.handed === 'pistol' ? makeHand(M, -1) : makeSupportHand(M);
  if (def.handed === 'pistol') {
    handR.position.set(0.004, -0.055, 0.02); handR.rotation.set(-0.15, 0, 0);
    handL.position.set(-0.03, -0.068, 0.015); handL.rotation.set(-0.1, 0.25, 0.1);
  } else {
    const gz = def.id === 'r10' ? 0.085 : def.id === 'x1' ? 0.075 : 0.085;
    handR.position.set(0.004, -0.085, gz); handR.rotation.set(-0.35, 0, 0);
    const fz = def.id === 'r10' ? -0.28 : def.id === 'x1' ? -0.3 : -0.32;
    handL.position.set(0.0, -0.075, fz); handL.rotation.set(0.15, 0.5, 0.2);
  }
  if (opts.hands !== false) root.add(handR, handL);
  parts.handR = handR; parts.handL = handL;

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const muzzleObj = new THREE.Object3D(); muzzleObj.position.copy(muzzle); root.add(muzzleObj);
  const ejectObj = new THREE.Object3D(); ejectObj.position.copy(eject); root.add(ejectObj);
  return { root, parts, sightH, eyeZ, muzzle: muzzleObj, eject: ejectObj, optic };
}
