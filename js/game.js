// Core game: renderer + post-processing, player aim/recoil/sway, firing & 3D hit detection,
// match modes, viewmodel animation, effects and session flow.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SAOPass } from 'three/addons/postprocessing/SAOPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { buildRange, RANGES } from './ranges.js';
import { WEAPONS, OPTICS, weaponById, buildWeaponModel, makeMaterials } from './weapons.js';
import { Body } from './body.js';
import { ScopeShader, scopeFov, RETICLE_INDEX, RETICLE_RGB } from './scope.js';
import { AudioEngine } from './audio.js';
import * as TX from './textures.js';
import { scoreHit, drawMonitor, setFaceQuality, clearFaceCache } from './target.js';
import { Spring, DEG, clamp, damp, lerp, gauss, easeInOut, smoothstep } from './util.js';

export const MODES = {
  free: { id: 'free', name: 'FREE PRACTICE', kr: '자유 사격', desc: '제한 없이 자유롭게 사격. 10발마다 표적 교체, [F] 거리 변경, [T] 표적 교체.' },
  match10: { id: 'match10', name: '10-SHOT MATCH', kr: '10발 정밀 경기', desc: '10발 · 100점 만점. 결선과 같은 집중력이 필요하다.', shots: 10 },
  match30: { id: 'match30', name: '30-SHOT MATCH', kr: '30발 경기', desc: '10발 3시리즈 합산. 꾸준함을 측정한다.', shots: 30 },
  timed: { id: 'timed', name: 'TIME ATTACK', kr: '시간제한 경기', desc: '60초 안에 최대한 높은 점수. 장전 시간도 기록의 일부.', time: 60 },
  long: { id: 'long', name: 'LONG RANGE CHALLENGE', kr: '장거리 도전', desc: '300m에서 1,100m까지 5단계 × 2발. 산악 경기장에서 진행.', shots: 10, range: 'mountain' },
  random: { id: 'random', name: 'RANDOM TARGETS', kr: '랜덤 표적 도전', desc: '여러 위치에서 순차적으로 일어서는 표적 15개. 반응속도와 정확도.', shots: 15 },
};

// Composite the viewmodel scene over the world image (separate depth so the gun never clips)
class OverlayScenePass extends Pass {
  constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

export function analyze(shots) {
  const n = shots.length;
  const hits = shots.filter((s) => s.score > 0);
  const total = shots.reduce((a, s) => a + s.score, 0);
  const totalDec = Math.round(shots.reduce((a, s) => a + s.dec, 0) * 10) / 10;
  const hist = new Array(11).fill(0); shots.forEach((s) => hist[s.score]++);
  let mx = 0, my = 0; hits.forEach((s) => { mx += s.x; my += s.y; });
  if (hits.length) { mx /= hits.length; my /= hits.length; }
  let spread = 0;
  for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) spread = Math.max(spread, Math.hypot(hits[i].x - hits[j].x, hits[i].y - hits[j].y));
  let streak = 0, best = 0; shots.forEach((s) => { if (s.score === 10) { streak++; best = Math.max(best, streak); } else streak = 0; });
  const reactions = shots.filter((s) => s.reaction != null).map((s) => s.reaction);
  return {
    n, total, totalDec, avg: n ? total / n : 0, avgDec: n ? totalDec / n : 0,
    best: n ? Math.max(...shots.map((s) => s.dec)) : 0,
    tens: shots.filter((s) => s.score === 10).length, inner: shots.filter((s) => s.inner).length,
    misses: n - hits.length, hist, mpi: { x: mx, y: my }, spread: spread * 10, // in ring widths
    streak10: best, reaction: reactions.length ? reactions.reduce((a, b) => a + b, 0) / reactions.length : null,
  };
}

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ');

