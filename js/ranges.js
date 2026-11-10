// Five procedurally built 3D range environments with time-of-day lighting.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as TX from './textures.js';
import { Target } from './target.js';
import { DEG, fbm2, ridged2, smoothstep, mulberry32, lerp } from './util.js';

let rectInit = false;

export const RANGES = [
  { id: 'indoor', name: 'CLUB INDOOR RANGE', kr: '실내 스포츠 사격장', distances: [10, 15, 25], times: ['day', 'night'],
    desc: '콘크리트 벽과 흡음 배플, 천장 레일 캐리어가 있는 클래식 클럽 레인. 짙은 실내 잔향.' },
  { id: 'modern', name: 'PRECISION HALL', kr: '현대식 실내 정밀 사격장', distances: [10, 25, 50], times: ['day', 'night'],
    desc: 'LED 라인 조명, 에폭시 바닥, 전자 표적 시스템을 갖춘 최신 정밀 사격 홀.' },
  { id: 'outdoor', name: 'OPEN SPORT RANGE', kr: '야외 스포츠 사격장', distances: [25, 50, 100], times: ['morning', 'noon', 'dusk', 'night'],
    desc: '방호 둑과 지붕 덮인 사대가 있는 개방형 야외 레인. 바람 깃발과 새소리.' },
  { id: 'mountain', name: 'ALPINE LONG RANGE', kr: '산악 장거리 표적 경기장', distances: [300, 500, 700, 900, 1100], times: ['morning', 'noon', 'dusk', 'night'],
    desc: '설산 계곡을 따라 1,100m까지 펼쳐진 장거리 경기장. 고배율 광학 조준경 권장.' },
  { id: 'arena', name: 'WORLD CUP ARENA', kr: '국제 스포츠 사격 대회장', distances: [10, 25, 50], times: ['day', 'night'],
    desc: '관중석과 대형 스코어보드, 방송 조명이 갖춰진 국제 대회 결선 무대.' },
];
export const TIME_LABELS = { day: 'DAY', night: 'NIGHT', morning: 'MORNING', noon: 'NOON', dusk: 'DUSK' };

// ---------------- helpers ----------------
function std(o) { return new THREE.MeshStandardMaterial(o); }
function box(parent, w, h, d, mat, x, y, z, o = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (o.rx) m.rotation.x = o.rx; if (o.ry) m.rotation.y = o.ry; if (o.rz) m.rotation.z = o.rz;
  m.castShadow = o.cast !== false; m.receiveShadow = o.receive !== false;
  parent.add(m);
  return m;
}
function cyl(parent, rt, rb, h, mat, x, y, z, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function plane(parent, w, h, mat, x, y, z, rx = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.x = rx; m.rotation.y = ry; m.receiveShadow = true; parent.add(m); return m;
}
function rectLight(scene, color, intensity, w, h, x, y, z, tx, ty, tz) {
  const l = new THREE.RectAreaLight(color, intensity, w, h);
  l.position.set(x, y, z); l.lookAt(tx, ty, tz); scene.add(l); return l;
}
function sign(parent, lines, w, h, x, y, z, opts = {}) {
  const t = TX.textTexture(lines, { w: 512, h: Math.round(512 * h / w), ...opts });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, emissive: opts.glow ? 0xffffff : 0, emissiveMap: opts.glow ? t : null, emissiveIntensity: opts.glow || 0 }));
  m.position.set(x, y, z); if (opts.ry) m.rotation.y = opts.ry; parent.add(m); return m;
}
function spottingScope(parent, x, y, z, mats) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.26), mats.dark);
    leg.position.set(Math.cos(a) * 0.06, 0.12, Math.sin(a) * 0.06);
    leg.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); g.add(leg);
  }
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.32, 20), mats.olive);
  body.rotation.x = Math.PI / 2 - 0.08; body.position.set(0, 0.27, -0.05); g.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.036, 0.08, 20), mats.dark);
  lens.rotation.x = Math.PI / 2 - 0.08; lens.position.set(0, 0.284, -0.23); g.add(lens);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  parent.add(g); return g;
}
function earMuffs(parent, x, y, z, mats) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = 0.6;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.008, 8, 24, Math.PI), mats.dark);
  band.rotation.x = -Math.PI / 2; band.position.y = 0.04; g.add(band);
  for (const s of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 20), mats.accent);
    cup.rotation.z = Math.PI / 2; cup.position.set(s * 0.08, 0.045, 0); g.add(cup);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  parent.add(g); return g;
}
function gearBag(parent, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.28), mat);
  m.position.set(x, y + 0.09, z); m.rotation.y = 0.2; m.castShadow = true; parent.add(m);
}
function makeFlag(scene, x, z, h, updaters, color = '#d9452f') {
  const pole = cyl(scene, 0.025, 0.035, h, std({ color: 0xbfc3c7, metalness: 0.8, roughness: 0.4 }), x, h / 2, z, 8);
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 128, 64); g.fillStyle = '#f2f2f2'; g.fillRect(0, 22, 128, 20);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(1.4, 0.7, 14, 6); geo.translate(0.7, 0, 0);
  const flag = new THREE.Mesh(geo, std({ map: t, side: THREE.DoubleSide, roughness: 0.9 }));
  flag.position.set(x, h - 0.4, z); flag.castShadow = true; scene.add(flag);
  const base = geo.attributes.position.array.slice();
  const ph = Math.random() * 10;
  updaters.push((dt, t) => {
    const p = geo.attributes.position.array;
    const wind = 0.6 + 0.4 * Math.sin(t * 0.21 + ph);
    flag.rotation.y = -0.4 + Math.sin(t * 0.13 + ph) * 0.35;
    for (let i = 0; i < p.length; i += 3) {
      const u = base[i] / 1.4;
      p[i + 2] = Math.sin(t * 6 * wind + u * 7 + ph) * 0.12 * u * wind;
      p[i + 1] = base[i + 1] - u * u * (1 - wind) * 0.35;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  });
  return flag;
}

