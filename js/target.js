// Sport target faces, 3D target units, and the scoring math.
// Scoring is done from the 3D ray/mesh intersection converted into the face's local space.
import * as THREE from 'three';
import { holeTexture, cardboard } from './textures.js';
import { clamp, easeInOut } from './util.js';

export const RING_FRAC = 0.84; // outer scoring ring radius / half paper width

export const FACE_STYLES = {
  pistol: { blackFrom: 7, label: 'PISTOL' },
  rifle: { blackFrom: 4, label: 'RIFLE' },
  long: { blackFrom: 5, label: 'LONG RANGE' },
};

// ---------- scoring (pure functions; unit-tested via window.PR.selfTest) ----------
// x, y in metres on face; outerR = radius of ring 1 boundary; holeR = projectile radius
// Uses the "gauging" rule: a hole touching a ring line scores the higher ring.
export function scoreHit(x, y, outerR, holeR = 0) {
  const w = outerR / 10;
  const r = Math.hypot(x, y);
  const eff = Math.max(0, r - holeR);
  let dec = 11 - eff / w;
  dec = Math.floor(clamp(dec, 0, 10.9) * 10 + 1e-9) / 10;
  if (eff > outerR) dec = 0;
  const score = dec >= 1 ? Math.floor(dec) : 0;
  return { score, dec: score === 0 ? 0 : dec, r, inner: eff <= w * 0.5 };
}

// ---------- face texture ----------
const faceCache = new Map();
export function drawFace(ctx, size, style, opts = {}) {
  const st = FACE_STYLES[style] || FACE_STYLES.pistol;
  const cx = size / 2, R = (size / 2) * (opts.ringFrac ?? RING_FRAC);
  if (opts.paper !== false) {
    ctx.fillStyle = '#efebe1'; ctx.fillRect(0, 0, size, size);
    // paper fibre noise
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 10;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }
  const lw = Math.max(1, size / 700);
  for (let i = 1; i <= 10; i++) {
    const r = R * (11 - i) / 10;
    ctx.beginPath(); ctx.arc(cx, cx, r, 0, Math.PI * 2);
    ctx.fillStyle = i >= st.blackFrom ? '#141414' : (opts.paper === false ? '#efebe1' : 'rgba(0,0,0,0)');
    if (i >= st.blackFrom || opts.paper === false) ctx.fill();
  }
  for (let i = 1; i <= 10; i++) {
    const r = R * (11 - i) / 10;
    ctx.beginPath(); ctx.arc(cx, cx, r, 0, Math.PI * 2);
    ctx.strokeStyle = i > st.blackFrom ? '#e8e4da' : '#141414';
    ctx.lineWidth = lw; ctx.stroke();
  }
  // inner ten
  ctx.beginPath(); ctx.arc(cx, cx, R / 20, 0, Math.PI * 2);
  ctx.strokeStyle = '#e8e4da'; ctx.lineWidth = lw * 0.8; ctx.stroke();
  // ring numbers
  if (opts.numbers !== false) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(R * 0.055)}px Inter, Arial, sans-serif`;
    for (let i = 1; i <= 8; i++) {
      const rr = R * (10.5 - i) / 10;
      ctx.fillStyle = i >= st.blackFrom ? '#e8e4da' : '#141414';
      ctx.fillText(String(i), cx, cx - rr); ctx.fillText(String(i), cx, cx + rr);
      ctx.fillText(String(i), cx - rr, cx); ctx.fillText(String(i), cx + rr, cx);
    }
  }
  if (opts.paper !== false && opts.label !== false) {
    ctx.fillStyle = '#3a3a3a';
    ctx.font = `500 ${Math.round(size * 0.022)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(`PRECISION RANGE · ${st.label}`, size * 0.03, size * 0.035);
    ctx.textAlign = 'right';
    ctx.fillText(`No.${String(Math.floor(Math.random() * 9000 + 1000))}`, size * 0.97, size * 0.965);
  }
}
function faceTexture(style, size) {
  const key = style + size;
  if (faceCache.has(key)) return faceCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  drawFace(c.getContext('2d'), size, style);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  faceCache.set(key, t);
  return t;
}
export function clearFaceCache() { for (const t of faceCache.values()) t.dispose(); faceCache.clear(); holeTex = null; }

