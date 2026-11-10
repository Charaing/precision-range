// Procedural PBR texture generation (all assets are generated in-browser; no external files)
import * as THREE from 'three';
import { mulberry32 } from './util.js';

let SIZE = 1024;
let ANISO = 4;
const cache = new Map();

export function setTextureQuality(q) {
  SIZE = { low: 512, medium: 1024, high: 2048, ultra: 2048 }[q] || 1024;
}
export function setAnisotropy(a) { ANISO = a; }
export function clearTextureCache() {
  for (const set of cache.values()) for (const t of Object.values(set)) t && t.dispose && t.dispose();
  cache.clear();
}

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// Low-res random grayscale tile, scaled up with smoothing = cheap value noise layer
function noiseTile(res, rng) {
  const c = cv(res, res), x = c.getContext('2d');
  const img = x.createImageData(res, res);
  for (let i = 0; i < res * res; i++) {
    const v = (rng() * 255) | 0;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}
// Draw tiling layered noise into ctx (grayscale around mid gray)
function layerNoise(ctx, size, rng, octaves, mode = 'overlay') {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = mode;
  for (const [res, alpha] of octaves) {
    const t = noiseTile(res, rng);
    ctx.globalAlpha = alpha;
    // draw 2x2 to keep tiling-ish edges smooth
    ctx.drawImage(t, 0, 0, size, size);
  }
  ctx.restore();
}
function speckle(ctx, size, rng, count, color, rMin, rMax, alpha) {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * (0.4 + rng() * 0.6);
    const r = rMin + rng() * (rMax - rMin);
    ctx.beginPath(); ctx.arc(rng() * size, rng() * size, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function toTex(canvas, repeat, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function grayFrom(canvas, contrast = 1, bias = 0) {
  const s = canvas.width, c = cv(s, s), x = c.getContext('2d');
  x.filter = `grayscale(1) contrast(${contrast}) brightness(${1 + bias})`;
  x.drawImage(canvas, 0, 0);
  return c;
}

function make(key, fn) {
  if (cache.has(key)) return cache.get(key);
  const r = fn();
  cache.set(key, r);
  return r;
}
// Returns {map, roughnessMap, bumpMap} clones with independent repeat
function withRepeat(set, repeat) {
  const out = {};
  for (const k of Object.keys(set)) {
    const t = set[k].clone();
    t.repeat.set(repeat[0], repeat[1]);
    t.needsUpdate = true;
    out[k] = t;
  }
  return out;
}

export function concrete(repeat = [4, 4], tone = '#8a8986', seed = 1) {
  const set = make('concrete' + tone + seed, () => {
    const rng = mulberry32(seed * 977);
    const s = SIZE, c = cv(s, s), x = c.getContext('2d');
    x.fillStyle = tone; x.fillRect(0, 0, s, s);
    layerNoise(x, s, rng, [[6, 0.16], [24, 0.1], [128, 0.1], [512, 0.12]]);
    speckle(x, s, rng, s * 1.2, '#2b2a28', 0.4, 1.4, 0.18);
    speckle(x, s, rng, s * 0.6, '#d8d4cc', 0.4, 1.0, 0.12);
    // stains
    for (let i = 0; i < 9; i++) {
      x.globalAlpha = 0.06; x.fillStyle = '#3a3630';
      x.beginPath(); x.ellipse(rng() * s, rng() * s, s * (0.05 + rng() * 0.12), s * (0.03 + rng() * 0.08), rng() * 3, 0, 7); x.fill();
    }
    x.globalAlpha = 1;
    const rough = grayFrom(c, 1.4, 0.15);
    return { map: toTex(c, [1, 1]), roughnessMap: toTex(rough, [1, 1], false), bumpMap: toTex(grayFrom(c, 2.2), [1, 1], false) };
  });
  return withRepeat(set, repeat);
}

export function acoustic(repeat = [6, 2], tone = '#2e3134') {
  const set = make('acoustic' + tone, () => {
    const rng = mulberry32(51);
    const s = SIZE / 2, c = cv(s, s), x = c.getContext('2d');
    x.fillStyle = tone; x.fillRect(0, 0, s, s);
    const n = 8, w = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      // egg-crate pyramid shading
      const cx = i * w + w / 2, cy = j * w + w / 2;
      const g = x.createRadialGradient(cx - w * 0.15, cy - w * 0.15, 1, cx, cy, w * 0.62);
      g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
      x.fillStyle = g; x.fillRect(i * w, j * w, w, w);
    }
    layerNoise(x, s, rng, [[64, 0.15], [256, 0.2]]);
    const bump = cv(s, s), b = bump.getContext('2d');
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const cx = i * w + w / 2, cy = j * w + w / 2;
      const g = b.createRadialGradient(cx, cy, 1, cx, cy, w * 0.7);
      g.addColorStop(0, '#fff'); g.addColorStop(1, '#000');
      b.fillStyle = g; b.fillRect(i * w, j * w, w, w);
    }
    return { map: toTex(c, [1, 1]), bumpMap: toTex(bump, [1, 1], false) };
  });
  return withRepeat(set, repeat);
}

export function wood(repeat = [1, 1], tone = '#6b4527', planks = 0, seed = 3) {
  const set = make('wood' + tone + planks + seed, () => {
    const rng = mulberry32(seed * 131);
    const s = SIZE, c = cv(s, s), x = c.getContext('2d');
    x.fillStyle = tone; x.fillRect(0, 0, s, s);
    // grain lines
    for (let i = 0; i < 260; i++) {
      const y0 = rng() * s, amp = 4 + rng() * 14, f = 0.002 + rng() * 0.006, ph = rng() * 6;
      x.strokeStyle = rng() > 0.5 ? 'rgba(30,16,6,0.25)' : 'rgba(255,220,170,0.08)';
      x.lineWidth = 0.6 + rng() * 2.4;
      x.beginPath();
      for (let px = 0; px <= s; px += 8) {
        const py = y0 + Math.sin(px * f + ph) * amp + Math.sin(px * f * 3.1) * amp * 0.25;
        px === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.stroke();
    }
    layerNoise(x, s, rng, [[16, 0.12], [128, 0.1]]);
    if (planks > 0) {
      const ph = s / planks;
      for (let i = 0; i <= planks; i++) {
        x.fillStyle = 'rgba(15,8,3,0.65)'; x.fillRect(0, i * ph - 1.5, s, 3);
        const off = rng() * s;
        x.fillRect(off, i * ph, 3, ph);
      }
    }
    return { map: toTex(c, [1, 1]), roughnessMap: toTex(grayFrom(c, 0.6, 0.35), [1, 1], false), bumpMap: toTex(grayFrom(c, 1.5), [1, 1], false) };
  });
  return withRepeat(set, repeat);
}

export function grass(repeat = [60, 60]) {
  const set = make('grass', () => {
    const rng = mulberry32(77);
    const s = SIZE, c = cv(s, s), x = c.getContext('2d');
    x.fillStyle = '#4c5e2c'; x.fillRect(0, 0, s, s);
    layerNoise(x, s, rng, [[6, 0.35], [24, 0.3], [96, 0.25]]);
    for (let i = 0; i < s * 9; i++) {
      const px = rng() * s, py = rng() * s, l = 3 + rng() * 9;
      const g = 70 + rng() * 70 | 0;
      x.strokeStyle = `rgba(${g * 0.75 | 0},${g + 20},${g * 0.35 | 0},${0.35 + rng() * 0.4})`;
      x.lineWidth = 1;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (rng() - 0.5) * 4, py - l); x.stroke();
    }
    speckle(x, s, rng, 400, '#9a8a55', 1, 3, 0.25);
    return { map: toTex(c, [1, 1]), roughnessMap: toTex(grayFrom(c, 0.5, 0.5), [1, 1], false), bumpMap: toTex(grayFrom(c, 1.6), [1, 1], false) };
  });
  return withRepeat(set, repeat);
}

export function dirt(repeat = [10, 10], tone = '#6e5a43') {
  const set = make('dirt' + tone, () => {
    const rng = mulberry32(91);
    const s = SIZE, c = cv(s, s), x = c.getContext('2d');
    x.fillStyle = tone; x.fillRect(0, 0, s, s);
    layerNoise(x, s, rng, [[8, 0.4], [32, 0.3], [128, 0.25], [512, 0.15]]);
    speckle(x, s, rng, s * 2, '#2d241a', 0.6, 2.5, 0.35);
    speckle(x, s, rng, s, '#b9a585', 0.5, 2, 0.3);
    return { map: toTex(c, [1, 1]), roughnessMap: toTex(grayFrom(c, 0.5, 0.45), [1, 1], false), bumpMap: toTex(grayFrom(c, 2), [1, 1], false) };
  });
  return withRepeat(set, repeat);
}

export function brushed(repeat = [1, 1], tone = '#9a9da1') {
  const set = make('brushed' + tone, () => {
    const rng = mulberry32(13);
    const s = SIZE / 2, c = cv(s, s), x = c.getContext('2d');
    x.fillStyle = tone; x.fillRect(0, 0, s, s);
    for (let i = 0; i < s * 3; i++) {
      x.strokeStyle = rng() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      const y = rng() * s;
      x.beginPath(); x.moveTo(0, y); x.lineTo(s, y + (rng() - 0.5) * 2); x.stroke();
    }
    return { map: toTex(c, [1, 1]), roughnessMap: toTex(grayFrom(c, 3, -0.4), [1, 1], false) };
  });
  return withRepeat(set, repeat);
}

export function rubberMat(repeat = [4, 4]) {
  const set = make('rubber', () => {
    const rng = mulberry32(5);
    const s = SIZE / 2, c = cv(s, s), x = c.getContext('2d');
    x.fillStyle = '#1d1e1f'; x.fillRect(0, 0, s, s);
    const n = 16, w = s / n;
    x.fillStyle = '#26282a';
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      x.beginPath(); x.arc(i * w + w / 2, j * w + w / 2, w * 0.28, 0, 7); x.fill();
    }
    layerNoise(x, s, rng, [[64, 0.12]]);
    const b = cv(s, s), bx = b.getContext('2d'); bx.fillStyle = '#000'; bx.fillRect(0, 0, s, s); bx.fillStyle = '#fff';
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { bx.beginPath(); bx.arc(i * w + w / 2, j * w + w / 2, w * 0.28, 0, 7); bx.fill(); }
    return { map: toTex(c, [1, 1]), bumpMap: toTex(b, [1, 1], false) };
  });
  return withRepeat(set, repeat);
}

export function granulate(repeat = [8, 3]) {
  const set = make('granulate', () => {
    const rng = mulberry32(17);
    const s = SIZE / 2, c = cv(s, s), x = c.getContext('2d');
    x.fillStyle = '#151515'; x.fillRect(0, 0, s, s);
    speckle(x, s, rng, s * 6, '#2c2c2c', 0.8, 2.6, 0.9);
    speckle(x, s, rng, s * 2, '#050505', 0.8, 2.2, 0.9);
    return { map: toTex(c, [1, 1]), bumpMap: toTex(grayFrom(c, 2.5), [1, 1], false) };
  });
  return withRepeat(set, repeat);
}

export function cardboard(repeat = [1, 1]) {
  const set = make('cardboard', () => {
    const rng = mulberry32(23);
    const s = SIZE / 4, c = cv(s, s), x = c.getContext('2d');
    x.fillStyle = '#a88a62'; x.fillRect(0, 0, s, s);
    layerNoise(x, s, rng, [[16, 0.2], [64, 0.2]]);
    for (let i = 0; i < s; i += 6) { x.fillStyle = 'rgba(70,50,30,0.08)'; x.fillRect(i, 0, 2, s); }
    return { map: toTex(c, [1, 1]) };
  });
  return withRepeat(set, repeat);
}

export function corrugated(repeat = [8, 1]) {
  const set = make('corr', () => {
    const s = 256, c = cv(s, s), x = c.getContext('2d');
    for (let i = 0; i < s; i++) {
      const v = 120 + Math.sin(i / s * Math.PI * 2 * 4) * 60 | 0;
      x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, 0, 1, s);
    }
    const col = cv(s, s), cx = col.getContext('2d');
    cx.fillStyle = '#8d9396'; cx.fillRect(0, 0, s, s);
    layerNoise(cx, s, mulberry32(4), [[16, 0.15], [64, 0.1]]);
    return { map: toTex(col, [1, 1]), bumpMap: toTex(c, [1, 1], false) };
  });
  return withRepeat(set, repeat);
}