const TOD = {
  morning: { elev: 8, azim: 140, sun: 0xffd2a6, sunI: 2.4, sky: 0xbcd3f0, ground: 0x6d5f45, hemiI: 0.8, turb: 5, ray: 1.8, mie: 0.006, exposure: 0.85, fog: 0xc8d2db },
  noon: { elev: 55, azim: 200, sun: 0xfff3e2, sunI: 3.4, sky: 0xcfe0f5, ground: 0x6b6048, hemiI: 1.0, turb: 3, ray: 1.2, mie: 0.004, exposure: 0.75, fog: 0xc6d4e2 },
  dusk: { elev: 2.2, azim: 235, sun: 0xff8f4a, sunI: 1.6, sky: 0x8a90b8, ground: 0x4a3b30, hemiI: 0.55, turb: 8, ray: 2.6, mie: 0.01, exposure: 0.95, fog: 0xb09a92 },
  night: { elev: -14, azim: 220, sun: 0x9ab4ff, sunI: 0.12, sky: 0x1b2340, ground: 0x0c0d10, hemiI: 0.18, turb: 1, ray: 0.4, mie: 0.002, exposure: 1.0, fog: 0x0b0e17 },
};

function scaleTargetR(base, d, d0, pow) { return base * Math.pow(d / d0, pow); }

// ---------------- builder ----------------
export function buildRange(id, ctx) {
  if (!rectInit) { RectAreaLightUniformsLib.init(); rectInit = true; }
  const def = RANGES.find((r) => r.id === id);
  const scene = new THREE.Scene();
  const R = {
    id, def, scene, ctx,
    updaters: [], targets: [], decor: [],
    eye: new THREE.Vector3(0, 1.55, 0),
    groundY: 0, targetY: 1.5, stand: 'frame', lanePitch: 1.5, lanes: [-3, -2, -1, 1, 2, 3],
    reverb: 'indoor', ambient: 'indoor', indoor: true,
    vmLight: { color: 0xffffff, intensity: 2.0, dir: new THREE.Vector3(0.3, 1, 0.4), hemi: [0xdde4ee, 0x30302c, 0.7] },
    envIntensity: 1, exposure: 1, near: 0.08, far: 400,
    lights: [], timeObjs: {},
    targetR: (d) => 0.3,
  };
  const mats = {
    dark: std({ color: 0x1b1c1e, roughness: 0.5, metalness: 0.6 }),
    steel: std({ color: 0x4a4e52, roughness: 0.45, metalness: 0.85 }),
    olive: std({ color: 0x4b5038, roughness: 0.55, metalness: 0.2 }),
    accent: std({ color: 0xc8461f, roughness: 0.5 }),
    wood: std({ ...TX.wood([1, 1], '#7a5532', 0, 7), roughness: 0.8 }),
    bag: std({ color: 0x2c3036, roughness: 0.9 }),
  };
  R.mats = mats;
  const builders = { indoor: buildIndoor, modern: buildModern, outdoor: buildOutdoor, mountain: buildMountain, arena: buildArena };
  builders[id](R, mats);

  R.makeTarget = (distance, x = 0, style = 'pistol', opts = {}) => {
    const outerR = opts.outerR || R.targetR(distance);
    const t = new Target({ outerR, style, stand: opts.stand || R.stand, distance, groundY: R.groundY, centerY: opts.centerY ?? R.targetCenterY(distance, outerR), mats });
    t.group.position.x = x; t.group.position.z = -distance;
    scene.add(t.group);
    R.targets.push(t);
    t.group.traverse((o) => { if (o.isMesh && !o.userData.target) o.castShadow = true; });
    return t;
  };
  R.removeTarget = (t) => {
    scene.remove(t.group); t.dispose();
    R.targets = R.targets.filter((x) => x !== t);
  };
  R.targetCenterY = R.targetCenterY || ((d, r) => R.targetY);
  // decorative neighbour targets with holes
  R.populateDecor = (style, mainDist) => {
    for (const t of R.decor) R.removeTarget(t);
    R.decor = [];
    const rng = mulberry32(42);
    for (const k of R.lanes) {
      const d = R.def.distances[Math.floor(rng() * R.def.distances.length)];
      const t = R.makeTarget(d, k * R.lanePitch, style);
      const n = 3 + Math.floor(rng() * 8);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, rr = Math.abs(rng() - rng()) * t.outerR * 0.6;
        t.addHole(Math.cos(a) * rr, Math.sin(a) * rr, Math.max(0.003, d * 0.00012));
      }
      R.decor.push(t);
    }
  };

  R.update = (dt, t) => { for (const u of R.updaters) u(dt, t); for (const tg of R.targets) tg.update(dt); };
  R.setTime = (tod) => { R.tod = tod; R._setTime && R._setTime(tod); };
  R.setTime(def.times.includes(ctx.tod) ? ctx.tod : def.times[0]);

  R.dispose = () => {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          for (const k of ['map', 'roughnessMap', 'bumpMap', 'emissiveMap', 'normalMap']) if (m[k] && m[k] !== Target.holeMat?.map) m[k].dispose?.();
          if (m !== Target.holeMat) m.dispose();
        }
      }
    });
    if (R.envRT) R.envRT.dispose();
    if (R.skyEnvRT) R.skyEnvRT.dispose();
  };
  return R;
}

// Environment from the actual built scene (gives realistic reflections on the guns)
function sceneEnv(R, yLift = 1.5) {
  const pm = R.ctx.pmrem;
  R.scene.position.y = -yLift; R.scene.updateMatrixWorld(true);
  const rt = pm.fromScene(R.scene, 0.02, 0.1, 200);
  R.scene.position.y = 0; R.scene.updateMatrixWorld(true);
  if (R.envRT) R.envRT.dispose();
  R.envRT = rt;
  R.scene.environment = rt.texture;
  R.envMap = rt.texture;
}
function roomEnv(R) {
  const rt = R.ctx.pmrem.fromScene(new RoomEnvironment(R.ctx.renderer), 0.04);
  R.envRT = rt; R.scene.environment = rt.texture; R.envMap = rt.texture;
}