let holeTex = null;
let faceSize = 1024;
export function setFaceQuality(q) { faceSize = { low: 1024, medium: 1024, high: 2048, ultra: 2048 }[q] || 1024; }

const _v = new THREE.Vector3();

// ---------- 3D target unit ----------
export class Target {
  // stand: 'carrier' | 'frame' | 'electronic' | 'popup'
  constructor({ outerR, style = 'pistol', stand = 'frame', distance = 10, groundY = 0, centerY = 1.5, mats = {} }) {
    this.outerR = outerR; this.style = style; this.stand = stand; this.distance = distance;
    this.paper = (outerR / RING_FRAC) * 2;
    this.group = new THREE.Group();
    this.pivot = new THREE.Group();
    this.group.add(this.pivot);
    this.hitMeshes = [];
    this.holes = [];
    this.anim = null;
    this.state = 'up';
    this.ledMat = null;

    if (!holeTex) holeTex = holeTexture();
    const P = this.paper;
    const centerOffset = stand === 'popup' ? P * 0.5 + 0.05 : 0;
    this.centerY = centerY;
    this.face = new THREE.Mesh(
      new THREE.PlaneGeometry(P, P),
      new THREE.MeshStandardMaterial({ map: faceTexture(style, faceSize), roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })
    );
    this.face.position.set(0, centerOffset, 0.004 * Math.max(1, P));
    this.face.userData.target = this;
    this.face.receiveShadow = true;
    this.pivot.add(this.face);
    this.hitMeshes.push(this.face);

    const board = cardboard([1, 1]);
    const backer = new THREE.Mesh(
      new THREE.BoxGeometry(P * 1.06, P * 1.06, Math.max(0.006, P * 0.008)),
      new THREE.MeshStandardMaterial({ ...board, roughness: 0.95 })
    );
    backer.position.set(0, centerOffset, -Math.max(0.006, P * 0.008) / 2);
    backer.userData.target = this; backer.userData.backer = true;
    backer.castShadow = true; backer.receiveShadow = true;
    this.pivot.add(backer);
    this.hitMeshes.push(backer);

    this.holeLayer = new THREE.Group();
    this.holeLayer.position.copy(this.face.position);
    this.holeLayer.position.z += 0.0005;
    this.pivot.add(this.holeLayer);

    this._buildStand(stand, mats, groundY, centerY);
  }

