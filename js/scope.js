// Picture-in-Picture optical scope: a second camera renders the magnified view into a
// render target; this full-screen pass composites it as a circular lens with
// tube, edge shadow (eye-box), barrel distortion, chromatic fringe, coating reflection,
// reticle, and a blurred/darkened periphery from the main camera.
import * as THREE from 'three';

export const ScopeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tScope: { value: null },
    mode: { value: 0 },          // 0 none, 1 diopter aperture, 2 optical scope
    amount: { value: 0 },        // 0..1 blend of the overlay
    aspect: { value: 1 },
    lensR: { value: 0.42 },      // in screen-height units
    tube: { value: 0.06 },
    eyeOff: { value: new THREE.Vector2() },
    lensOff: { value: new THREE.Vector2() },
    reticle: { value: 0 },       // 0 duplex 1 mildot 2 fine 3 dot
    retColor: { value: new THREE.Vector3(0, 0, 0) },
    retGlow: { value: 0 },
    retScale: { value: 1 },
    px: { value: 1 / 1080 },
    blurPx: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    focusVig: { value: 0 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform sampler2D tScope;
    uniform int mode; uniform float amount; uniform float aspect; uniform float lensR; uniform float tube;
    uniform vec2 eyeOff; uniform vec2 lensOff; uniform int reticle; uniform vec3 retColor; uniform float retGlow; uniform float retScale;
    uniform float px; uniform vec2 blurPx; uniform float focusVig; uniform float time;
    varying vec2 vUv;

    vec3 blurMain(vec2 uv, float r){
      vec3 c = vec3(0.0);
      c += texture2D(tDiffuse, uv).rgb * 0.2;
      for(int i=0;i<8;i++){
        float a = float(i)*0.785398;
        vec2 o = vec2(cos(a), sin(a)) * blurPx * r;
        c += texture2D(tDiffuse, uv + o).rgb * 0.07;
        c += texture2D(tDiffuse, uv + o*2.2).rgb * 0.03;
      }
      return c;
    }
    float lineAA(float d, float w){ return 1.0 - smoothstep(w - px, w + px, d); }

    // reticle coverage in lens coords q (-1..1)
    float reticleMask(vec2 q){
      float m = 0.0;
      float thin = 0.0016 * retScale, thick = 0.012 * retScale;
      if (reticle == 0) { // duplex
        float ax = abs(q.x), ay = abs(q.y);
        float inner = 0.28;
        m = max(m, lineAA(ay, ax < inner ? thin : thick) * step(0.0, 1.0));
        m = max(m, lineAA(ax, ay < inner ? thin : thick));
        m *= 1.0 - smoothstep(0.004, 0.006, 0.0) * 0.0;
      } else if (reticle == 1) { // mil-dot
        m = max(lineAA(abs(q.y), thin), lineAA(abs(q.x), thin));
        for (int i=1;i<=6;i++){
          float s = float(i) * 0.1;
          m = max(m, 1.0 - smoothstep(0.009 - px*2.0, 0.009 + px*2.0, length(q - vec2(s,0.0))));
          m = max(m, 1.0 - smoothstep(0.009 - px*2.0, 0.009 + px*2.0, length(q - vec2(-s,0.0))));
          m = max(m, 1.0 - smoothstep(0.009 - px*2.0, 0.009 + px*2.0, length(q - vec2(0.0,s))));
          m = max(m, 1.0 - smoothstep(0.009 - px*2.0, 0.009 + px*2.0, length(q - vec2(0.0,-s))));
        }
        float ax = abs(q.x), ay = abs(q.y);
        m = max(m, lineAA(ay, ax > 0.72 ? thick*0.8 : 0.0));
        m = max(m, lineAA(ax, ay > 0.72 ? thick*0.8 : 0.0));
      } else if (reticle == 2) { // fine cross + tiny dot
        float gap = 0.012;
        m = max(m, lineAA(abs(q.y), thin*0.7) * step(gap, abs(q.x)));
        m = max(m, lineAA(abs(q.x), thin*0.7) * step(gap, abs(q.y)));
        m = max(m, 1.0 - smoothstep(0.003, 0.003 + px*2.0, length(q)));
        float ax = abs(q.x), ay = abs(q.y);
        m = max(m, lineAA(ay, ax > 0.6 ? thick*0.6 : 0.0));
        m = max(m, lineAA(ax, ay > 0.6 ? thick*0.6 : 0.0));
      } else { // centre dot + circle
        m = max(m, 1.0 - smoothstep(0.012, 0.012 + px*3.0, length(q)));
        m = max(m, lineAA(abs(length(q) - 0.2), thin*0.8) * 0.8);
      }
      return clamp(m, 0.0, 1.0);
    }

    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
      if (mode == 0 || amount <= 0.001) {
        float v = focusVig * smoothstep(0.35, 0.95, length(p));
        gl_FragColor = vec4(base.rgb * (1.0 - v*0.55), base.a);
        return;
      }
      vec3 outc;
      if (mode == 1) {
        // diopter: small clear aperture, blurred dark rear-sight disc around it
        float d = length(p);
        float ap = lensR;
        float clearA = 1.0 - smoothstep(ap*0.92, ap, d);
        vec3 periph = blurMain(vUv, 14.0) * 0.035 + vec3(0.01);
        float rim = smoothstep(ap*0.9, ap*1.05, d) * (1.0 - smoothstep(ap*1.05, ap*1.4, d));
        periph += vec3(0.05) * rim;
        vec3 inside = base.rgb * (0.94 + 0.06 * (1.0 - d/ap));
        outc = mix(periph, inside, clearA);
      } else {
        vec2 lp = p - lensOff;
        float d = length(lp);
        float tubeR = lensR * (1.0 + tube);
        vec3 periph = blurMain(vUv, 10.0) * 0.28;
        // scope tube body (dark anodised ring with a hint of rim light)
        float ringT = smoothstep(lensR, tubeR, d);
        vec3 tubeCol = vec3(0.018, 0.019, 0.021) + vec3(0.06) * pow(max(0.0, dot(normalize(lp + 1e-5), normalize(vec2(-0.6, 0.8)))), 6.0) * (1.0 - ringT);
        float outsideTube = smoothstep(tubeR, tubeR + 3.0*px, d);
        vec3 col = mix(tubeCol, periph, outsideTube);
        // lens interior
        vec2 q = lp / lensR;
        float rr = dot(q, q);
        float k = 0.07;
        vec2 qd = q * (1.0 + k * rr) / (1.0 + k);
        vec2 suv = qd * 0.5 + 0.5;
        float ca = 0.006 * rr;
        vec3 sc;
        sc.r = texture2D(tScope, (qd * (1.0 + ca)) * 0.5 + 0.5).r;
        sc.g = texture2D(tScope, suv).g;
        sc.b = texture2D(tScope, (qd * (1.0 - ca)) * 0.5 + 0.5).b;
        // eye-box shadow: crescent that follows eye misalignment
        float sh = 1.0 - smoothstep(0.55, 1.02, length(q + eyeOff * 2.4));
        sh = mix(sh, 1.0, 0.0);
        sc *= sh;
        sc *= 1.0 - 0.35 * smoothstep(0.6, 1.0, sqrt(rr)); // internal vignette
        // coating tint + subtle reflection arc
        sc = mix(sc, sc * vec3(0.97, 1.0, 1.03), 0.6);
        float arc = smoothstep(0.08, 0.0, abs(length(q - vec2(-0.25, 0.3)) - 0.9)) * smoothstep(-0.2, 0.6, q.y - q.x * 0.3);
        sc += vec3(0.55, 0.62, 0.75) * arc * 0.035;
        sc += vec3(0.3, 0.35, 0.45) * 0.015 * (1.0 - smoothstep(0.0, 0.35, length(q - vec2(0.42, 0.48))));
        // reticle
        float rm = reticleMask(q);
        vec3 rc = mix(retColor, retColor * 2.4, retGlow);
        sc = mix(sc, rc, rm);
        if (retGlow > 0.0) sc += retColor * retGlow * 0.4 * (1.0 - smoothstep(0.0, 0.03, length(q))) ;
        float inside = 1.0 - smoothstep(1.0 - 2.0*px/lensR, 1.0, sqrt(rr));
        outc = mix(col, sc, inside);
      }
      float v = focusVig * smoothstep(0.35, 0.95, length(p));
      outc *= 1.0 - v * 0.55;
      gl_FragColor = vec4(mix(base.rgb, outc, amount), base.a);
    }
  `,
};

// Angular half-FOV the scope camera must cover for magnification `mag`, matching the
// lens circle's size on screen (so 1× shows exactly what the naked eye would).
export function scopeFov(mainFovDeg, lensR, mag) {
  const t = Math.tan((mainFovDeg * Math.PI / 180) / 2);
  const half = Math.atan((lensR / 0.5) * t / mag);
  return (half * 2) * 180 / Math.PI;
}

export const RETICLE_INDEX = { duplex: 0, mildot: 1, fine: 2, dot: 3 };
export const RETICLE_RGB = { black: [0.01, 0.01, 0.01], red: [0.9, 0.06, 0.03], green: [0.15, 0.85, 0.2] };
