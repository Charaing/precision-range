// Shared math helpers (frame-rate independent damping, noise, RNG)
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash1(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
// Smooth 1D value noise in [-1, 1]
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u) * 2 - 1;
}
// Smooth 2D value noise in [0, 1]
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
export function fbm2(x, y, oct = 5) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += noise2(x * f, y * f) * a; n += a; a *= 0.5; f *= 2.03; }
  return v / n;
}
export function ridged2(x, y, oct = 5) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    const r = 1 - Math.abs(noise2(x * f, y * f) * 2 - 1);
    v += r * r * a; n += a; a *= 0.5; f *= 2.1;
  }
  return v / n;
}
// Gaussian random (Box-Muller)
export function gauss(rng = Math.random) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Critically-damped-ish spring integrated with fixed substeps (frame-rate independent)
export class Spring {
  constructor(stiffness = 120, damping = 14) {
    this.k = stiffness; this.c = damping; this.x = 0; this.v = 0;
  }
  impulse(v) { this.v += v; }
  update(dt, target = 0) {
    const step = 1 / 240;
    let t = dt;
    while (t > 1e-6) {
      const h = Math.min(step, t);
      const a = -this.k * (this.x - target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
      t -= h;
    }
    return this.x;
  }
  reset() { this.x = 0; this.v = 0; }
}

export function fmt(n, d = 1) { return Number(n).toFixed(d); }
export function pad(n, l = 2) { return String(n).padStart(l, '0'); }
export function fmtTime(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${pad(m)}:${pad(s)}`;
}