export class Game {
  constructor(canvas, ui, settings) {
    this.canvas = canvas; this.ui = ui; this.settings = settings;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false;
    TX.setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
    this.pmrem = new THREE.PMREMGenerator(r);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.08, 400); this.camera.rotation.order = 'YXZ';
    this.scopeCam = new THREE.PerspectiveCamera(10, 1, 0.3, 16000); this.scopeCam.rotation.order = 'YXZ';
    this.vmScene = new THREE.Scene();
    this.vmCam = new THREE.PerspectiveCamera(55, 1, 0.01, 6);
    this.vmDir = new THREE.DirectionalLight(0xffffff, 2); this.vmHemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.6);
    this.vmScene.add(this.vmDir, this.vmDir.target, this.vmHemi);
    this.vmRoot = new THREE.Group(); this.vmScene.add(this.vmRoot);
    this.audio = new AudioEngine();
    this.body = new Body();
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.state = 'boot';
    this.time = 0;
    this.input = { fire: false, focus: false, adsHeld: false };
    this.locked = false; this.freeMouse = false;
    this.yaw = 0; this.pitch = 0;
    this.ads = 0; this.adsTarget = 0;
    this.recP = new Spring(120, 14); this.recY = new Spring(120, 14);
    this.mBack = new Spring(400, 26); this.mRot = new Spring(400, 26);
    this.lagX = new Spring(60, 11); this.lagY = new Spring(60, 11);
    this.shake = 0; this.heat = 0;
    this.events = []; this.fx = [];
    this.fps = 60; this.testMode = false;
    this.initFX();
    this.applyQuality(true);
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.body.onHeartbeat = (b) => {
      if (this.state !== 'playing' || !this.settings.heartbeatSound) return;
      const lvl = (this.ads > 0.6 ? 1 : 0.3) * (0.05 + b.tension * 0.25 + (b.focusActive ? 0.3 : 0) + b.focusDebt * 0.15);
      this.audio.heartbeat(lvl);
    };
    this.body.onFocusStart = () => { this.audio.play('breathIn', { gain: 0.5 }); this.audio.setFocus(true); };
    this.body.onFocusEnd = (ex) => { this.audio.play('breathOut', { gain: ex ? 0.8 : 0.5 }); this.audio.setFocus(false); if (ex) this.ui.toast('FOCUS DEPLETED · 회복 중', 'warn'); };
  }

  // ---------------- rendering setup ----------------
  applyQuality(first = false) {
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = { low: Math.min(dpr, 1) * 0.75, medium: Math.min(dpr, 1), high: Math.min(dpr, 1.5), ultra: Math.min(dpr, 2) }[q] || 1;
    this.renderer.setPixelRatio(this.pixelRatio);
    TX.setTextureQuality(q); setFaceQuality(q);
    this.shadowSize = { low: 0, medium: 1024, high: 2048, ultra: 4096 }[q];
    const scopeSize = { low: 512, medium: 768, high: 1024, ultra: 1536 }[q];
    if (this.scopeRT) this.scopeRT.dispose();
    this.scopeRT = new THREE.WebGLRenderTarget(scopeSize, scopeSize, { type: THREE.HalfFloatType, samples: q === 'low' ? 0 : 4 });
    this.buildComposer();
    if (this.range) this.applyShadowQuality();
  }
  applyShadowQuality() {
    const l = this.range.shadowLight;
    if (!l) return;
    l.castShadow = this.shadowSize > 0;
    if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    l.shadow.mapSize.set(this.shadowSize || 512, this.shadowSize || 512);
    l.shadow.radius = 3;
  }
  buildComposer() {
    const q = this.settings.quality;
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: (q === 'high' || q === 'ultra') ? 4 : 0 });
    const c = this.composer = new EffectComposer(this.renderer, rt);
    this.worldPass = new RenderPass(this.range ? this.range.scene : new THREE.Scene(), this.camera);
    c.addPass(this.worldPass);
    this.saoPass = null;
    if (q === 'ultra') {
      this.saoPass = new SAOPass(this.range ? this.range.scene : new THREE.Scene(), this.camera);
      const p = this.saoPass.params;
      p.saoIntensity = 0.012; p.saoScale = 2.2; p.saoKernelRadius = 26; p.saoMinResolution = 0; p.saoBlur = true; p.saoBlurRadius = 6; p.saoBias = 0.6;
      this.saoPass.enabled = !!(this.range && this.range.indoor);
      c.addPass(this.saoPass);
    }
    this.vmPass = new OverlayScenePass(this.vmScene, this.vmCam); c.addPass(this.vmPass);
    this.bloomPass = null;
    if (q === 'high' || q === 'ultra') { this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.45, 0.88); c.addPass(this.bloomPass); }
    this.scopePass = new ShaderPass(ScopeShader); this.scopePass.uniforms.tScope.value = this.scopeRT.texture; c.addPass(this.scopePass);
    c.addPass(new OutputPass());
    this.fxaa = null;
    if (q === 'medium' || q === 'low') { this.fxaa = new ShaderPass(FXAAShader); c.addPass(this.fxaa); }
    this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCam.aspect = w / h; this.vmCam.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio); this.composer.setSize(w, h);
      if (this.fxaa) this.fxaa.uniforms.resolution.value.set(1 / (w * this.pixelRatio), 1 / (h * this.pixelRatio));
      const u = this.scopePass.uniforms;
      u.aspect.value = w / h; u.px.value = 1 / (h * this.pixelRatio); u.blurPx.value.set(1 / (w * this.pixelRatio), 1 / (h * this.pixelRatio));
    }
  }

  initFX() {
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.flashSprite(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false; this.vmScene.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 3, 2); this.vmScene.add(this.flashLight);
    this.smokeMat = new THREE.SpriteMaterial({ map: TX.smokeSprite(), depthWrite: false, transparent: true, opacity: 0 });
    this.smokes = [];
    for (let i = 0; i < 10; i++) { const s = new THREE.Sprite(this.smokeMat.clone()); s.visible = false; this.vmScene.add(s); this.smokes.push({ s, life: 0, v: new THREE.Vector3() }); }
    const caseGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 0.016, 10);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc89b45, metalness: 1, roughness: 0.25 });
    this.cases = [];
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(caseGeo, brass); m.visible = false; this.vmScene.add(m); this.cases.push({ m, life: 0, v: new THREE.Vector3(), w: new THREE.Vector3() }); }
    this.dustMat = new THREE.SpriteMaterial({ map: TX.smokeSprite(), color: 0xb7a98e, depthWrite: false, transparent: true });
    this.dusts = [];
    this.worldFlash = new THREE.PointLight(0xffc070, 0, 6, 2);
  }

  // ---------------- input ----------------
  bindInput() {
    const c = this.canvas;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked && this.state === 'playing' && !this.freeMouse) this.pause();
    });
    document.addEventListener('pointerlockerror', () => {
      if (!this.freeMouse) this.ui.toast('포인터 고정 불가 — 자유 마우스 모드', 'warn');
      this.freeMouse = true;
    });
    c.addEventListener('click', () => { if (this.state === 'playing' && !this.locked) this.lockPointer(); });
    document.addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' || !(this.locked || this.freeMouse)) return;
      this.look(e.movementX || 0, e.movementY || 0);
    });
    c.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing' || !(this.locked || this.freeMouse)) return;
      if (e.button === 0) { this.input.fire = true; this.tryFire(); }
      if (e.button === 2) {
        if (this.settings.adsToggle) this.adsTarget = this.adsTarget > 0.5 ? 0 : 1;
        else this.adsTarget = 1;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.input.fire = false;
      if (e.button === 2 && !this.settings.adsToggle) this.adsTarget = 0;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      if (this.state !== 'playing') return;
      e.preventDefault();
      this.changeMag(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    document.addEventListener('keydown', (e) => {
      if (this.state !== 'playing') {
        if (e.code === 'Escape' && this.state === 'paused' && this.freeMouse) this.resume();
        return;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.input.focus = true;
      if (e.code === 'KeyR') this.reload();
      if (e.code === 'KeyF' && this.session?.mode === 'free') this.cycleDistance();
      if (e.code === 'KeyT' && this.session?.mode === 'free') this.replaceMain();
      if (e.code === 'Escape' && this.freeMouse) this.pause();
      if (e.code === 'Digit1') this.changeMag(-99);
    });
    document.addEventListener('keyup', (e) => { if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.input.focus = false; });
    window.addEventListener('blur', () => { this.input.focus = false; this.input.fire = false; });
  }
  lockPointer() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        try { const p2 = this.canvas.requestPointerLock(); if (p2 && p2.catch) p2.catch(() => { this.freeMouse = true; }); } catch { this.freeMouse = true; }
      });
    } catch { this.freeMouse = true; }
  }
  look(dx, dy) {
    const s = this.settings;
    const baseHalf = Math.tan(s.fov * DEG / 2);
    let scale = s.sens;
    if (this.ads > 0.5) {
      const mainHalf = Math.tan(this.camera.fov * DEG / 2);
      const mag = this.isScope() ? this.curMag : 1;
      scale = s.sens * s.adsSens * mainHalf / (baseHalf * mag);
    }
    const k = 0.0016 * scale;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (s.invertY ? -1 : 1);
    this.yaw = clamp(this.yaw, -75 * DEG, 75 * DEG);
    this.pitch = clamp(this.pitch, -35 * DEG, 25 * DEG);
    const inertia = this.weapon ? this.weapon.sway.inertia : 1;
    const adsDamp = 1 - this.ads * 0.75;
    this.lagX.impulse(-dy * 0.0009 * inertia * adsDamp * Math.min(1, 1 / Math.max(scale, 0.2)));
    this.lagY.impulse(-dx * 0.0009 * inertia * adsDamp * Math.min(1, 1 / Math.max(scale, 0.2)));
  }

  // ---------------- world loading ----------------
  async loadRange(id, tod) {
    if (this.range) { this.range.dispose(); TX.clearTextureCache(); clearFaceCache(); this.dusts.forEach((d) => d.s.parent && d.s.parent.remove(d.s)); }
    this.renderer.shadowMap.needsUpdate = true;
    this.range = buildRange(id, { renderer: this.renderer, pmrem: this.pmrem, quality: this.settings.quality, tod });
    this.rangeQuality = this.settings.quality;
    this.worldPass.scene = this.range.scene;
    if (this.saoPass) { this.saoPass.scene = this.range.scene; this.saoPass.enabled = !!this.range.indoor; }
    this.camera.near = this.range.near; this.camera.far = this.range.far; this.camera.updateProjectionMatrix();
    this.range.scene.add(this.worldFlash);
    this.applyShadowQuality();
    this.applyRangeLighting();
    this.audio.setEnvironment(this.range.reverb, this.range.ambient);
    this.renderer.shadowMap.needsUpdate = true;
    // warm up shaders to avoid hitches
    try { this.renderer.compile(this.range.scene, this.camera); } catch { /* ignore */ }
  }
  applyRangeLighting() {
    const R = this.range, v = R.vmLight;
    this.vmDir.color.setHex(v.color); this.vmDir.intensity = v.intensity;
    this.vmDir.position.copy(v.dir).normalize().multiplyScalar(3);
    this.vmHemi.color.setHex(v.hemi[0]); this.vmHemi.groundColor.setHex(v.hemi[1]); this.vmHemi.intensity = v.hemi[2];
    this.vmScene.environment = R.envMap;
    this.renderer.toneMappingExposure = R.exposure;
  }

  async showMenuBackground(rangeId = 'indoor', tod) {
    this.state = 'menu';
    if (!this.range || this.range.id !== rangeId) await this.loadRange(rangeId, tod);
    this.clearViewmodel();
    if (!this.range.decor.length) this.range.populateDecor('pistol');
    if (!this.menuTarget) this.menuTarget = this.range.makeTarget(this.range.def.distances[0], 0, 'pistol');
  }

  clearViewmodel() {
    if (this.vm) { this.vmRoot.remove(this.vm.root); this.vm.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); this.vm = null; }
  }
  buildViewmodel(cfg) {
    this.clearViewmodel();
    const def = this.weapon;
    const M = makeMaterials(cfg.finish, cfg.stock);
    this.vm = buildWeaponModel(def, { optic: cfg.optic }, M);
    for (const m of Object.values(M)) if (m.envMapIntensity !== undefined && m !== M.glass) m.envMapIntensity = this.range.envIntensity ?? 1;
    this.vmRoot.add(this.vm.root);
    this.vm.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    const pistol = def.cls === 'pistol';
    this.hipPos = pistol ? new THREE.Vector3(0.1, -0.13, -0.45) : new THREE.Vector3(0.12, -0.12, -0.3);
    this.hipRot = pistol ? new THREE.Euler(0.03, 0.08, 0.02) : new THREE.Euler(0.02, 0.05, 0.03);
    this.adsPos = new THREE.Vector3(0, -this.vm.sightH, -this.vm.eyeZ);
  }

  // ---------------- session ----------------
  async startSession(cfg) {
    this.audio.init();
    const mode = MODES[cfg.mode];
    if (mode.range) cfg.range = mode.range;
    if (!RANGES.find((r) => r.id === cfg.range)) cfg.range = 'indoor';
    this.ui.setLoading(true, `${RANGES.find((r) => r.id === cfg.range).name}`);
    await new Promise((r) => setTimeout(r, 30));
    const needLoad = !this.range || this.range.id !== cfg.range || this.rangeQuality !== this.settings.quality;
    if (needLoad) await this.loadRange(cfg.range, cfg.tod);
    else { this.range.setTime(cfg.tod); this.applyRangeLighting(); this.audio.setEnvironment(this.range.reverb, this.range.ambient); this.renderer.shadowMap.needsUpdate = true; }
    if (this.menuTarget) { this.range.removeTarget(this.menuTarget); this.menuTarget = null; }
    if (this.session) this.cleanupSessionTargets();
    this.cfg = cfg;
    this.weapon = weaponById(cfg.weapon);
    this.optic = OPTICS[cfg.optic] && this.weapon.optics.includes(cfg.optic) ? OPTICS[cfg.optic] : OPTICS[this.weapon.optics[0]];
    this.cfg.optic = this.optic.id;
    this.buildViewmodel(cfg);
    const R = this.range;
    const dists = mode.id === 'long' ? R.def.distances : R.def.distances;
    const distance = mode.id === 'long' ? dists[0] : dists[clamp(cfg.distIdx || 0, 0, dists.length - 1)];
    this.session = {
      mode: mode.id, def: mode, cfg, shots: [], series: [], seriesNo: 1, fired: 0, pending: 0,
      distance, startT: this.time, elapsed: 0, timeLeft: mode.time || 0, phase: mode.time ? 'ready' : 'live', readyT: 3,
      stage: 0, popIdx: 0, popTimer: 1.2, popActive: null, finished: false, ai: [],
    };
    if (mode.id !== 'random') {
      R.populateDecor(this.weapon.faceStyle, distance);
      this.mainTarget = R.makeTarget(distance, 0, this.weapon.faceStyle);
    } else {
      for (const t of R.decor) R.removeTarget(t); R.decor = [];
      this.mainTarget = null;
    }
    if (R.id === 'arena') this.setupArenaAI();
    // reset player
    this.yaw = 0; this.pitch = this.mainTarget ? Math.atan2(this.mainTarget.group.position.y + (this.mainTarget.stand === 'popup' ? 0 : 0) - R.eye.y, distance) : -2 * DEG;
    this.ads = 0; this.adsTarget = 0;
    this.body.reset(); this.heat = 0; this.shake = 0;
    for (const s of [this.recP, this.recY, this.mBack, this.mRot, this.lagX, this.lagY]) s.reset();
    this.recP.k = this.weapon.recoil.k; this.recP.c = this.weapon.recoil.c; this.recY.k = this.weapon.recoil.k; this.recY.c = this.weapon.recoil.c;
    this.mBack.k = this.mRot.k = this.weapon.recoil.mk; this.mBack.c = this.mRot.c = this.weapon.recoil.mc;
    this.ammo = this.weapon.mag; this.cooldown = 0; this.reloading = null; this.cycling = null; this.triggerT = null;
    this.magIdx = Math.min(this.optic.mags.length - 1, Math.floor(this.optic.mags.length / 2));
    this.curMag = this.optic.mags[this.magIdx];
    this.events = [];
    this.monitorShots = [];
    this.state = 'playing';
    this.ui.setLoading(false);
    this.ui.showScreen('hud');
    this.ui.onSessionStart(this);
    this.redrawMonitor();
    if (!this.freeMouse) this.lockPointer();
    this.audio.ui('confirm');
    if (mode.id === 'random') this.ui.centerMsg('GET READY', '표적이 무작위 위치에서 일어섭니다');
    else if (mode.time) this.ui.centerMsg('READY', '3');
    else this.ui.centerMsg(mode.name, `${R.def.name} · ${distance} M`, 1.8);
  }
  cleanupSessionTargets() {
    const R = this.range;
    if (this.mainTarget) { R.removeTarget(this.mainTarget); this.mainTarget = null; }
    if (this.session?.popActive) { R.removeTarget(this.session.popActive.t); this.session.popActive = null; }
  }
  setupArenaAI() {
    const names = ['LANE 1', 'LANE 2', 'LANE 3', 'LANE 4', 'LANE 6', 'LANE 7', 'LANE 8', 'LANE 9'];
    this.session.ai = names.map((n, i) => ({ name: n, skill: 9.6 + Math.random() * 0.9, total: 0, shots: 0, next: 3 + Math.random() * 6, lane: [-4, -3, -2, -1, 1, 2, 3, 4][i] }));
    this.drawScoreboard();
  }

  isScope() { return this.optic && this.optic.type === 'scope'; }
  changeMag(dir) {
    if (!this.isScope()) return;
    const n = this.optic.mags.length;
    const ni = dir === -99 ? 0 : clamp(this.magIdx + dir, 0, n - 1);
    if (ni !== this.magIdx) { this.magIdx = ni; this.audio.play('click', { gain: 0.25, rate: 1.4 }); }
  }

  canFire() {
    const s = this.session;
    if (!s || s.finished) return false;
    if (s.phase !== 'live') return false;
    if (s.def.shots && s.mode !== 'random' && s.fired >= s.def.shots) return false;
    if (this.mainTarget && this.mainTarget.busy) return false;
    return true;
  }
  tryFire() {
    if (!this.canFire()) return;
    if (this.reloading || this.cycling || this.cooldown > 0 || this.triggerT !== null) return;
    if (this.ammo <= 0) { this.audio.play('dry', { gain: 0.5 }); this.ui.centerMsg('', 'RELOAD [R]', 1); return; }
    if (this.weapon.triggerDelay > 0) { this.triggerT = 0; this.audio.play('click', { gain: 0.25, rate: 0.8 }); return; }
    this.fireNow();
  }
  aimDirection(out) {
    tmpE.set((this.pitch * 1) + (this.body.swayPitch + this.recP.x) * DEG, this.yaw + (this.body.swayYaw + this.recY.x) * DEG, 0, 'YXZ');
    return out.set(0, 0, -1).applyEuler(tmpE);
  }
  fireNow() {
    const W = this.weapon, S = this.session;
    this.triggerT = null;
    this.ammo--; this.cooldown = W.fireInterval; S.fired++;
    const dir = this.aimDirection(new THREE.Vector3());
    if (this.ads < 0.6) {
      const sp = W.hipSpread * DEG * (1 - this.ads);
      tmpE.set(gauss() * sp * 0.5, gauss() * sp * 0.5, 0); dir.applyEuler(tmpE).normalize();
    }
    const origin = this.range.eye.clone();
    this.raycaster.set(origin, dir); this.raycaster.far = 5000; this.raycaster.camera = this.camera;
    const hits = this.raycaster.intersectObjects(this.range.scene.children, true);
    let hit = null;
    for (const h of hits) { if (h.object.isSprite || h.object === this.range.sky || h.object === this.range.stars || h.object.material?.transparent && !h.object.userData.target) continue; hit = h; break; }
    const dist = hit ? hit.distance : 3000;
    const flight = dist / W.velocity;
    const ev = { t: flight, origin, dir, hit, shotNo: S.fired, time: this.time, reaction: S.popActive ? this.time - S.popActive.t0 : null };
    this.events.push(ev);
    S.pending++;
    // feedback
    this.audio.gunshot(W.id);
    this.neighbourCooldown = Math.max(this.neighbourCooldown || 0, 1.5);
    const rc = W.recoil;
    const sh = this.settings.shake;
    this.recP.impulse(rc.pitch * Math.sqrt(rc.k) * 1.25 * (0.85 + Math.random() * 0.3));
    this.recY.impulse(rc.yaw * Math.sqrt(rc.k) * 1.25 * gauss());
    this.pitch += gauss() * rc.residual * DEG; this.yaw += gauss() * rc.residual * DEG;
    this.mBack.impulse(rc.model * Math.sqrt(rc.mk) * 1.4);
    this.mRot.impulse(rc.modelRot * Math.sqrt(rc.mk) * 1.4);
    this.shake = Math.min(2, this.shake + rc.shake * sh);
    this.heat = Math.min(1.2, this.heat + rc.heat);
    this.body.addTension(0.025);
    this.muzzleFX();
    const p = this.vm.parts;
    if (W.action === 'semi') { this.slideKick = 1; this.ejectCase(); }
    if (W.action === 'revolver') { this.hammerFall = 1; if (p.cylinder) p.cylinder.userData.base = (p.cylinder.userData.base || 0) + Math.PI / 3; }
    if (W.action === 'bolt') this.cycling = { t: 0, dur: 0.95, ejected: false, type: 'bolt' };
    if (W.action === 'single') this.cycling = { t: 0, dur: 0.5, ejected: false, type: 'single' };
    if (this.ammo === 0) setTimeout(() => this.state === 'playing' && this.ui.centerMsg('', 'RELOAD [R]', 1.2), 350);
  }
  muzzleFX() {
    const m = this.vm.muzzle; m.getWorldPosition(tmpV);
    this.flash.position.copy(tmpV); this.flash.visible = this.ads < 0.9 || !this.isScope();
    const big = this.weapon.id === 'x1' || this.weapon.id === 'p20' ? 1.6 : this.weapon.id === 'r10' ? 0.6 : 1;
    this.flash.scale.setScalar((0.06 + Math.random() * 0.05) * big);
    this.flash.material.rotation = Math.random() * 6.28;
    this.flashT = 0.045;
    this.flashLight.position.copy(tmpV); this.flashLight.intensity = 6 * big;
    this.worldFlash.position.copy(this.range.eye).add(tmpV2.set(0.2, -0.2, -0.6)); this.worldFlash.intensity = 4 * big;
    for (let i = 0; i < 3; i++) {
      const s = this.smokes.find((x) => x.life <= 0) || this.smokes[0];
      s.life = 1.2 + Math.random() * 0.6; s.max = s.life; s.s.visible = true;
      s.s.position.copy(tmpV); s.v.set((Math.random() - 0.5) * 0.06, 0.05 + Math.random() * 0.05, -0.08 - Math.random() * 0.1);
      s.s.material.opacity = 0.35; s.s.scale.setScalar(0.03);
    }
  }
  ejectCase() {
    if (!this.vm) return;
    const c = this.cases.find((x) => x.life <= 0) || this.cases[0];
    this.vm.eject.getWorldPosition(c.m.position);
    c.m.visible = true; c.life = 1.2;
    c.v.set(1.0 + Math.random() * 0.5, 1.1 + Math.random() * 0.5, 0.25 + Math.random() * 0.2);
    c.w.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
  }
  spawnDust(point, dist) {
    let d = this.dusts.find((x) => x.life <= 0);
    if (!d) { if (this.dusts.length > 12) d = this.dusts[0]; else { d = { s: new THREE.Sprite(this.dustMat.clone()), life: 0 }; this.dusts.push(d); } }
    if (d.s.parent !== this.range.scene) this.range.scene.add(d.s);
    d.s.position.copy(point); d.life = 1.4; d.base = Math.max(0.12, dist * 0.004); d.s.visible = true;
  }

  // Resolve a bullet arriving (deferred by flight time)
  resolveImpact(ev) {
    const S = this.session; if (!S) return;
    S.pending--;
    if (S.finished) return;
    if (S.mode === 'timed' && ev.time > S.endAt) return; // fired before buzzer but arrives later still counts; fired after cannot happen
    let target = ev.hit && ev.hit.object.userData.target;
    const R = this.range;
    let local = null, distance = ev.hit ? ev.hit.distance : 0;
    const intended = S.popActive ? S.popActive.t : this.mainTarget;
    if (target && target !== intended) target = null; // neighbour lane targets do not count
    if (target && (target.state === 'down' || target.state === 'falling')) target = null;
    if (S.mode === 'random' && !S.popActive) {
      if (ev.hit) this.spawnDust(ev.hit.point, ev.hit.distance);
      return this.afterShotUI(null);
    }
    if (target) {
      local = target.toFaceLocal(ev.hit.point);
    } else if (intended) {
      // compute where the shot passed the intended target plane (for the plot)
      const n = tmpV.set(0, 0, 1).applyQuaternion(intended.face.getWorldQuaternion(new THREE.Quaternion()));
      const p0 = intended.face.getWorldPosition(tmpV2);
      const denom = n.dot(ev.dir);
      if (Math.abs(denom) > 1e-6) {
        const tt = p0.clone().sub(ev.origin).dot(n) / denom;
        if (tt > 0) local = intended.toFaceLocal(ev.origin.clone().addScaledVector(ev.dir, tt));
      }
    }
    const T = target || intended;
    let res = { score: 0, dec: 0, inner: false };
    if (target && local) res = scoreHit(local.x, local.y, target.outerR, this.weapon.holeR);
    if (target && local) {
      const visR = Math.max(this.weapon.holeR, target.distance * 0.00011);
      target.addHole(local.x, local.y, visR);
      const pan = clamp(target.group.position.x / 10, -0.8, 0.8);
      this.audio.impact(target.distance >= 250 ? 'steel' : 'paper', target.distance, pan);
    } else if (ev.hit) {
      this.spawnDust(ev.hit.point, ev.hit.distance);
      this.audio.impact('thud', ev.hit.distance, clamp(ev.hit.point.x / 10, -0.8, 0.8));
    }
    const shot = {
      n: S.shots.length + 1, score: res.score, dec: res.dec, inner: res.inner,
      x: local && T ? local.x / T.outerR : 2, y: local && T ? local.y / T.outerR : 2,
      dist: T ? T.distance : distance, t: Math.round((ev.time - S.startT) * 100) / 100, reaction: null, series: S.seriesNo,
    };
    if (S.mode === 'random' && S.popActive) {
      if (target) { shot.reaction = Math.round((ev.time - S.popActive.t0) * 1000) / 1000; this.endPopup(true); }
      else return this.afterShotUI(null); // misses during a popup don't consume the target
    }
    S.shots.push(shot);
    this.monitorShots.push(shot);
    this.afterShotUI(shot);
    this.redrawMonitor();
    this.progressMode(shot);
  }
  afterShotUI(shot) {
    if (!shot) { this.ui.hitPop(null); return; }
    this.ui.hitPop(shot);
    if (shot.score === 10 && this.range.id === 'arena' && shot.inner) this.audio.play('applause', { gain: 0.25, bus: 'amb', send: 0.3 });
    this.audio.ui('beep');
  }
  progressMode(shot) {
    const S = this.session, mode = S.mode;
    const seriesCount = S.shots.filter((s) => s.series === S.seriesNo).length;
    if (mode === 'match10' && S.shots.length >= 10) return this.finishSoon();
    if (mode === 'match30') {
      if (S.shots.length >= 30) return this.finishSoon();
      if (seriesCount >= 10) this.nextSeries();
    }
    if ((mode === 'free' || mode === 'timed') && seriesCount >= 10) this.nextSeries();
    if (mode === 'long') {
      if (S.shots.length >= 10) return this.finishSoon();
      if (S.shots.length % 2 === 0) {
        S.stage++;
        const d = this.range.def.distances[S.stage];
        setTimeout(() => this.moveMainTarget(d, `STAGE ${S.stage + 1} / 5`), 900);
      }
    }
  }
  nextSeries() {
    const S = this.session;
    S.seriesNo++;
    setTimeout(() => {
      if (!this.mainTarget) return;
      this.mainTarget.replace(() => { this.monitorShots = []; this.redrawMonitor(); });
      this.ui.toast(`SERIES ${S.seriesNo} · 표적 교체`);
    }, 700);
  }
  replaceMain() {
    if (!this.mainTarget || this.mainTarget.busy) return;
    this.session.seriesNo++;
    this.mainTarget.replace(() => { this.monitorShots = []; this.redrawMonitor(); });
  }
  moveMainTarget(d, label) {
    const R = this.range, S = this.session;
    if (this.mainTarget) R.removeTarget(this.mainTarget);
    this.mainTarget = R.makeTarget(d, 0, this.weapon.faceStyle);
    S.distance = d; this.monitorShots = []; this.redrawMonitor();
    this.ui.centerMsg(label || `${d} M`, `${d} M`, 1.4);
    this.audio.ui('confirm');
  }
  cycleDistance() {
    const ds = this.range.def.distances, S = this.session;
    const i = (ds.indexOf(S.distance) + 1) % ds.length;
    S.seriesNo++;
    this.moveMainTarget(ds[i], 'DISTANCE');
  }
  finishSoon() {
    const S = this.session; if (S.finishing) return; S.finishing = true;
    setTimeout(() => this.finish(), 1400);
  }
  async finish() {
    const S = this.session; if (!S || S.finished) return;
    S.finished = true;
    this.state = 'results';
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.focus = false; this.audio.setFocus(false);
    const a = analyze(S.shots);
    const match = {
      date: Date.now(), mode: S.mode, weapon: this.weapon.id, range: this.range.id, optic: this.optic.id, tod: this.range.tod,
      distance: S.mode === 'long' ? 'var' : S.mode === 'random' ? 'var' : S.distance, faceStyle: this.weapon.faceStyle,
      duration: Math.round(this.time - S.startT), shots: S.shots, total: a.total, totalDec: a.totalDec,
    };
    let cmp = { prevBest: null, prevAvg: null, isPB: false };
    try { if (S.shots.length) cmp = await this.ui.store.record(match); } catch (e) { console.warn(e); }
    this.audio.ui('final');
    if (this.range.id === 'arena') this.audio.play('applause', { gain: 0.6, bus: 'amb', send: 0.4 });
    this.ui.showResults(match, a, cmp);
  }
  endSessionEarly() {
    const S = this.session; if (!S) return;
    if (S.shots.length) this.finish(); else this.quitToMenu();
  }
  quitToMenu() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.cleanupSessionTargets();
    this.session = null;
    this.audio.setFocus(false);
    this.clearViewmodel();
    this.scopePass.uniforms.amount.value = 0; this.scopePass.uniforms.mode.value = 0;
    this.state = 'menu';
    if (!this.menuTarget && this.range) this.menuTarget = this.range.makeTarget(this.range.def.distances[0], 0, this.weapon?.faceStyle || 'pistol');
    this.ui.showScreen('menu');
  }
  restart() { const c = this.cfg; this.cleanupSessionTargets(); this.session = null; this.startSession({ ...c }); }
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused'; this.input.focus = false; this.input.fire = false; this.audio.setFocus(false);
    this.ui.showScreen('pause');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing'; this.ui.showScreen('hud');
    if (!this.freeMouse) this.lockPointer();
  }

  reload() {
    const W = this.weapon;
    if (this.reloading || this.ammo >= W.mag || this.triggerT !== null) return;
    this.reloading = { t: 0, dur: W.reloadTime, cues: this.reloadCues(W) };
    this.adsTarget = 0;
  }
  reloadCues(W) {
    if (W.action === 'revolver') return [[0.2, 'clickHeavy'], [0.55, 'slide'], [1.4, 'click'], [1.6, 'click'], [1.8, 'click'], [2.45, 'clickHeavy']];
    if (W.action === 'bolt') return [[0.4, 'clickHeavy'], [1.4, 'clickHeavy'], [2.2, 'slide'], [2.55, 'clickHeavy']];
    return [[0.3, 'clickHeavy'], [W.reloadTime * 0.6, 'clickHeavy'], [W.reloadTime * 0.85, 'slide']];
  }

  // ---------------- per-frame ----------------
  update(dt) {
    this.time += dt;
    const R = this.range;
    if (R) R.update(dt, this.time);
    this.audio.tick(dt, R?.tod);
    if (this.state === 'playing' || this.state === 'paused') {
      if (this.state === 'playing') this.updatePlayer(dt);
      this.updateFX(dt);
    } else if (this.state === 'menu' || this.state === 'results' || this.state === 'boot') {
      // cinematic idle camera
      const t = this.time * 0.07;
      this.camera.position.copy(R ? R.eye : tmpV.set(0, 1.5, 0)).add(tmpV2.set(Math.sin(t) * 0.6, Math.sin(t * 1.3) * 0.08, 0.3));
      this.camera.rotation.set(-0.02 + Math.sin(t * 0.8) * 0.02, Math.sin(t * 0.6) * 0.12, 0);
      this.camera.fov = damp(this.camera.fov, this.settings.fov, 3, dt); this.camera.updateProjectionMatrix();
      this.scopePass.uniforms.amount.value = 0; this.scopePass.uniforms.focusVig.value = 0;
    }
  }

  updatePlayer(dt) {
    const W = this.weapon, S = this.session, R = this.range;
    // session timing
    S.elapsed = this.time - S.startT;
    if (S.phase === 'ready') {
      S.readyT -= dt;
      const n = Math.ceil(S.readyT);
      if (n !== S.lastCount && n > 0) { S.lastCount = n; this.ui.centerMsg('READY', String(n), 0.9); this.audio.ui('beep'); }
      if (S.readyT <= 0) { S.phase = 'live'; S.startT = this.time; S.endAt = this.time + S.def.time; this.ui.centerMsg('START', '', 0.8); this.audio.ui('confirm'); }
    } else if (S.mode === 'timed' && !S.finished) {
      S.timeLeft = Math.max(0, S.endAt - this.time);
      if (S.timeLeft <= 0 && !S.finishing) { S.phase = 'over'; this.ui.centerMsg('TIME', '', 1.2); this.finishSoon(); }
    }
    if (S.mode === 'random') this.updateRandom(dt);
    // tension model
    let tt = 0.12;
    if (S.def.shots) { const left = S.def.shots - S.shots.length; if (left <= 3) tt += 0.35 - left * 0.06; }
    if (S.mode === 'timed' && S.phase === 'live') tt += 0.25 + 0.4 * (1 - S.timeLeft / S.def.time);
    if (R.id === 'arena') tt += 0.15;
    if (S.mode === 'long') tt += 0.05 * S.stage;
    this.body.tensionTarget = clamp(tt, 0, 1);

    // ADS
    if (this.reloading) this.adsTarget = 0;
    this.ads = damp(this.ads, this.adsTarget, W.adsSpeed, dt);
    if (Math.abs(this.ads - this.adsTarget) < 0.002) this.ads = this.adsTarget;
    const e = easeInOut(this.ads);
    // magnification (log-space smoothing)
    const targetMag = this.isScope() ? this.optic.mags[this.magIdx] : 1;
    this.curMag = Math.exp(damp(Math.log(this.curMag || 1), Math.log(targetMag), 9, dt));

    // trigger pull (revolver double action)
    let pull = 0;
    if (this.triggerT !== null) {
      this.triggerT += dt; pull = clamp(this.triggerT / W.triggerDelay, 0, 1);
      if (this.triggerT >= W.triggerDelay) { this.fireNow(); pull = 0; }
    }
    this.pullAmt = pull;
    // body + sway
    this.heat = Math.max(0, this.heat - dt * 0.6);
    const hip = 1 + (1 - e) * (W.sway.hip - 1);
    this.body.update(dt, { ads: this.ads > 0.5, wantFocus: this.input.focus && this.ads > 0.3, amp: this.testMode ? 0 : W.sway.amp, triggerPull: pull, heat: this.heat, hip });
    if (this.testMode) { this.body.swayYaw = 0; this.body.swayPitch = 0; }

    this.cooldown = Math.max(0, this.cooldown - dt);
    // springs
    this.recP.update(dt); this.recY.update(dt); this.mBack.update(dt); this.mRot.update(dt); this.lagX.update(dt); this.lagY.update(dt);
    this.shake *= Math.exp(-dt * 12);
    // events (bullet flight)
    for (let i = this.events.length - 1; i >= 0; i--) {
      const ev = this.events[i]; ev.t -= dt;
      if (ev.t <= 0) { this.events.splice(i, 1); this.resolveImpact(ev); }
    }
    // reload
    if (this.reloading) {
      const rl = this.reloading; rl.t += dt;
      for (const c of rl.cues) if (!c.done && rl.t >= c[0]) { c.done = true; this.audio.play(c[1], { gain: 0.5, send: 0.2 }); }
      if (rl.t >= rl.dur) { this.ammo = W.mag; this.reloading = null; if (W.action === 'bolt') this.cycling = null; }
    }
    if (this.cycling) {
      const cy = this.cycling; cy.t += dt;
      const k = cy.t / cy.dur;
      if (!cy.s1 && k > 0.12) { cy.s1 = true; this.audio.play('clickHeavy', { gain: 0.4 }); }
      if (!cy.ejected && k > 0.42) { cy.ejected = true; this.ejectCase(); this.audio.play('slide', { gain: 0.5 }); }
      if (!cy.s2 && k > 0.75) { cy.s2 = true; this.audio.play('clickHeavy', { gain: 0.45 }); }
      if (cy.t >= cy.dur) this.cycling = null;
    }
    // neighbouring shooters (ambience), arena AI scoring
    this.updateNeighbours(dt);

    // camera
    const shakeDeg = this.shake * 0.35;
    const t = this.time;
    this.camera.position.copy(R.eye);
    this.camera.position.y += Math.sin(t * 1.2) * 0.002 * (1 - e);
    this.camera.rotation.set(
      this.pitch + (this.body.swayPitch + this.recP.x) * DEG + Math.sin(t * 73) * shakeDeg * 0.25 * DEG,
      this.yaw + (this.body.swayYaw + this.recY.x) * DEG + Math.sin(t * 61) * shakeDeg * 0.2 * DEG,
      Math.sin(t * 47) * shakeDeg * 0.6 * DEG
    );
    // FOV
    const base = this.settings.fov;
    let fov = base;
    if (this.optic.type === 'scope') fov = base / (1 + 0.12 * e);
    else fov = 2 * Math.atan(Math.tan(base * DEG / 2) / (1 + (W.adsZoom - 1) * e)) / DEG;
    if (this.body.focusActive) fov *= 0.985;
    this.camera.fov = damp(this.camera.fov, fov, 14, dt); this.camera.updateProjectionMatrix();

    // scope / overlay
    const U = this.scopePass.uniforms;
    U.time.value = t;
    U.focusVig.value = damp(U.focusVig.value, this.body.focusActive ? 1 : 0, 6, dt);
    if (this.optic.type === 'scope') {
      const amt = smoothstep(0.72, 0.97, this.ads);
      U.mode.value = 2; U.amount.value = amt; U.lensR.value = this.optic.lensR; U.tube.value = this.optic.tube;
      U.reticle.value = RETICLE_INDEX[this.cfg.reticle] ?? 0;
      const rgb = RETICLE_RGB[this.cfg.retColor] || RETICLE_RGB.black;
      U.retColor.value.set(rgb[0], rgb[1], rgb[2]); U.retGlow.value = this.cfg.retColor === 'black' ? 0 : 0.6;
      U.retScale.value = this.optic.style === 'reddot' ? 1.4 : 1;
      // eye-box: lens drifts against fast motion (gun inertia), shadow follows
      const ex = clamp(this.lagY.x * -3.2 + this.recY.x * 0.02, -0.25, 0.25), ey = clamp(this.lagX.x * 3.2 + this.recP.x * 0.03 + this.mBack.x * 2, -0.25, 0.25);
      U.eyeOff.value.set(ex, ey); U.lensOff.value.set(ex * 0.02, ey * 0.02);
      if (amt > 0.001) {
        this.scopeCam.position.copy(this.camera.position); this.scopeCam.quaternion.copy(this.camera.quaternion);
        this.scopeCam.fov = scopeFov(this.camera.fov, this.optic.lensR, this.curMag);
        this.scopeCam.near = R.indoor ? 0.2 : 0.5; this.scopeCam.far = R.far;
        this.scopeCam.aspect = 1; this.scopeCam.updateProjectionMatrix();
        this.renderScope = true;
      } else this.renderScope = false;
      this.vmRoot.visible = amt < 0.5;
    } else if (this.optic.type === 'diopter') {
      const amt = smoothstep(0.75, 0.98, this.ads);
      U.mode.value = 1; U.amount.value = amt; U.lensR.value = 0.27; this.renderScope = false;
      this.vmRoot.visible = true;
      if (this.vm.parts.rear) this.vm.parts.rear.visible = this.ads < 0.7;
    } else {
      U.mode.value = 0; U.amount.value = 0; this.renderScope = false; this.vmRoot.visible = true;
    }

    // viewmodel pose
    this.updateViewmodel(dt, e);
    // HUD
    this.hudT = (this.hudT || 0) + dt;
    if (this.hudT > 1 / 20) { this.hudT = 0; this.ui.updateHUD(this); }
    this.ui.drawBody(this.body);
  }

  updateViewmodel(dt, e) {
    const vm = this.vm; if (!vm) return;
    const W = this.weapon, root = vm.root, p = vm.parts;
    const pos = tmpV.copy(this.hipPos).lerp(this.adsPos, e);
    let rx = lerp(this.hipRot.x, 0, e), ry = lerp(this.hipRot.y, 0, e), rz = lerp(this.hipRot.z, 0, e);
    // hip sway visible on the gun, breathing bob
    const hipAmt = 1 - e;
    rx += (this.body.swayPitch * DEG) * 0.6 * hipAmt + Math.sin(this.time * 1.4) * 0.004 * hipAmt;
    ry += (this.body.swayYaw * DEG) * 0.6 * hipAmt;
    // inertia lag
    rx += this.lagX.x; ry += this.lagY.x;
    pos.x += this.lagY.x * -0.08; pos.y += this.lagX.x * 0.08;
    // recoil
    pos.z += this.mBack.x; rx += this.mRot.x;
    pos.y += this.mRot.x * 0.02;
    // reload choreography
    if (this.reloading) {
      const k = this.reloading.t / this.reloading.dur;
      const s = Math.sin(Math.PI * clamp(k * 1.1, 0, 1));
      pos.y -= 0.07 * s; pos.z += 0.05 * s; rx += 0.35 * s; rz += (W.cls === 'pistol' ? 0.5 : 0.35) * s; ry += 0.15 * s;
      if (p.mag) p.mag.position.y = p.mag.userData.y0 ?? (p.mag.userData.y0 = p.mag.position.y), p.mag.position.y = p.mag.userData.y0 - 0.25 * Math.max(0, Math.sin(Math.PI * clamp((k - 0.15) / 0.55, 0, 1)));
      if (p.crane) p.crane.rotation.z = 1.2 * Math.max(0, Math.sin(Math.PI * clamp((k - 0.08) / 0.85, 0, 1)));
    } else {
      if (p.mag && p.mag.userData.y0 !== undefined) p.mag.position.y = p.mag.userData.y0;
      if (p.crane) p.crane.rotation.z = 0;
    }
    // bolt cycling
    if (this.cycling && p.bolt) {
      const k = this.cycling.t / this.cycling.dur;
      const big = this.cycling.type === 'bolt';
      const up = smoothstep(0, 0.15, k) * (1 - smoothstep(0.7, 0.85, k));
      const back = smoothstep(0.18, 0.4, k) * (1 - smoothstep(0.45, 0.68, k));
      p.bolt.rotation.z = up * (big ? 1.1 : 0.9);
      p.bolt.position.z = (p.bolt.userData.z0 ?? (p.bolt.userData.z0 = p.bolt.position.z)) + back * (big ? 0.08 : 0.04);
      rz += up * 0.08 * (1 - e * 0.6); pos.y -= up * 0.01;
    } else if (p.bolt && p.bolt.userData.z0 !== undefined) { p.bolt.rotation.z = 0; p.bolt.position.z = p.bolt.userData.z0; }
    // slide kick (semi)
    if (p.slide) {
      this.slideKick = Math.max(0, (this.slideKick || 0) - dt * 14);
      const k = this.slideKick; const z0 = p.slide.userData.z0 ?? (p.slide.userData.z0 = p.slide.position.z);
      p.slide.position.z = z0 + Math.sin(Math.PI * k) * 0.024;
    }
    if (p.bolt && W.action === 'semi') {
      this.slideKick = Math.max(0, (this.slideKick || 0) - dt * 14);
      const z0 = p.bolt.userData.z0 ?? (p.bolt.userData.z0 = p.bolt.position.z);
      p.bolt.position.z = z0 + Math.sin(Math.PI * this.slideKick) * 0.035;
    }
    // revolver hammer + cylinder (double action: cock & index during the pull, then fall)
    if (p.hammer) {
      const pull = this.pullAmt || 0;
      p.hammer.rotation.x = pull * 0.7;
      if (p.cylinder) p.cylinder.rotation.z = (p.cylinder.userData.base || 0) + pull * Math.PI / 3;
    }
    if (p.trigger) p.trigger.rotation.x = -(this.pullAmt || 0) * 0.4 - (this.input.fire ? 0.15 : 0);
    root.position.copy(pos);
    root.rotation.set(rx, ry, rz);
  }

  updateRandom(dt) {
    const S = this.session, R = this.range;
    if (S.finished || S.finishing) return;
    if (!S.popActive) {
      S.popTimer -= dt;
      if (S.popTimer <= 0) {
        if (S.popIdx >= S.def.shots) { this.finishSoon(); return; }
        const ds = R.def.distances;
        const d = lerp(ds[0], ds[ds.length - 1], Math.random()) * (0.6 + Math.random() * 0.4);
        const maxX = Math.max(...R.lanes.map(Math.abs)) * R.lanePitch * 0.85;
        const x = (Math.random() * 2 - 1) * Math.min(maxX, d * 0.35);
        const t = R.makeTarget(d, x, this.weapon.faceStyle, { stand: 'popup', outerR: R.targetR(d) * 0.9 });
        t.popUp();
        this.audio.play('clickHeavy', { gain: 0.25, pan: clamp(x / 8, -0.8, 0.8), delay: d / 340 });
        S.popActive = { t, t0: this.time, window: 2.4 + d / (R.indoor ? 40 : 300), idx: S.popIdx };
        S.popIdx++;
      }
    } else {
      const pa = S.popActive;
      if (this.time - pa.t0 > pa.window && !pa.ending) {
        // timed out: recorded as miss
        const shot = { n: S.shots.length + 1, score: 0, dec: 0, inner: false, x: 2, y: 2, dist: pa.t.distance, t: Math.round(S.elapsed * 100) / 100, reaction: null, series: 1 };
        S.shots.push(shot); this.monitorShots.push(shot); this.ui.hitPop(shot); this.redrawMonitor();
        this.endPopup(false);
      }
    }
  }
  endPopup(hit) {
    const S = this.session, pa = S.popActive; if (!pa || pa.ending) return;
    pa.ending = true;
    setTimeout(() => {
      pa.t.popDown();
      setTimeout(() => { this.range.removeTarget(pa.t); if (S.popActive === pa) S.popActive = null; S.popTimer = 0.5 + Math.random() * 1.0; if (S.popIdx >= S.def.shots && !S.finishing) this.finishSoon(); }, 420);
    }, hit ? 260 : 0);
  }

  updateNeighbours(dt) {
    const S = this.session, R = this.range;
    this.neighbourCooldown = Math.max(0, (this.neighbourCooldown || 0) - dt);
    if (R.id === 'arena' && S.ai.length && S.phase === 'live' && S.mode !== 'free' && S.mode !== 'random') {
      let changed = false;
      for (const a of S.ai) {
        const limit = S.def.shots || 999;
        if (a.shots >= limit) continue;
        a.next -= dt;
        if (a.next <= 0) {
          a.next = 4 + Math.random() * 7; a.shots++;
          const dec = clamp(a.skill + gauss() * 0.55, 6, 10.9); a.total += Math.floor(dec);
          this.audio.play('gun_' + this.weapon.id, { gain: 0.12, pan: clamp(a.lane / 5, -0.9, 0.9), rate: 0.95 + Math.random() * 0.1, send: 1.6 });
          const dt2 = R.decor.find((t) => Math.abs(t.group.position.x - a.lane * R.lanePitch) < 0.1);
          if (dt2) { const ang = Math.random() * 6.28, rr = (10.9 - dec) / 10 * dt2.outerR; dt2.addHole(Math.cos(ang) * rr, Math.sin(ang) * rr, 0.003); }
          changed = true;
        }
      }
      if (changed) this.drawScoreboard();
    } else if (R.id !== 'mountain' && S.mode !== 'random') {
      this.nbT = (this.nbT ?? 4) - dt;
      if (this.nbT <= 0) {
        this.nbT = 3 + Math.random() * 8;
        if (this.neighbourCooldown <= 0 && R.decor.length) {
          const tg = R.decor[Math.floor(Math.random() * R.decor.length)];
          const lanes = ['p10', 'r10', 'p20'];
          const lx = tg.group.position.x;
          this.audio.play('gun_' + lanes[Math.floor(Math.random() * 3)], { gain: 0.16, pan: clamp(lx / 6, -0.9, 0.9), rate: 0.95 + Math.random() * 0.1, send: 1.4 });
          const a = Math.random() * 6.28, rr = Math.abs(gauss()) * tg.outerR * 0.25;
          tg.addHole(Math.cos(a) * rr, Math.sin(a) * rr, Math.max(0.003, tg.distance * 0.00012));
        }
      }
    }
  }
  drawScoreboard() {
    const R = this.range; if (!R.boardCanvas) return;
    const c = R.boardCanvas, x = c.getContext('2d'), S = this.session;
    x.fillStyle = '#05070a'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#e3a948'; x.font = '700 30px Inter, sans-serif'; x.textAlign = 'left';
    x.fillText(S ? `${MODES[S.mode].name}` : 'PRECISION RANGE WORLD CUP', 30, 44);
    x.fillStyle = '#7f8790'; x.font = '500 20px "JetBrains Mono", monospace'; x.textAlign = 'right';
    x.fillText(S ? `${this.weapon.name}` : '', c.width - 30, 44);
    if (!S) { R.boardTex.needsUpdate = true; return; }
    const you = { name: 'YOU · LANE 5', total: S.shots.reduce((a, s) => a + s.score, 0), shots: S.shots.length, me: true };
    const rows = [you, ...S.ai].sort((a, b) => b.total - a.total || b.shots - a.shots);
    rows.slice(0, 9).forEach((r, i) => {
      const y = 86 + i * 32;
      x.fillStyle = r.me ? 'rgba(227,169,72,0.18)' : (i % 2 ? '#0b0e12' : '#080a0d'); x.fillRect(24, y - 22, c.width - 48, 30);
      x.fillStyle = r.me ? '#e3a948' : '#d8dde3'; x.font = '600 21px Inter, sans-serif'; x.textAlign = 'left';
      x.fillText(`${i + 1}`, 40, y); x.fillText(r.name, 90, y);
      x.font = '600 21px "JetBrains Mono", monospace'; x.textAlign = 'right';
      x.fillText(`${r.shots}`, c.width - 200, y); x.fillText(`${r.total}`, c.width - 50, y);
    });
    R.boardTex.needsUpdate = true;
  }
  redrawMonitor() {
    this.ui.drawMonitor(this.monitorShots || [], this.weapon?.faceStyle || 'pistol');
    const R = this.range;
    if (R && R.monitorCanvas) {
      const c = R.monitorCanvas, x = c.getContext('2d');
      drawMonitor(x, c.width, this.monitorShots || [], { style: this.weapon?.faceStyle || 'pistol', markLast: true });
      const last = this.monitorShots?.[this.monitorShots.length - 1];
      x.fillStyle = '#e3a948'; x.font = '700 30px "JetBrains Mono", monospace'; x.textAlign = 'right';
      if (last) x.fillText(last.dec.toFixed(1), c.width - 10, 34);
      R.monitorTex.needsUpdate = true;
    }
    if (R && R.id === 'arena' && this.session) this.drawScoreboard();
  }

  updateFX(dt) {
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.visible = false; } }
    this.flashLight.intensity *= Math.exp(-dt * 40); this.worldFlash.intensity *= Math.exp(-dt * 30);
    for (const s of this.smokes) {
      if (s.life <= 0) continue;
      s.life -= dt; const k = 1 - s.life / s.max;
      s.s.position.addScaledVector(s.v, dt); s.v.y += dt * 0.02;
      s.s.scale.setScalar(0.03 + k * 0.18); s.s.material.opacity = 0.3 * (1 - k);
      if (s.life <= 0) s.s.visible = false;
    }
    for (const c of this.cases) {
      if (c.life <= 0) continue;
      c.life -= dt; c.v.y -= 9.8 * dt; c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt; c.m.rotation.z += c.w.z * dt;
      if (c.life <= 0) c.m.visible = false;
    }
    for (const d of this.dusts) {
      if (d.life <= 0) continue;
      d.life -= dt; const k = 1 - d.life / 1.4;
      d.s.scale.setScalar(d.base * (0.5 + k * 2.5)); d.s.material.opacity = 0.7 * (1 - k); d.s.position.y += dt * d.base * 0.3;
      if (d.life <= 0) d.s.visible = false;
    }
  }

  render(dt) {
    if (!this.range) return;
    this.renderer.shadowMap.needsUpdate = true;
    if (this.renderScope && this.state !== 'menu') {
      this.renderer.setRenderTarget(this.scopeRT);
      this.renderer.render(this.range.scene, this.scopeCam);
      this.renderer.setRenderTarget(null);
      this.renderer.shadowMap.needsUpdate = false;
    }
    if (this.state === 'menu' || this.state === 'results') this.vmRoot.visible = false;
    this.composer.render(dt);
  }

  loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.fps = lerp(this.fps, 1 / Math.max(dt, 1e-4), 0.05);
    this.update(dt);
    this.render(dt);
    requestAnimationFrame(() => this.loop());
  }

  // ---------------- automated test hooks ----------------
  // Aim exactly at the main target (+ offset in ring-1 radius units) with sway disabled, then fire.
  testShot(ox = 0, oy = 0) {
    return new Promise((resolve) => {
      const T = this.session?.popActive?.t || this.mainTarget; if (!T) return resolve(null);
      this.testMode = true;
      const wp = T.face.getWorldPosition(new THREE.Vector3());
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(T.face.getWorldQuaternion(new THREE.Quaternion()));
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(T.face.getWorldQuaternion(new THREE.Quaternion()));
      wp.addScaledVector(right, ox * T.outerR).addScaledVector(up, oy * T.outerR);
      const d = wp.sub(this.range.eye);
      for (const s of [this.recP, this.recY]) s.reset();
      this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      this.body.swayYaw = 0; this.body.swayPitch = 0;
      this.adsTarget = 1; this.ads = 1; this.cooldown = 0; this.cycling = null; this.reloading = null;
      if (this.ammo <= 0) this.ammo = this.weapon.mag;
      const before = this.session.shots.length;
      const W = this.weapon;
      const resid = W.recoil.residual; W.recoil.residual = 0;
      if (W.triggerDelay > 0) { this.triggerT = W.triggerDelay; } // fire next frame
      this.fireNow();
      W.recoil.residual = resid;
      const iv = setInterval(() => {
        if (!this.session || this.session.shots.length > before) { clearInterval(iv); this.testMode = false; resolve(this.session ? this.session.shots[this.session.shots.length - 1] : null); }
      }, 20);
    });
  }
}
