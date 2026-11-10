// Self-made game sound effects: everything is synthesised in WebAudio at runtime
// (no recorded firearm samples). Stereo reverb impulses are generated per environment.
import { mulberry32 } from './util.js';

const SR = 48000;

function biquadLP(data, sr, f, q = 0.707) { return biquad(data, sr, 'lp', f, q); }
function biquad(data, sr, type, f, q = 0.707) {
  const w0 = 2 * Math.PI * f / sr, cs = Math.cos(w0), sn = Math.sin(w0), al = sn / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; } // bandpass
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}
function noise(n, rng) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = rng() * 2 - 1; return a; }

// Per-weapon synthesis recipes (stylised)
const GUNS = {
  p10: { crack: 0.9, crackHP: 2400, crackDecay: 0.006, body: 0.55, bodyF: 900, bodyDecay: 0.03, thump: 0.35, thumpF0: 160, thumpF1: 55, thumpDecay: 0.05, tail: 0.18, tailDecay: 0.14, len: 0.6 },
  p20: { crack: 0.8, crackHP: 1500, crackDecay: 0.008, body: 0.9, bodyF: 520, bodyDecay: 0.06, thump: 0.8, thumpF0: 120, thumpF1: 38, thumpDecay: 0.09, tail: 0.35, tailDecay: 0.28, len: 1.0 },
  r10: { crack: 0.7, crackHP: 3000, crackDecay: 0.004, body: 0.4, bodyF: 1300, bodyDecay: 0.02, thump: 0.2, thumpF0: 200, thumpF1: 80, thumpDecay: 0.03, tail: 0.1, tailDecay: 0.1, len: 0.45 },
  r20: { crack: 1.0, crackHP: 2000, crackDecay: 0.007, body: 0.8, bodyF: 700, bodyDecay: 0.05, thump: 0.7, thumpF0: 140, thumpF1: 45, thumpDecay: 0.08, tail: 0.4, tailDecay: 0.35, len: 1.1 },
  x1: { crack: 1.0, crackHP: 1200, crackDecay: 0.01, body: 1.0, bodyF: 380, bodyDecay: 0.09, thump: 1.0, thumpF0: 95, thumpF1: 30, thumpDecay: 0.14, tail: 0.6, tailDecay: 0.6, len: 1.6 },
};