  _buildStand(stand, mats, groundY, centerY) {
    const P = this.paper;
    const wood = mats.wood || new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.85 });
    const steel = mats.steel || new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.8 });
    if (stand === 'frame') {
      this.group.position.y = centerY;
      const h = centerY - groundY + P * 0.5;
      const post = new THREE.BoxGeometry(Math.max(0.04, P * 0.05), h + 0.3, Math.max(0.04, P * 0.05));
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(post, wood);
        m.position.set(sx * P * 0.56, -centerY + groundY + (h + 0.3) / 2 - 0.3, -0.03 * Math.max(1, P));
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(P * 1.2, Math.max(0.03, P * 0.035), Math.max(0.03, P * 0.035)), wood);
      bar.position.set(0, -P * 0.55, -0.03 * Math.max(1, P)); bar.castShadow = true;
      this.group.add(bar);
    } else if (stand === 'carrier') {
      this.group.position.y = centerY;
      const clip = new THREE.Mesh(new THREE.BoxGeometry(P * 0.9, 0.025, 0.03), steel);
      clip.position.set(0, P * 0.55, 0); this.pivot.add(clip);
      const wireGeo = new THREE.CylinderGeometry(0.003, 0.003, 1, 6);
      for (const sx of [-0.35, 0.35]) {
        const w = new THREE.Mesh(wireGeo, steel);
        const top = 2.85 - centerY;
        const len = top - P * 0.55;
        w.scale.y = len; w.position.set(sx * P, P * 0.55 + len / 2, 0); this.group.add(w);
      }
      const trolley = new THREE.Mesh(new THREE.BoxGeometry(P * 0.95, 0.08, 0.12), steel);
      trolley.position.set(0, 2.85 - centerY, 0); this.group.add(trolley);
    } else if (stand === 'electronic') {
      this.group.position.y = centerY;
      const frameMat = mats.dark || new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.55, metalness: 0.3 });
      const T = P * 0.12, D = P * 0.35;
      const parts = [
        [P * 1.3, T, D, 0, P * 0.59],
        [P * 1.3, T, D, 0, -P * 0.59],
        [T, P * 1.06, D, -P * 0.59, 0],
        [T, P * 1.06, D, P * 0.59, 0],
      ];
      for (const [w, h, d, x, y] of parts) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
        m.position.set(x, y, -d * 0.3); m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
      }
      this.ledMat = new THREE.MeshStandardMaterial({ color: 0x0, emissive: 0x2dff7a, emissiveIntensity: 2.2 });
      const led = new THREE.Mesh(new THREE.BoxGeometry(P * 0.5, T * 0.18, 0.01), this.ledMat);
      led.position.set(0, -P * 0.59, D * 0.21); this.group.add(led);
      const ped = new THREE.Mesh(new THREE.BoxGeometry(P * 0.3, centerY - groundY - P * 0.65, P * 0.3), frameMat);
      ped.position.set(0, -(centerY - groundY + P * 0.65) / 2, -D * 0.3); ped.castShadow = true;
      this.group.add(ped);
    } else if (stand === 'popup') {
      this.group.position.y = groundY;
      const base = new THREE.Mesh(new THREE.BoxGeometry(P * 1.2, 0.12, 0.35), steel);
      base.position.set(0, 0.06, -0.1); base.castShadow = true; base.receiveShadow = true;
      this.group.add(base);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, P * 0.5, 0.03), steel);
      arm.position.set(0, P * 0.25, -0.02); this.pivot.add(arm);
      this.pivot.position.y = 0.1;
      this.pivot.rotation.x = -Math.PI / 2;
      this.state = 'down';
    }
  }

  // world point -> face local (x, y) in metres
  toFaceLocal(worldPoint) {
    _v.copy(worldPoint);
    this.face.worldToLocal(_v);
    return { x: _v.x, y: _v.y };
  }

  addHole(x, y, visR) {
    const m = new THREE.Mesh(
      Target.holeGeo || (Target.holeGeo = new THREE.PlaneGeometry(1, 1)),
      Target.holeMat || (Target.holeMat = new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }))
    );
    m.scale.setScalar(visR * 2.0);
    m.position.set(x, y, 0);
    m.rotation.z = Math.random() * Math.PI * 2;
    this.holeLayer.add(m);
    this.holes.push(m);
    if (this.holes.length > 80) { const o = this.holes.shift(); this.holeLayer.remove(o); }
    return m;
  }
  clearHoles() {
    for (const h of this.holes) this.holeLayer.remove(h);
    this.holes.length = 0;
  }

  // Replace target face: turning edge-on (25m-style turning target), electronic reset, or popup cycle
  replace(onMid) {
    if (this.stand === 'electronic') {
      this.anim = { type: 'reset', t: 0, dur: 0.9, mid: false, onMid };
    } else if (this.stand === 'popup') {
      this.clearHoles(); onMid && onMid();
    } else {
      this.anim = { type: 'turn', t: 0, dur: 0.9, mid: false, onMid };
    }
  }
  popUp(dur = 0.28) { this.anim = { type: 'up', t: 0, dur }; this.state = 'rising'; }
  popDown(dur = 0.35) { this.anim = { type: 'down', t: 0, dur }; this.state = 'falling'; }
  get busy() { return !!this.anim && this.anim.type !== 'reset'; }
  get isUp() { return this.state === 'up'; }

  update(dt) {
    const a = this.anim;
    if (!a) return;
    a.t += dt;
    const k = clamp(a.t / a.dur, 0, 1);
    if (a.type === 'turn') {
      const s = k < 0.5 ? easeInOut(k * 2) : easeInOut((1 - k) * 2);
      this.pivot.rotation.y = s * Math.PI / 2;
      if (k >= 0.5 && !a.mid) { a.mid = true; this.clearHoles(); a.onMid && a.onMid(); }
    } else if (a.type === 'reset') {
      if (this.ledMat) this.ledMat.emissive.setHex(k < 0.85 ? 0xff3b2f : 0x2dff7a);
      for (const h of this.holes) h.material.opacity = 1;
      this.holeLayer.scale.setScalar(1 - easeInOut(Math.min(1, k * 1.6)) * 0.999);
      if (k >= 0.6 && !a.mid) { a.mid = true; this.clearHoles(); this.holeLayer.scale.setScalar(1); a.onMid && a.onMid(); }
    } else if (a.type === 'up') {
      this.pivot.rotation.x = -Math.PI / 2 * (1 - easeInOut(k));
      if (k >= 1) this.state = 'up';
    } else if (a.type === 'down') {
      this.pivot.rotation.x = -Math.PI / 2 * easeInOut(k);
      if (k >= 1) this.state = 'down';
    }
    if (k >= 1) { if (a.type === 'reset') this.holeLayer.scale.setScalar(1); this.anim = null; }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry && o.geometry !== Target.holeGeo) o.geometry.dispose();
    });
  }
}