export function panel(repeat = [1, 1], tone = '#202326', seams = 4) {
  const set = make('panel' + tone + seams, () => {
    const rng = mulberry32(31);
    const s = SIZE / 2, c = cv(s, s), x = c.getContext('2d');
    x.fillStyle = tone; x.fillRect(0, 0, s, s);
    layerNoise(x, s, rng, [[32, 0.08], [128, 0.06]]);
    x.fillStyle = 'rgba(0,0,0,0.6)';
    for (let i = 0; i <= seams; i++) { x.fillRect(i * s / seams - 1, 0, 2, s); }
    x.fillRect(0, s / 2 - 1, s, 2);
    const b = grayFrom(c, 3);
    return { map: toTex(c, [1, 1]), bumpMap: toTex(b, [1, 1], false) };
  });
  return withRepeat(set, repeat);
}

// Text/sign canvas texture (lane numbers, banners, signs)
export function textTexture(lines, opts = {}) {
  const w = opts.w || 512, h = opts.h || 256;
  const c = cv(w, h), x = c.getContext('2d');
  x.fillStyle = opts.bg || '#111'; x.fillRect(0, 0, w, h);
  if (opts.border) { x.strokeStyle = opts.border; x.lineWidth = opts.borderW || 6; x.strokeRect(6, 6, w - 12, h - 12); }
  x.fillStyle = opts.color || '#eee';
  x.textAlign = opts.align || 'center'; x.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((ln, i) => {
    const size = (Array.isArray(opts.size) ? opts.size[i] : opts.size) || h * 0.5 / n;
    x.font = `${opts.weight || 600} ${size}px ${opts.font || 'Inter, Arial, sans-serif'}`;
    if (opts.spacing) x.letterSpacing = opts.spacing;
    const tx = opts.align === 'left' ? w * 0.06 : w / 2;
    x.fillText(ln, tx, h * (i + 0.5) / n);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO;
  return t;
}

export function radialSprite(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,140,40,0)', size = 128) {
  const c = cv(size, size), x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.6)')); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function flashSprite(size = 256) {
  const c = cv(size, size), x = c.getContext('2d');
  const cx = size / 2;
  x.globalCompositeOperation = 'lighter';
  const g = x.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.5);
  g.addColorStop(0, 'rgba(255,250,230,1)'); g.addColorStop(0.3, 'rgba(255,200,110,0.8)'); g.addColorStop(1, 'rgba(255,120,30,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    x.save(); x.translate(cx, cx); x.rotate(a);
    const sg = x.createLinearGradient(0, 0, cx * 0.95, 0);
    sg.addColorStop(0, 'rgba(255,220,150,0.8)'); sg.addColorStop(1, 'rgba(255,120,30,0)');
    x.fillStyle = sg; x.beginPath(); x.moveTo(0, -cx * 0.05); x.lineTo(cx * 0.95, 0); x.lineTo(0, cx * 0.05); x.fill();
    x.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function smokeSprite(size = 128) {
  const c = cv(size, size), x = c.getContext('2d');
  const rng = mulberry32(8);
  for (let i = 0; i < 14; i++) {
    const px = size / 2 + (rng() - 0.5) * size * 0.35, py = size / 2 + (rng() - 0.5) * size * 0.35, r = size * (0.15 + rng() * 0.2);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(210,210,210,0.18)'); g.addColorStop(1, 'rgba(210,210,210,0)');
    x.fillStyle = g; x.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function holeTexture(size = 128) {
  const c = cv(size, size), x = c.getContext('2d');
  const cx = size / 2, rng = mulberry32(99);
  // faint grey lead ring + torn paper rim + dark core
  x.fillStyle = 'rgba(70,70,70,0.35)';
  x.beginPath(); x.arc(cx, cx, cx * 0.98, 0, 7); x.fill();
  x.fillStyle = 'rgba(245,240,230,0.85)';
  x.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = i / 24 * Math.PI * 2, r = cx * (0.8 + rng() * 0.12);
    i ? x.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r) : x.moveTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
  }
  x.fill();
  x.fillStyle = 'rgba(8,8,8,1)';
  x.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = i / 24 * Math.PI * 2, r = cx * (0.62 + rng() * 0.1);
    i ? x.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r) : x.moveTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
  }
  x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function starsTexture() {
  const s = 1024, c = cv(s, s), x = c.getContext('2d');
  const rng = mulberry32(2024);
  x.fillStyle = '#000'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 1600; i++) {
    x.fillStyle = `rgba(255,255,255,${0.2 + rng() * 0.8})`;
    const r = rng() < 0.04 ? 1.4 : 0.6;
    x.beginPath(); x.arc(rng() * s, rng() * s, r, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