// ---------------- 1. Indoor club range ----------------
function buildIndoor(R, mats) {
  const S = R.scene;
  R.stand = 'carrier'; R.targetY = 1.45; R.lanePitch = 1.5; R.lanes = [-3, -2, -1, 1, 2, 3];
  R.targetR = (d) => scaleTargetR(0.26, d, 10, 0.55);
  R.reverb = 'indoor'; R.ambient = 'indoor'; R.far = 120; R.exposure = 1.45;
  S.background = new THREE.Color(0x0d0d0e);
  const W = 10.5, L0 = 4, L1 = -29, H = 3.2;
  const floor = std({ ...TX.concrete([10, 30], '#7d7b77', 2), roughness: 0.85, bumpScale: 0.6 });
  plane(S, W, L0 - L1, floor, 0, 0, (L0 + L1) / 2, -Math.PI / 2);
  const mat = std({ ...TX.rubberMat([6, 4]), roughness: 0.9, bumpScale: 0.6 });
  plane(S, W, 3.2, mat, 0, 0.005, 1.6, -Math.PI / 2);
  // painted firing line
  plane(S, W, 0.08, std({ color: 0xd8372a, roughness: 0.6 }), 0, 0.008, -0.45, -Math.PI / 2);
  const wallMat = std({ ...TX.acoustic([14, 2], '#2c2f32'), roughness: 0.95, bumpScale: 1.2 });
  const concWall = std({ ...TX.concrete([8, 2], '#6f6e6a', 5), roughness: 0.9, bumpScale: 0.4 });
  for (const s of [-1, 1]) {
    plane(S, L0 - L1, H, wallMat, s * W / 2, H / 2, (L0 + L1) / 2, 0, -s * Math.PI / 2);
    // painted distance markers on walls
    for (const d of [5, 10, 15, 20, 25]) {
      sign(S, [`${d}M`], 0.5, 0.25, s * (W / 2 - 0.01), 2.2, -d, { bg: '#2c2f32', color: '#e4c060', size: 70, ry: -s * Math.PI / 2 });
    }
  }
  plane(S, W, H, concWall, 0, H / 2, L0, 0, Math.PI);
  // ceiling
  plane(S, W, L0 - L1, std({ color: 0x232527, roughness: 0.95 }), 0, H, (L0 + L1) / 2, Math.PI / 2);
  // angled baffles
  const baffle = std({ ...TX.panel([3, 1], '#2a2c2e', 6), roughness: 0.8, metalness: 0.3 });
  for (let z = -2; z > -25; z -= 2.6) box(S, W, 0.9, 0.06, baffle, 0, H - 0.4, z, { rx: -0.6 });
  // backstop: angled steel + granulate berm
  const gran = std({ ...TX.granulate([10, 3]), roughness: 1, bumpScale: 2 });
  box(S, W, 2.4, 1.2, gran, 0, 1.0, L1 + 1.4, { rx: 0.5 });
  box(S, W, 3.4, 0.1, std({ color: 0x3b3e41, metalness: 0.9, roughness: 0.35 }), 0, H / 2, L1 + 0.2, { rx: 0.25 });
  // booth partitions + shelf
  const part = std({ ...TX.panel([1, 1], '#3a3d40', 2), roughness: 0.7, metalness: 0.2 });
  const shelf = std({ ...TX.wood([2, 1], '#54402d', 0, 11), roughness: 0.6 });
  for (let k = -3.5; k <= 3.5; k += 1) {
    box(S, 0.05, 2.0, 1.4, part, k * 1.5, 1.0, 0.25);
  }
  for (let k = -3; k <= 3; k++) {
    box(S, 1.42, 0.05, 0.5, shelf, k * 1.5, 1.02, -0.35);
    box(S, 1.42, 0.97, 0.04, part, k * 1.5, 0.5, -0.58);
    sign(S, [String(k + 4).padStart(2, '0')], 0.34, 0.2, k * 1.5, 2.25, -0.55, { bg: '#121314', color: '#e6e6e6', size: 120 });
  }
  spottingScope(S, 0.45, 1.045, -0.3, mats);
  earMuffs(S, -0.45, 1.045, -0.28, mats);
  gearBag(S, -0.3, 0, 0.6, mats.bag);
  // carrier rails
  for (let k = -3; k <= 3; k++) box(S, 0.06, 0.08, 27, mats.steel, k * 1.5, 2.9, -13.5, { cast: false });
  // fluorescent fixtures + lights
  const tubeMat = std({ color: 0xffffff, emissive: 0xf4f6ff, emissiveIntensity: 3 });
  R.timeObjs.fix = tubeMat;
  for (const z of [1.2, -1.0]) {
    box(S, 2.4, 0.04, 0.18, tubeMat, 0, H - 0.05, z, { cast: false });
    R.lights.push(rectLight(S, 0xf2f5ff, 6, 2.4, 0.4, 0, H - 0.08, z, 0, 0, z));
  }
  for (const z of [-9, -14, -24]) {
    box(S, 6, 0.04, 0.16, tubeMat, 0, H - 0.05, z, { cast: false });
    R.lights.push(rectLight(S, 0xf6f4ee, 9, 6, 0.4, 0, H - 0.1, z + 0.4, 0, 1.3, z - 3));
  }
  const key = new THREE.SpotLight(0xfff6ea, 60, 40, 0.75, 0.6, 1.4);
  key.position.set(0.3, H - 0.2, 1.8); key.target.position.set(0, 0.8, -6);
  key.castShadow = true; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  S.add(key, key.target); R.shadowLight = key;
  const fill = new THREE.HemisphereLight(0xdfe6f0, 0x2a2826, 0.25); S.add(fill);
  // clerestory windows (day only)
  const winMat = std({ color: 0x000000, emissive: 0xcfe2ff, emissiveIntensity: 1.6 });
  R.timeObjs.win = winMat;
  for (let z = 2; z > -26; z -= 5) plane(S, 3.2, 0.35, winMat, -W / 2 + 0.02, H - 0.35, z, 0, Math.PI / 2);
  const winLight = rectLight(S, 0xcfe2ff, 2.5, 26, 0.35, -W / 2 + 0.05, H - 0.35, -11, W, 1, -11);
  winLight.rotation.z = 0; R.timeObjs.winLight = winLight;
  R.vmLight = { color: 0xfff4e6, intensity: 1.6, dir: new THREE.Vector3(0.2, 1, 0.6), hemi: [0xdfe6f0, 0x2a2826, 0.6] };
  R._setTime = (t) => {
    const day = t === 'day';
    winMat.emissiveIntensity = day ? 1.6 : 0.02;
    winLight.intensity = day ? 2.5 : 0;
  };
  sceneEnv(R, 1.5);
}