// Draw the electronic scoring monitor (HUD + results + in-world screens)
export function drawMonitor(ctx, size, shots, opts = {}) {
  const style = opts.style || 'pistol';
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = opts.bg || '#0d0e10';
  ctx.fillRect(0, 0, size, size);
  // Zoom so the displayed area focuses on the black/aiming region if requested
  const zoom = opts.zoom || 1;
  ctx.save();
  ctx.translate(size / 2, size / 2); ctx.scale(zoom, zoom); ctx.translate(-size / 2, -size / 2);
  drawFace(ctx, size, style, { paper: false, label: false, ringFrac: 0.92, numbers: size > 220 });
  ctx.restore();
  const R = (size / 2) * 0.92 * zoom;
  const cx = size / 2;
  const hl = opts.highlight ?? -1;
  shots.forEach((s, i) => {
    if (s.score === 0 && Math.hypot(s.x, s.y) > 1.15) return;
    const px = cx + s.x * R, py = cx - s.y * R;
    const last = i === shots.length - 1;
    const isH = i === hl;
    const rr = Math.max(2.5, size * (isH ? 0.03 : 0.022));
    ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2);
    ctx.fillStyle = isH ? '#e3a948' : last && opts.markLast ? '#e3a948' : (opts.dim ? 'rgba(120,180,255,0.55)' : 'rgba(120,180,255,0.9)');
    ctx.fill();
    ctx.lineWidth = Math.max(1, size / 260); ctx.strokeStyle = '#0d0e10'; ctx.stroke();
    if (opts.numbers) {
      ctx.fillStyle = '#0d0e10'; ctx.font = `700 ${Math.round(rr * 1.1)}px Inter, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), px, py + 0.5);
    }
  });
  if (opts.mpi && shots.length > 1) {
    const hits = shots.filter((s) => s.score > 0);
    if (hits.length) {
      const mx = hits.reduce((a, s) => a + s.x, 0) / hits.length, my = hits.reduce((a, s) => a + s.y, 0) / hits.length;
      const px = cx + mx * R, py = cx - my * R;
      ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px - 8, py); ctx.lineTo(px + 8, py); ctx.moveTo(px, py - 8); ctx.lineTo(px, py + 8); ctx.stroke();
    }
  }
}