const REVERBS = {
  indoor: { len: 1.6, decay: 0.42, early: [[0.011, 0.6], [0.019, 0.45], [0.031, 0.35], [0.046, 0.3]], lp: 5200, wet: 0.55 },
  hall: { len: 2.2, decay: 0.6, early: [[0.015, 0.5], [0.028, 0.4], [0.052, 0.3], [0.08, 0.2]], lp: 6000, wet: 0.5 },
  arena: { len: 3.4, decay: 1.05, early: [[0.03, 0.4], [0.06, 0.3], [0.11, 0.25], [0.19, 0.18]], lp: 4800, wet: 0.55 },
  outdoor: { len: 2.4, decay: 0.25, early: [[0.09, 0.2], [0.31, 0.12], [0.7, 0.08]], lp: 3500, wet: 0.35 },
  mountain: { len: 5.0, decay: 0.3, early: [[0.45, 0.22], [1.25, 0.16], [2.1, 0.12], [3.3, 0.07]], lp: 2400, wet: 0.45 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null; this.ready = false;
    this.vol = { master: 0.8, weapon: 0.85, ambient: 0.6, reverb: 0.7, ui: 0.6 };
    this.buffers = {}; this.ambientNodes = [];
    this.birdTimer = 0; this.envId = null; this.heartGain = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ sampleRate: SR });
    const c = this.ctx;
    this.master = c.createGain();
    this.focusLP = c.createBiquadFilter(); this.focusLP.type = 'lowpass'; this.focusLP.frequency.value = 20000;
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -10; this.comp.ratio.value = 6; this.comp.attack.value = 0.002; this.comp.release.value = 0.2;
    this.master.connect(this.focusLP); this.focusLP.connect(this.comp); this.comp.connect(c.destination);
    this.weaponBus = c.createGain(); this.ambBus = c.createGain(); this.uiBus = c.createGain(); this.fxBus = c.createGain();
    this.convolver = c.createConvolver(); this.revGain = c.createGain();
    this.revSend = c.createGain();
    this.revSend.connect(this.convolver); this.convolver.connect(this.revGain); this.revGain.connect(this.master);
    this.weaponBus.connect(this.master); this.ambBus.connect(this.master); this.uiBus.connect(this.c2 = this.master); this.fxBus.connect(this.master);
    this.applyVolumes();
    this.ready = true;
    this.makeBuffers();
    if (this.pendingEnv) this.setEnvironment(this.pendingEnv.reverb, this.pendingEnv.ambient);
  }
  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.weaponBus.gain.value = this.vol.weapon;
    this.fxBus.gain.value = this.vol.weapon * 0.9;
    this.ambBus.gain.value = this.vol.ambient * 0.5;
    this.uiBus.gain.value = this.vol.ui * 0.5;
    this.revGain.gain.value = this.vol.reverb * (this.revWet || 0.5);
  }
  setVolumes(v) { Object.assign(this.vol, v); this.applyVolumes(); }

  makeBuffers() {
    const rng = mulberry32(1234);
    for (const id of Object.keys(GUNS)) this.buffers['gun_' + id] = this.synthGun(GUNS[id], rng);
    this.buffers.click = this.synthClick(0.012, 3500, 0.5, rng);
    this.buffers.clickHeavy = this.synthClick(0.03, 1800, 0.8, rng);
    this.buffers.dry = this.synthClick(0.02, 2600, 0.6, rng);
    this.buffers.slide = this.synthSlide(0.09, rng);
    this.buffers.paper = this.synthPaper(rng);
    this.buffers.steel = this.synthSteel();
    this.buffers.thud = this.synthThud(rng);
    this.buffers.heart = this.synthHeart();
    this.buffers.breathIn = this.synthBreath(0.9, true, rng);
    this.buffers.breathOut = this.synthBreath(1.3, false, rng);
    this.buffers.applause = this.synthApplause(rng);
  }
  buf(data) {
    const stereo = Array.isArray(data);
    const b = this.ctx.createBuffer(stereo ? 2 : 1, stereo ? data[0].length : data.length, SR);
    if (stereo) { b.copyToChannel(data[0], 0); b.copyToChannel(data[1], 1); } else b.copyToChannel(data, 0);
    return b;
  }
  synthGun(p, rng) {
    const n = Math.floor(SR * p.len);
    const out = new Float32Array(n);
    const wn = noise(n, rng);
    const crack = biquad(wn, SR, 'hp', p.crackHP, 0.9);
    const body = biquad(wn, SR, 'bp', p.bodyF, 1.2);
    const tail = biquadLP(noise(n, rng), SR, 900, 0.7);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const atk = Math.min(1, t / 0.0004);
      const f = p.thumpF1 + (p.thumpF0 - p.thumpF1) * Math.exp(-t / 0.02);
      ph += 2 * Math.PI * f / SR;
      out[i] = atk * (
        crack[i] * p.crack * 1.6 * Math.exp(-t / p.crackDecay) +
        body[i] * p.body * 3.0 * Math.exp(-t / p.bodyDecay) +
        Math.sin(ph) * p.thump * Math.exp(-t / p.thumpDecay) +
        tail[i] * p.tail * 1.4 * Math.exp(-t / p.tailDecay)
      );
    }
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(out[i]));
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] / mx * 1.6) * 0.9;
    return this.buf(out);
  }
  synthClick(len, f, q, rng) {
    const n = Math.floor(SR * len); const wn = noise(n, rng);
    const b = biquad(wn, SR, 'bp', f, 2);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / SR; out[i] = b[i] * Math.exp(-t / (len * 0.25)) * 3 * q; }
    return this.buf(out);
  }
  synthSlide(len, rng) {
    const n = Math.floor(SR * len); const wn = noise(n, rng);
    const b = biquad(wn, SR, 'bp', 3200, 1.5); const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / SR; const env = Math.sin(Math.PI * Math.min(1, t / len)) * 0.5 + (t > len * 0.8 ? Math.exp(-(t - len * 0.8) / 0.004) * 2 : 0); out[i] = b[i] * env; }
    return this.buf(out);
  }
  synthPaper(rng) {
    const n = Math.floor(SR * 0.06); const wn = noise(n, rng); const b = biquad(wn, SR, 'bp', 1800, 0.8); const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = b[i] * Math.exp(-i / SR / 0.008) * 2;
    return this.buf(out);
  }
  synthSteel() {
    const n = Math.floor(SR * 1.4); const out = new Float32Array(n);
    const fr = [880, 1418, 2215, 3120, 4410], am = [1, 0.6, 0.4, 0.25, 0.15];
    for (let i = 0; i < n; i++) { const t = i / SR; let s = 0; for (let k = 0; k < 5; k++) s += Math.sin(2 * Math.PI * fr[k] * t) * am[k] * Math.exp(-t / (0.5 / (1 + k * 0.5))); out[i] = s * 0.35 * Math.min(1, t / 0.001); }
    return this.buf(out);
  }
  synthThud(rng) {
    const n = Math.floor(SR * 0.2); const wn = biquadLP(noise(n, rng), SR, 400); const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = wn[i] * Math.exp(-i / SR / 0.04) * 4;
    return this.buf(out);
  }
  synthHeart() {
    const n = Math.floor(SR * 0.45); const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const a = Math.sin(2 * Math.PI * 48 * t) * Math.exp(-t / 0.05);
      const t2 = t - 0.16; const b = t2 > 0 ? Math.sin(2 * Math.PI * 42 * t2) * Math.exp(-t2 / 0.05) * 0.6 : 0;
      out[i] = (a + b) * 0.9;
    }
    return this.buf(out);
  }
  synthBreath(len, inhale, rng) {
    const n = Math.floor(SR * len); const wn = biquad(noise(n, rng), SR, 'bp', inhale ? 1600 : 1100, 0.6); const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / n; const env = Math.sin(Math.PI * t) * (inhale ? t : 1 - t * 0.6); out[i] = wn[i] * env * 0.6; }
    return this.buf(out);
  }
  synthApplause(rng) {
    const n = Math.floor(SR * 3.5); const L = new Float32Array(n), Rr = new Float32Array(n);
    for (let k = 0; k < 2200; k++) {
      const start = Math.floor(rng() * (n - 2000) * Math.pow(rng(), 0.3)), amp = 0.2 + rng() * 0.5, pan = rng();
      const f = 800 + rng() * 2400;
      for (let i = 0; i < 600; i++) {
        const s = (rng() * 2 - 1) * Math.exp(-i / 90) * amp * Math.sin(i * f / SR * 6.28 + 1.0) ;
        L[start + i] += s * (1 - pan); Rr[start + i] += s * pan;
      }
    }
    for (let i = 0; i < n; i++) { const env = Math.min(1, i / (SR * 0.3)) * Math.min(1, (n - i) / (SR * 1.5)); L[i] *= env * 0.25; Rr[i] *= env * 0.25; }
    return this.buf([L, Rr]);
  }

  makeImpulse(cfg) {
    const n = Math.floor(SR * cfg.len); const rng = mulberry32(77);
    const ch = [new Float32Array(n), new Float32Array(n)];
    for (let c = 0; c < 2; c++) {
      const d = ch[c];
      for (let i = 0; i < n; i++) { const t = i / SR; d[i] = (rng() * 2 - 1) * Math.exp(-t / cfg.decay) * 0.5; }
      for (const [t, g] of cfg.early) {
        const idx = Math.floor((t * (c ? 1.07 : 0.95)) * SR);
        for (let j = 0; j < 400 && idx + j < n; j++) d[idx + j] += (rng() * 2 - 1) * g * Math.exp(-j / 80);
      }
      ch[c] = biquadLP(d, SR, cfg.lp, 0.6);
    }
    return this.buf(ch);
  }

  setEnvironment(reverb, ambient) {
    if (!this.ready) { this.pendingEnv = { reverb, ambient }; return; }
    const cfg = REVERBS[reverb] || REVERBS.indoor;
    this.convolver.buffer = this.makeImpulse(cfg);
    this.revWet = cfg.wet; this.applyVolumes();
    this.envId = ambient;
    this.startAmbient(ambient);
  }

  stopAmbient() {
    for (const n of this.ambientNodes) { try { n.stop ? n.stop() : n.disconnect(); } catch (e) { /* noop */ } }
    this.ambientNodes = [];
  }
  loopNoise(seconds, color, rng) {
    const n = Math.floor(SR * seconds); const L = new Float32Array(n), R = new Float32Array(n);
    for (const d of [L, R]) {
      let b = 0;
      for (let i = 0; i < n; i++) { const w = rng() * 2 - 1; b = color === 'brown' ? (b + 0.02 * w) / 1.02 : w; d[i] = color === 'brown' ? b * 3.5 : w; }
      // crossfade loop edges
      const fade = 2000; for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[n - fade + i] * (1 - k); }
    }
    return this.buf([L, R]);
  }
  startAmbient(kind) {
    if (!this.ready) return;
    this.stopAmbient();
    const c = this.ctx, rng = mulberry32(3);
    const add = (buffer, filterType, freq, q, gain, lfo) => {
      const src = c.createBufferSource(); src.buffer = buffer; src.loop = true;
      const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.ambBus); src.start();
      this.ambientNodes.push(src, f, g);
      if (lfo) {
        const o = c.createOscillator(); o.frequency.value = lfo[0]; const og = c.createGain(); og.gain.value = lfo[1];
        o.connect(og); og.connect(g.gain); o.start(); this.ambientNodes.push(o, og);
      }
      return g;
    };
    const brown = this.loopNoise(6, 'brown', rng), white = this.loopNoise(6, 'white', rng);
    if (kind === 'indoor' || kind === 'hall') {
      add(brown, 'lowpass', 220, 0.7, kind === 'hall' ? 0.35 : 0.5);
      const o = c.createOscillator(); o.frequency.value = 120; const g = c.createGain(); g.gain.value = kind === 'indoor' ? 0.006 : 0.002;
      o.connect(g); g.connect(this.ambBus); o.start(); this.ambientNodes.push(o, g);
    } else if (kind === 'arena') {
      add(white, 'bandpass', 520, 0.6, 0.12, [0.15, 0.04]);
      add(white, 'bandpass', 1300, 0.9, 0.05, [0.23, 0.02]);
      add(brown, 'lowpass', 160, 0.7, 0.35);
    } else if (kind === 'outdoor') {
      add(white, 'bandpass', 420, 0.5, 0.06, [0.08, 0.04]);
      add(brown, 'lowpass', 300, 0.7, 0.25, [0.05, 0.12]);
    } else if (kind === 'mountain') {
      add(white, 'bandpass', 600, 0.4, 0.09, [0.06, 0.07]);
      add(brown, 'lowpass', 260, 0.7, 0.4, [0.04, 0.2]);
    }
  }
  // occasional birds outdoors
  tick(dt, tod) {
    if (!this.ready) return;
    if ((this.envId === 'outdoor' || this.envId === 'mountain') && tod !== 'night') {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) { this.birdTimer = 2 + Math.random() * 7; this.bird(); }
    }
  }
  bird() {
    const c = this.ctx, t0 = c.currentTime;
    const pan = c.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8;
    const g = c.createGain(); g.gain.value = 0; pan.connect(this.ambBus); g.connect(pan);
    const o = c.createOscillator(); o.type = 'sine'; o.connect(g);
    const base = 2600 + Math.random() * 1800, notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * 0.13;
      o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + 0.07);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.01); g.gain.linearRampToValueAtTime(0, t + 0.09);
    }
    o.start(t0); o.stop(t0 + notes * 0.13 + 0.1);
  }

  play(name, { gain = 1, rate = 1, pan = 0, delay = 0, bus = 'fx', send = 0 } = {}) {
    if (!this.ready || !this.buffers[name]) return;
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.buffers[name]; src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = gain;
    const p = c.createStereoPanner(); p.pan.value = pan;
    src.connect(g); g.connect(p);
    p.connect(bus === 'ui' ? this.uiBus : bus === 'weapon' ? this.weaponBus : bus === 'amb' ? this.ambBus : this.fxBus);
    if (send > 0) { const s = c.createGain(); s.gain.value = send; p.connect(s); s.connect(this.revSend); }
    src.start(c.currentTime + delay);
  }
  gunshot(id) {
    this.play('gun_' + id, { gain: 1, rate: 0.97 + Math.random() * 0.06, pan: 0.12, bus: 'weapon', send: 1 });
  }
  impact(kind, distance, pan) {
    const travel = distance / 340;
    if (kind === 'paper') this.play('paper', { gain: Math.max(0.05, 0.6 - distance / 80), pan, delay: Math.min(travel, 0.3), send: 0.3 });
    else if (kind === 'steel') this.play('steel', { gain: 0.5, pan, delay: travel, send: 0.4 });
    else this.play('thud', { gain: Math.max(0.1, 0.5 - distance / 200), pan, delay: Math.min(travel, 3), send: 0.3 });
  }
  ui(kind) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(this.uiBus);
    if (kind === 'hover') { o.frequency.value = 2400; g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03); o.start(t); o.stop(t + 0.04); }
    else if (kind === 'click') { o.frequency.value = 1300; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06); o.start(t); o.stop(t + 0.07); }
    else if (kind === 'confirm') { o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1320, t + 0.07); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); o.start(t); o.stop(t + 0.24); }
    else if (kind === 'score') { o.type = 'triangle'; o.frequency.setValueAtTime(1046, t); o.frequency.setValueAtTime(1568, t + 0.09); g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); o.start(t); o.stop(t + 0.36); }
    else if (kind === 'beep') { o.type = 'square'; o.frequency.value = 1760; g.gain.setValueAtTime(0.025, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08); o.start(t); o.stop(t + 0.09); }
    else if (kind === 'final') {
      [523, 659, 784, 1046].forEach((f, i) => {
        const oo = c.createOscillator(), gg = c.createGain(); oo.type = 'triangle'; oo.frequency.value = f; oo.connect(gg); gg.connect(this.uiBus);
        gg.gain.setValueAtTime(0, t + i * 0.09); gg.gain.linearRampToValueAtTime(0.09, t + i * 0.09 + 0.01); gg.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.6);
        oo.start(t + i * 0.09); oo.stop(t + i * 0.09 + 0.62);
      });
      o.disconnect();
    }
  }
  heartbeat(level) { if (level > 0.02) this.play('heart', { gain: level, bus: 'fx' }); }
  setFocus(active) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.focusLP.frequency.cancelScheduledValues(t);
    this.focusLP.frequency.setTargetAtTime(active ? 1400 : 20000, t, active ? 0.08 : 0.3);
    this.ambBus.gain.setTargetAtTime(this.vol.ambient * 0.5 * (active ? 0.35 : 1), t, 0.15);
  }
}