// ---------------- 2. Modern precision hall ----------------
function buildModern(R, mats) {
  const S = R.scene;
  R.stand = 'electronic'; R.targetY = 1.4; R.lanePitch = 1.6; R.lanes = [-3, -2, -1, 1, 2, 3];
  R.targetR = (d) => scaleTargetR(0.26, d, 10, 0.6);
  R.reverb = 'hall'; R.ambient = 'hall'; R.far = 200; R.exposure = 1.35;
  S.background = new THREE.Color(0x08090a);
  const W = 11.2, L0 = 5, L1 = -54, H = 4.2;
  const epoxy = std({ ...TX.concrete([6, 30], '#5c5f63', 9), roughness: 0.28, metalness: 0.05, bumpScale: 0.1 });
  plane(S, W, L0 - L1, epoxy, 0, 0, (L0 + L1) / 2, -Math.PI / 2);
  // lane floor stripes
  for (let k = -3.5; k <= 3.5; k++) plane(S, 0.03, 52, std({ color: 0x9aa0a6, roughness: 0.4 }), k * 1.6, 0.004, -26, -Math.PI / 2);
  plane(S, W, 0.06, std({ color: 0xe3a948, emissive: 0xe3a948, emissiveIntensity: 0.3 }), 0, 0.006, -0.5, -Math.PI / 2);
  const wall = std({ ...TX.panel([20, 2], '#1d1f22', 4), roughness: 0.6, metalness: 0.2, bumpScale: 0.6 });
  const ledMat = std({ color: 0x000000, emissive: 0xdde9ff, emissiveIntensity: 2.2 });
  for (const s of [-1, 1]) {
    plane(S, L0 - L1, H, wall, s * W / 2, H / 2, (L0 + L1) / 2, 0, -s * Math.PI / 2);
    box(S, 0.03, 0.03, L0 - L1, ledMat, s * (W / 2 - 0.05), 0.15, (L0 + L1) / 2, { cast: false });
    for (const d of [10, 25, 50]) sign(S, [`${d} M`], 0.7, 0.3, s * (W / 2 - 0.02), 2.6, -d + 1.5, { bg: '#1d1f22', color: '#e3a948', size: 80, ry: -s * Math.PI / 2 });
  }
  plane(S, W, H, wall, 0, H / 2, L0, 0, Math.PI);
  // back wall with deflection panels
  box(S, W, H, 0.4, std({ ...TX.granulate([10, 4]), roughness: 1 }), 0, H / 2, L1, {});
  // ceiling with linear LED runs
  plane(S, W, L0 - L1, std({ color: 0x111214, roughness: 0.9 }), 0, H, (L0 + L1) / 2, Math.PI / 2);
  R.timeObjs.led = ledMat;
  for (const x of [-3.2, 0, 3.2]) box(S, 0.06, 0.03, 50, ledMat, x, H - 0.03, -20, { cast: false });
  R.lights.push(rectLight(S, 0xe8efff, 5, 6, 1.0, 0, H - 0.05, 0.6, 0, 0, 0.6));
  for (const z of [-10, -25, -50]) {
    R.lights.push(rectLight(S, 0xffffff, 10, 9, 0.6, 0, H - 0.1, z + 1.5, 0, 1.4, z));
    box(S, 9, 0.05, 0.2, ledMat, 0, H - 0.05, z + 1.5, { cast: false });
  }
  for (const z of [-5, -17, -37]) R.lights.push(rectLight(S, 0xdde6ff, 3, 0.06, 40, 0, H - 0.04, z, 0, 0, z));
  // shooting desks with integrated scoring monitors
  const desk = std({ color: 0x2b2e33, roughness: 0.35, metalness: 0.6 });
  const top = std({ color: 0xd9d6cf, roughness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fb4c4, roughness: 0.05, transparent: true, opacity: 0.12, metalness: 0 });
  for (let k = -3; k <= 3; k++) {
    box(S, 0.06, 1.0, 0.06, desk, k * 1.6 - 0.55, 0.5, -0.4);
    box(S, 0.06, 1.0, 0.06, desk, k * 1.6 + 0.55, 0.5, -0.4);
    box(S, 1.25, 0.04, 0.55, top, k * 1.6, 1.0, -0.4);
    box(S, 0.04, 2.0, 1.6, glass, k * 1.6 + 0.8, 1.0, 0.2, { cast: false });
  }
  // the player's in-world scoring monitor (live texture provided by game)
  const mc = document.createElement('canvas'); mc.width = mc.height = 256;
  R.monitorCanvas = mc; R.monitorTex = new THREE.CanvasTexture(mc); R.monitorTex.colorSpace = THREE.SRGBColorSpace;
  const mon = new THREE.Group(); mon.position.set(0.48, 1.02, -0.45); mon.rotation.y = -0.45;
  box(mon, 0.02, 0.18, 0.02, desk, 0, 0.09, 0.02);
  box(mon, 0.26, 0.2, 0.02, desk, 0, 0.24, 0);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.18), new THREE.MeshBasicMaterial({ map: R.monitorTex }));
  screen.position.set(0, 0.24, 0.011); mon.add(screen); mon.rotation.x = -0.25; S.add(mon);
  earMuffs(S, -0.4, 1.02, -0.3, mats);
  gearBag(S, 0.4, 0, 0.6, mats.bag);
  const key = new THREE.SpotLight(0xffffff, 40, 30, 0.8, 0.7, 1.4);
  key.position.set(-0.4, H - 0.3, 1.6); key.target.position.set(0, 0.8, -5);
  key.castShadow = true; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; S.add(key, key.target); R.shadowLight = key;
  S.add(new THREE.HemisphereLight(0xd0dcef, 0x1a1a1a, 0.2));
  R.vmLight = { color: 0xf0f4ff, intensity: 1.4, dir: new THREE.Vector3(-0.2, 1, 0.5), hemi: [0xd0dcef, 0x1a1a1a, 0.55] };
  R._setTime = (t) => { ledMat.emissiveIntensity = t === 'night' ? 3 : 2.2; };
  sceneEnv(R, 1.5);
}

