// Virtual body model: breathing, heartbeat, fatigue, tension and the FOCUS gauge.
// A tunable game model inspired by human rhythms — not a physiological simulation.
import { clamp, damp, noise1, lerp } from './util.js';

export class Body {
  constructor() { this.reset(); }
  reset() {
    this.t = 0;
    this.breathPhase = 0; this.breathRate = 0.2; this.breathAmp = 1;
    this.heartPhase = 0; this.bpm = 72; this.pulse = 0;
    this.fatigue = 0; this.tension = 0.1; this.tensionTarget = 0.1;
    this.focus = 1; this.focusActive = false; this.focusLock = 0; this.focusDebt = 0; this.focusMul = 1;
    this.adsTime = 0;
    this.history = new Float32Array(160); this.histI = 0; this.histT = 0;
    this.breath = 0; this.breathLabel = 'EXHALE';
    this.swayYaw = 0; this.swayPitch = 0;
    this.onHeartbeat = null; this.onFocusStart = null; this.onFocusEnd = null;
    this._lastBeat = 0;
  }
  addTension(v) { this.tension = clamp(this.tension + v, 0, 1); }

  update(dt, { ads, wantFocus, amp, triggerPull = 0, heat = 0, hip = 1 }) {
    this.t += dt;
    // fatigue: holding the aim tires the shooter; lowering recovers
    if (ads) { this.adsTime += dt; this.fatigue = clamp(this.fatigue + dt * (this.adsTime > 6 ? 0.045 : 0.012), 0, 1); }
    else { this.adsTime = Math.max(0, this.adsTime - dt * 3); this.fatigue = clamp(this.fatigue - dt * 0.09, 0, 1); }
    this.tension = damp(this.tension, this.tensionTarget, 0.25, dt);

    // focus gauge
    const canStart = this.focus > 0.15 && this.focusLock <= 0;
    if (wantFocus && (this.focusActive || canStart)) {
      if (!this.focusActive) { this.focusActive = true; this.onFocusStart && this.onFocusStart(); }
      this.focus -= dt / 4.2;
      if (this.focus <= 0) { this.focus = 0; this.endFocus(true); }
    } else if (this.focusActive) {
      this.endFocus(false);
    }
    if (!this.focusActive) {
      if (this.focusLock > 0) this.focusLock -= dt;
      else this.focus = clamp(this.focus + dt / 9, 0, 1);
    }
    this.focusDebt = Math.max(0, this.focusDebt - dt * 0.25);
    this.focusMul = damp(this.focusMul, this.focusActive ? 0.28 : 1 + this.focusDebt * 0.6, this.focusActive ? 6 : 2.5, dt);

    // breathing: rate rises with fatigue/tension/debt; held during focus
    const rateTarget = this.focusActive ? 0.0 : 0.19 + this.fatigue * 0.12 + this.tension * 0.08 + this.focusDebt * 0.2;
    this.breathRate = damp(this.breathRate, rateTarget, 3, dt);
    const ampTarget = this.focusActive ? 0.12 : 1 + this.fatigue * 0.7 + this.focusDebt * 0.8;
    this.breathAmp = damp(this.breathAmp, ampTarget, this.focusActive ? 4 : 1.2, dt);
    this.breathPhase += dt * Math.PI * 2 * this.breathRate * (1 + noise1(this.t * 0.11) * 0.12);
    // asymmetric curve: quicker inhale, longer exhale with a natural pause
    const ph = this.breathPhase % (Math.PI * 2);
    const raw = Math.sin(ph - Math.sin(ph) * 0.45);
    this.breath = raw * this.breathAmp;
    const d = Math.cos(ph - Math.sin(ph) * 0.45);
    this.breathLabel = this.focusActive ? 'HOLD' : d > 0.15 ? 'INHALE' : d < -0.15 ? 'EXHALE' : 'PAUSE';

    // heartbeat
    const bpmTarget = 66 + this.tension * 34 + this.fatigue * 22 + this.focusDebt * 18 - (this.focusActive ? 6 : 0);
    this.bpm = damp(this.bpm, bpmTarget, 0.6, dt);
    this.heartPhase += dt * this.bpm / 60;
    const f = this.heartPhase % 1;
    const lub = Math.exp(-Math.pow((f - 0.02) / 0.035, 2));
    const dub = 0.55 * Math.exp(-Math.pow((f - 0.2) / 0.04, 2));
    this.pulse = lub + dub;
    if (Math.floor(this.heartPhase) !== this._lastBeat) { this._lastBeat = Math.floor(this.heartPhase); this.onHeartbeat && this.onHeartbeat(this); }

    // sway (degrees)
    const A = amp * this.focusMul * (1 + this.fatigue * 0.9 + heat) * hip * (1 + triggerPull * 0.6);
    const t = this.t;
    const wanderY = noise1(t * 0.31 + 11) * 0.55 + noise1(t * 0.87 + 3) * 0.28 + noise1(t * 2.3) * 0.1 * (1 + this.tension);
    const wanderP = noise1(t * 0.27 + 47) * 0.4 + noise1(t * 0.93 + 9) * 0.22 + noise1(t * 2.1 + 5) * 0.1 * (1 + this.tension);
    const heartAmp = (0.12 + this.tension * 0.12 + this.focusDebt * 0.1) * (this.focusActive ? 0.6 : 1);
    this.swayYaw = A * (wanderY + this.pulse * heartAmp * 0.35);
    this.swayPitch = A * (this.breath * 0.75 + wanderP + this.pulse * heartAmp);

    // waveform history (~30 Hz)
    this.histT += dt;
    if (this.histT > 1 / 30) {
      this.histT = 0;
      this.history[this.histI] = this.breath / 1.8 + this.pulse * 0.08;
      this.histI = (this.histI + 1) % this.history.length;
    }
  }
  endFocus(exhausted) {
    this.focusActive = false;
    this.focusDebt = Math.min(1.5, this.focusDebt + (exhausted ? 1.0 : 0.35));
    if (exhausted) this.focusLock = 3.0;
    else this.focusLock = 0.6;
    this.onFocusEnd && this.onFocusEnd(exhausted);
  }
}