// ---------------- sky helpers ----------------
function setupSky(R, size = 15000) {
  const sky = new Sky(); sky.scale.setScalar(size);
  R.scene.add(sky); R.sky = sky;
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true; sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
  R.scene.add(sun, sun.target); R.sun = sun; R.shadowLight = sun;
  const hemi = new THREE.HemisphereLight(0xcfe0f5, 0x6b6048, 0.9); R.scene.add(hemi); R.hemi = hemi;
  const stars = new THREE.Mesh(new THREE.SphereGeometry(size * 0.4, 32, 16), new THREE.MeshBasicMaterial({ map: TX.starsTexture(), side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  stars.material.map.wrapS = stars.material.map.wrapT = THREE.RepeatWrapping; stars.material.map.repeat.set(4, 2);
  R.scene.add(stars); R.stars = stars;
  const skyScene = new THREE.Scene(); R.skyScene = skyScene;
}
function applySky(R, tod, shadowCenter, shadowExtent) {
  const c = TOD[tod];
  const u = R.sky.material.uniforms;
  u.turbidity.value = c.turb; u.rayleigh.value = c.ray; u.mieCoefficient.value = c.mie; u.mieDirectionalG.value = 0.8;
  const phi = (90 - c.elev) * DEG, theta = c.azim * DEG;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  u.sunPosition.value.copy(sunDir);
  const night = tod === 'night';
  const lightDir = night ? new THREE.Vector3().setFromSphericalCoords(1, (90 - 35) * DEG, 160 * DEG) : sunDir;
  R.sun.color.setHex(c.sun); R.sun.intensity = c.sunI;
  R.sun.position.copy(shadowCenter).addScaledVector(lightDir, shadowExtent * 2);
  R.sun.target.position.copy(shadowCenter);
  const sc = R.sun.shadow.camera;
  sc.left = -shadowExtent; sc.right = shadowExtent; sc.top = shadowExtent; sc.bottom = -shadowExtent;
  sc.near = 0.5; sc.far = shadowExtent * 5; sc.updateProjectionMatrix();
  R.hemi.color.setHex(c.sky); R.hemi.groundColor.setHex(c.ground); R.hemi.intensity = c.hemiI;
  R.stars.material.opacity = night ? 0.9 : 0;
  R.exposure = c.exposure;
  if (R.scene.fog) R.scene.fog.color.setHex(c.fog);
  // env map from sky only (fast)
  const skyClone = new Sky(); skyClone.scale.setScalar(1000);
  for (const k of Object.keys(u)) skyClone.material.uniforms[k].value = u[k].value;
  const sc2 = new THREE.Scene(); sc2.add(skyClone);
  if (night) sc2.background = new THREE.Color(0x05070d);
  if (R.skyEnvRT) R.skyEnvRT.dispose();
  R.skyEnvRT = R.ctx.pmrem.fromScene(sc2, 0.04);
  skyClone.geometry.dispose(); skyClone.material.dispose();
  R.scene.environment = R.skyEnvRT.texture; R.envMap = R.skyEnvRT.texture;
  R.envIntensity = night ? 0.25 : 1;
  R.vmLight = { color: c.sun, intensity: night ? 0.4 : c.sunI * 0.7, dir: lightDir.clone(), hemi: [c.sky, c.ground, c.hemiI * 0.8] };
}

function trees(R, count, sampler, rng) {
  const cone = new THREE.ConeGeometry(1, 1, 7); cone.translate(0, 0.5, 0);
  const mat = std({ color: 0xffffff, roughness: 0.9, vertexColors: false });
  const inst = new THREE.InstancedMesh(cone, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  let n = 0;
  for (let i = 0; i < count * 4 && n < count; i++) {
    const r = sampler(rng); if (!r) continue;
    const h = r.h || 8 + rng() * 14;
    p.set(r.x, r.y - 0.5, r.z); s.set(h * 0.28, h, h * 0.28); q.setFromEuler(new THREE.Euler(0, rng() * 6, 0));
    m.compose(p, q, s); inst.setMatrixAt(n, m);
    col.setHSL(0.27 + rng() * 0.06, 0.35 + rng() * 0.2, 0.12 + rng() * 0.08); inst.setColorAt(n, col);
    n++;
  }
  inst.count = n; inst.castShadow = true; inst.receiveShadow = true;
  R.scene.add(inst);
  return inst;
}

function berm(parent, len, bottom, topW, h, mat, x, z, ry = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(-bottom / 2, 0); shape.lineTo(-topW / 2, h); shape.lineTo(topW / 2, h); shape.lineTo(bottom / 2, 0); shape.lineTo(-bottom / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: true, bevelThickness: 1, bevelSize: 0.8, bevelSegments: 3, steps: 1 });
  geo.translate(0, 0, -len / 2);
  const m = new THREE.Mesh(geo, mat); m.position.set(x, 0, z); m.rotation.y = ry; m.receiveShadow = true; m.castShadow = true;
  parent.add(m); return m;
}

// ---------------- 3. Outdoor sport range ----------------
function buildOutdoor(R, mats) {
  const S = R.scene;
  R.indoor = false; R.stand = 'frame'; R.targetY = 1.45; R.lanePitch = 3; R.lanes = [-2, -1, 1, 2];
  R.targetR = (d) => scaleTargetR(0.45, d, 25, 0.6);
  R.reverb = 'outdoor'; R.ambient = 'outdoor'; R.far = 16000; R.near = 0.1;
  S.fog = new THREE.FogExp2(0xc6d4e2, 0.0011);
  setupSky(R);
  const g = std({ ...TX.grass([180, 180]), roughness: 0.95, bumpScale: 0.8 });
  plane(S, 900, 900, g, 0, 0, -200, -Math.PI / 2);
  const dirtM = std({ ...TX.dirt([4, 2]), roughness: 1, bumpScale: 1 });
  for (const d of [25, 50, 100]) plane(S, 16, 3, dirtM, 0, 0.01, -d, -Math.PI / 2);
  const bermMat = std({ ...TX.grass([30, 6]), roughness: 1, bumpScale: 1 });
  berm(S, 120, 12, 2.5, 4.5, bermMat, -12, -55);
  berm(S, 120, 12, 2.5, 4.5, bermMat, 12, -55);
  berm(S, 40, 14, 3, 8, std({ ...TX.dirt([12, 4], '#6a5741'), roughness: 1, bumpScale: 1.5 }), 0, -113, Math.PI / 2);
  // covered firing line
  const conc = std({ ...TX.concrete([4, 2], '#9a9893', 3), roughness: 0.85 });
  box(S, 15, 0.12, 5, conc, 0, 0.06, 1.0);
  const roof = std({ ...TX.corrugated([20, 1]), roughness: 0.5, metalness: 0.7, bumpScale: 2, side: THREE.DoubleSide });
  box(S, 16, 0.06, 5.5, roof, 0, 2.75, 1.0, { rx: -0.05 });
  for (const x of [-7.5, -2.5, 2.5, 7.5]) for (const z of [-1.4, 3.4]) cyl(S, 0.06, 0.06, 2.75, mats.steel, x, 1.375, z, 10);
  const bench = std({ ...TX.wood([2, 1], '#7b5a3a', 4, 21), roughness: 0.75 });
  for (let k = -2; k <= 2; k++) {
    box(S, 1.6, 0.06, 0.7, bench, k * 3, 0.98, -0.45);
    for (const sx of [-0.7, 0.7]) box(S, 0.08, 0.95, 0.6, bench, k * 3 + sx, 0.48, -0.45);
    sign(S, [String(k + 3)], 0.35, 0.35, k * 3, 2.45, -1.42, { bg: '#16181a', color: '#f0f0f0', size: 200 });
  }
  spottingScope(S, 0.5, 1.01, -0.4, mats);
  earMuffs(S, -0.5, 1.01, -0.35, mats);
  gearBag(S, -0.6, 0.12, 1.0, mats.bag);
  for (const d of [25, 50, 100]) {
    for (const s of [-1, 1]) {
      const post = cyl(S, 0.04, 0.04, 1.4, mats.wood, s * 7.6, 0.7, -d + 2, 8);
      sign(S, [`${d}`], 0.7, 0.45, s * 7.6, 1.5, -d + 2.03, { bg: '#f3f1ea', color: '#1a1a1a', size: 170 });
    }
  }
  makeFlag(S, -7.2, -50, 5, R.updaters);
  makeFlag(S, 7.2, -100, 6, R.updaters);
  const rng = mulberry32(7);
  trees(R, 420, (r) => {
    const x = (r() - 0.5) * 700, z = 60 - r() * 500;
    if (Math.abs(x) < 22 && z > -125) return null;
    if (Math.hypot(x, z) < 30) return null;
    return { x, y: 0, z };
  }, rng);
  // floodlights for night
  const floods = [];
  for (const s of [-1, 1]) {
    cyl(S, 0.08, 0.1, 9, mats.steel, s * 9, 4.5, -60, 8);
    const f = new THREE.SpotLight(0xfff1dd, 0, 140, 0.55, 0.5, 1.2); f.position.set(s * 9, 9, -60); f.target.position.set(0, 0, -80);
    S.add(f, f.target); floods.push(f);
    const lamp = box(S, 0.8, 0.4, 0.3, std({ color: 0x222, emissive: 0xfff1dd, emissiveIntensity: 0 }), s * 9, 9, -60, { cast: false });
    floods.push(lamp);
  }
  const shelterLight = new THREE.PointLight(0xfff0dc, 0, 12, 2); shelterLight.position.set(0, 2.5, 0.5); S.add(shelterLight);
  R._setTime = (t) => {
    applySky(R, t, new THREE.Vector3(0, 0, -40), 70);
    const night = t === 'night';
    floods.forEach((f) => { if (f.isLight) f.intensity = night ? 8000 : 0; else f.material.emissiveIntensity = night ? 4 : 0; });
    shelterLight.intensity = night ? 18 : 0;
  };
}

// ---------------- 4. Alpine long range ----------------
function terrainHeight(x, z) {
  const lat = Math.abs(x);
  const valley = 70 + Math.max(0, -z) * 0.07;
  const rid = ridged2(x * 0.0011 + 7, z * 0.0011 + 3, 5);
  let h = smoothstep(valley, valley + 700, lat) * (120 + rid * 380);
  h = Math.max(h, smoothstep(1350, 2300, -z) * (220 + rid * 600));
  h = Math.max(h, smoothstep(120, 900, z) * (140 + rid * 200));
  const d = Math.hypot(x, z + 1400);
  const peaks = smoothstep(2300, 4600, d) * (700 + ridged2(x * 0.00045 + 1, z * 0.00045 + 9, 6) * 1900);
  h = Math.max(h, peaks);
  h += (fbm2(x * 0.01, z * 0.01, 4) - 0.5) * 8 * smoothstep(30, 160, lat);
  return h;
}
function buildMountain(R, mats) {
  const S = R.scene;
  R.indoor = false; R.stand = 'frame'; R.lanePitch = 14; R.lanes = [-2, -1, 1, 2];
  R.targetR = (d) => scaleTargetR(1.0, d, 300, 0.65);
  R.targetCenterY = (d, r) => 1.2 + r * 1.2;
  R.reverb = 'mountain'; R.ambient = 'mountain'; R.far = 16000; R.near = 0.15;
  S.fog = new THREE.FogExp2(0xc6d4e2, 0.000105);
  setupSky(R);
  // terrain
  const SEG = R.ctx.quality === 'low' ? 160 : 256;
  const geo = new THREE.PlaneGeometry(14000, 14000, SEG, SEG); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -1500);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
  const grassC = new THREE.Color(0x4f5f2f), dryC = new THREE.Color(0x7a7448), rockC = new THREE.Color(0x6c6863), snowC = new THREE.Color(0xf1f3f6), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z); pos.setY(i, h);
    const slope = Math.abs(terrainHeight(x + 30, z) - h) + Math.abs(terrainHeight(x, z + 30) - h);
    const n = fbm2(x * 0.003, z * 0.003, 3);
    c.copy(grassC).lerp(dryC, n * 0.8);
    c.lerp(rockC, smoothstep(250, 700, h + n * 200) * 0.9 + smoothstep(18, 45, slope) * 0.6);
    c.lerp(snowC, smoothstep(1050, 1350, h + n * 300 - slope * 3));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const terr = new THREE.Mesh(geo, std({ vertexColors: true, roughness: 0.95 }));
  terr.receiveShadow = true; S.add(terr);
  // range floor (detailed grass corridor)
  const g = std({ ...TX.grass([40, 700]), roughness: 0.95, bumpScale: 0.8 });
  plane(S, 120, 1400, g, 0, 0.05, -650, -Math.PI / 2);
  // firing deck
  const deck = std({ ...TX.wood([4, 3], '#7d5d3c', 10, 15), roughness: 0.8 });
  box(S, 10, 0.2, 5, deck, 0, 0.1, 1.2);
  const roof = std({ ...TX.wood([6, 2], '#5a3f28', 14, 16), roughness: 0.8 });
  box(S, 11, 0.12, 6, roof, 0, 2.85, 1.2, { rx: -0.08 });
  for (const x of [-4.8, 4.8]) for (const z of [-1.1, 3.6]) box(S, 0.18, 2.8, 0.18, roof, x, 1.4, z);
  const benchMat = std({ ...TX.wood([2, 1], '#6f5132', 3, 19), roughness: 0.7 });
  for (const x of [-3.2, 0, 3.2]) {
    box(S, 1.8, 0.07, 0.8, benchMat, x, 1.0, -0.5);
    for (const sx of [-0.8, 0.8]) box(S, 0.1, 0.95, 0.7, benchMat, x + sx, 0.55, -0.5);
  }
  spottingScope(S, 0.55, 1.035, -0.45, mats);
  earMuffs(S, -0.55, 1.035, -0.4, mats);
  // targets: backstop mounds + number boards (main targets placed by game)
  const dirtMat = std({ ...TX.dirt([6, 2], '#6a5741'), roughness: 1, bumpScale: 1 });
  const lastD = R.def.distances[R.def.distances.length - 1];
  for (const d of R.def.distances) {
    const r = R.targetR(d);
    for (const k of [-2, -1, 0, 1, 2]) {
      if (k === 0 && d !== lastD) {
        // low mantlet in front of the centre-lane target: keeps the sightline to farther targets clear
        box(S, r * 2.6, 0.9, 0.6, dirtMat, 0, 0.45, -d + r * 0.8);
      } else berm(S, r * 6, r * 4, r * 1.2, r * 3.4, dirtMat, k * R.lanePitch, -d - r * 3.5, Math.PI / 2);
    }
    sign(S, [`${d}`], r * 1.6, r * 0.9, -2.5 * R.lanePitch - r, r * 0.6 + 0.6, -d, { bg: '#f2efe6', color: '#1b1b1b', size: 180 });
  }
  for (const d of [150, 450, 800]) makeFlag(S, 22, -d, 7, R.updaters, d === 450 ? '#e8b22e' : '#d9452f');
  for (const d of [250, 650, 1000]) makeFlag(S, -22, -d, 7, R.updaters);
  const rng = mulberry32(11);
  const n = { low: 900, medium: 1600, high: 2400, ultra: 3200 }[R.ctx.quality] || 1600;
  trees(R, n, (r) => {
    const x = (r() - 0.5) * 5000, z = 400 - r() * 3600;
    if (Math.abs(x) < 110) return null;
    const h = terrainHeight(x, z);
    if (h > 650 || Math.hypot(x, z) < 60) return null;
    return { x, y: h, z, h: 10 + r() * 16 };
  }, rng);
  const deckLight = new THREE.PointLight(0xffe2c0, 0, 12, 2); deckLight.position.set(0, 2.6, 0.8); S.add(deckLight);
  const tlights = [];
  for (const d of R.def.distances) {
    const l = new THREE.SpotLight(0xfff0dd, 0, d * 0.3, 0.5, 0.5, 1); const r = R.targetR(d);
    l.position.set(0, r * 3, -d + r * 8); l.target.position.set(0, r * 1.2, -d); S.add(l, l.target); tlights.push([l, r]);
  }
  R._setTime = (t) => {
    applySky(R, t, new THREE.Vector3(0, 0, -6), 18);
    const night = t === 'night';
    deckLight.intensity = night ? 12 : 0;
    tlights.forEach(([l, r]) => (l.intensity = night ? 900 * r * r : 0));
  };
}

// ---------------- 5. World cup arena ----------------
function buildArena(R, mats) {
  const S = R.scene;
  R.stand = 'electronic'; R.targetY = 1.4; R.lanePitch = 1.8; R.lanes = [-4, -3, -2, -1, 1, 2, 3, 4];
  R.targetR = (d) => scaleTargetR(0.26, d, 10, 0.6);
  R.reverb = 'arena'; R.ambient = 'arena'; R.far = 300; R.exposure = 1.3;
  S.background = new THREE.Color(0x050608);
  const W = 44, L0 = 18, L1 = -60, H = 13;
  const floorMat = std({ ...TX.panel([20, 30], '#1b2733', 8), roughness: 0.55, bumpScale: 0.2 });
  plane(S, W, L0 - L1, floorMat, 0, 0, (L0 + L1) / 2, -Math.PI / 2);
  const fop = std({ color: 0x24272b, roughness: 0.45, metalness: 0.2 });
  box(S, 18, 0.16, 4, fop, 0, 0.08, 0.6);
  plane(S, 18, 0.07, std({ color: 0xe3a948, emissive: 0xe3a948, emissiveIntensity: 0.6 }), 0, 0.165, -1.35, -Math.PI / 2);
  // range area walls
  const wall = std({ ...TX.panel([24, 3], '#14171b', 6), roughness: 0.7, bumpScale: 0.4 });
  plane(S, W, H, wall, 0, H / 2, L1, 0, 0);
  plane(S, W, H, wall, 0, H / 2, L0, 0, Math.PI);
  for (const s of [-1, 1]) plane(S, L0 - L1, H, wall, s * W / 2, H / 2, (L0 + L1) / 2, 0, -s * Math.PI / 2);
  plane(S, W, L0 - L1, std({ color: 0x0b0c0e, roughness: 1 }), 0, H, (L0 + L1) / 2, Math.PI / 2);
  // backstop
  box(S, 20, 4, 0.5, std({ ...TX.granulate([14, 4]), roughness: 1 }), 0, 2, -55);
  // stands along sides (tiers) with instanced spectators
  const tierMat = std({ color: 0x2a2e35, roughness: 0.8 });
  const seatMat = std({ color: 0x1d3f6e, roughness: 0.6 });
  const people = [];
  const rng = mulberry32(5);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const x = s * (13 + i * 0.95), y = 0.45 * i + 0.25;
      box(S, 0.95, 0.45 * (i + 1) + 0.25, 34, tierMat, x, (0.45 * (i + 1) + 0.25) / 2, -4, { cast: false });
      box(S, 0.5, 0.35, 34, seatMat, x - s * 0.1, y + 0.45 + 0.17, -4, { cast: false });
      for (let z = 12; z > -20; z -= 0.62) if (rng() < 0.72) people.push([x - s * 0.05, y + 0.62, z + (rng() - 0.5) * 0.1, s]);
    }
  }
  // behind the athletes
  for (let i = 0; i < 7; i++) {
    const z = 6 + i * 0.95, y = 0.45 * i + 0.25;
    box(S, 22, 0.45 * (i + 1) + 0.25, 0.95, tierMat, 0, (0.45 * (i + 1) + 0.25) / 2, z, { cast: false });
    for (let x = -10; x < 10; x += 0.62) if (rng() < 0.7) people.push([x, y + 0.62 + 0.45, z, 0]);
  }
  const body = new THREE.CapsuleGeometry(0.2, 0.45, 4, 8); body.translate(0, 0.42, 0);
  const head = new THREE.SphereGeometry(0.11, 10, 8); head.translate(0, 0.98, 0);
  const pm = new THREE.InstancedMesh(body, std({ roughness: 0.85 }), people.length);
  const hm = new THREE.InstancedMesh(head, std({ roughness: 0.7 }), people.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const shirt = [0x2f4f8f, 0xd8d8d8, 0x8f2f2f, 0x2f2f33, 0x3f6f4f, 0xe0b040, 0x5a5a66];
  const skin = [0xe0b590, 0xc58c63, 0x8d5a3b, 0xf0c8a8];
  people.forEach((p, i) => {
    m4.makeRotationY(p[3] === 0 ? Math.PI : -p[3] * Math.PI / 2); m4.setPosition(p[0], p[1], p[2]);
    pm.setMatrixAt(i, m4); hm.setMatrixAt(i, m4);
    pm.setColorAt(i, col.setHex(shirt[Math.floor(rng() * shirt.length)]));
    hm.setColorAt(i, col.setHex(skin[Math.floor(rng() * skin.length)]));
  });
  S.add(pm, hm);
  R.crowd = { pm, hm, people };
  // athlete stands at each firing point
  for (let k = -4; k <= 4; k++) {
    box(S, 0.9, 0.04, 0.5, std({ color: 0xdddad3, roughness: 0.5 }), k * 1.8, 1.0, -0.6);
    box(S, 0.06, 0.84, 0.06, fop, k * 1.8, 0.58, -0.6);
    sign(S, [`${k + 5}`], 0.3, 0.3, k * 1.8, 0.3, -1.2, { bg: '#e3a948', color: '#111', size: 200 });
  }
  // giant scoreboard (live)
  const sc = document.createElement('canvas'); sc.width = 1024; sc.height = 384;
  R.boardCanvas = sc; R.boardTex = new THREE.CanvasTexture(sc); R.boardTex.colorSpace = THREE.SRGBColorSpace;
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: R.boardTex, emissiveIntensity: 1.3 });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), boardMat); board.position.set(0, 8.4, -57); S.add(board);
  box(S, 16.4, 6.4, 0.3, fop, 0, 8.4, -57.25, { cast: false });
  // banners
  sign(S, ['PRECISION RANGE WORLD CUP'], 18, 1.4, 0, 4.9, -54.7, { bg: '#0f1114', color: '#e3a948', size: 80, spacing: '8px', weight: 700 });
  for (const s of [-1, 1]) sign(S, ['FINAL · 10 SHOT MATCH'], 14, 1.2, s * (W / 2 - 0.05), 9.5, -25, { bg: '#e3a948', color: '#0f1114', size: 70, weight: 700, ry: -s * Math.PI / 2 });
  // lighting rigs
  const truss = std({ color: 0x3a3d42, roughness: 0.5, metalness: 0.8 });
  for (const z of [2, -8, -22, -40]) box(S, 30, 0.35, 0.35, truss, 0, H - 2, z, { cast: false });
  const panelMat = std({ color: 0x000, emissive: 0xffffff, emissiveIntensity: 3 });
  for (const z of [-8, -22, -40]) for (const x of [-6, 0, 6]) box(S, 1.2, 0.08, 0.6, panelMat, x, H - 2.25, z, { cast: false });
  R.lights.push(rectLight(S, 0xffffff, 8, 16, 1.2, 0, H - 2.3, 2, 0, 0, 0));
  for (const z of [-8, -22, -40]) R.lights.push(rectLight(S, 0xfff8ee, 9, 18, 0.8, 0, H - 2.3, z, 0, 1.4, z - 10));
  const key = new THREE.SpotLight(0xffffff, 140, 60, 0.4, 0.6, 1.2);
  key.position.set(-3, H - 2.2, 3.5); key.target.position.set(0, 0.8, -3); key.castShadow = true; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  S.add(key, key.target); R.shadowLight = key;
  const crowdLight = new THREE.HemisphereLight(0xc9d6ff, 0x101010, 0.35); S.add(crowdLight);
  const tgtSpots = [];
  for (const d of [10, 25, 50]) { const l = new THREE.SpotLight(0xffffff, 120, d + 20, 0.5, 0.6, 1.2); l.position.set(0, H - 3, -d + 6); l.target.position.set(0, 1.4, -d); S.add(l, l.target); tgtSpots.push(l); }
  R.vmLight = { color: 0xffffff, intensity: 1.8, dir: new THREE.Vector3(-0.3, 1, 0.6), hemi: [0xc9d6ff, 0x101010, 0.6] };
  let wave = 0;
  R.updaters.push((dt, t) => {
    // subtle crowd motion
    wave += dt;
    if (wave > 0.12) {
      wave = 0;
      for (let i = 0; i < 40; i++) {
        const j = Math.floor(Math.random() * people.length), p = people[j];
        m4.makeRotationY((p[3] === 0 ? Math.PI : -p[3] * Math.PI / 2) + (Math.random() - 0.5) * 0.5);
        m4.setPosition(p[0], p[1] + (Math.random() < 0.1 ? 0.03 : 0), p[2]);
        pm.setMatrixAt(j, m4); hm.setMatrixAt(j, m4);
      }
      pm.instanceMatrix.needsUpdate = true; hm.instanceMatrix.needsUpdate = true;
    }
  });
  R._setTime = (t) => { crowdLight.intensity = t === 'night' ? 0.15 : 0.35; boardMat.emissiveIntensity = t === 'night' ? 1.6 : 1.3; };
  sceneEnv(R, 1.6);
}
