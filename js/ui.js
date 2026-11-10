// Menus, armory 3D preview, HUD, results analysis and records screens.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WEAPONS, OPTICS, RETICLES, RETICLE_COLORS, FINISHES, STOCKS, weaponById, buildWeaponModel, makeMaterials } from './weapons.js';
import { RANGES, TIME_LABELS } from './ranges.js';
import { MODES, analyze } from './game.js';
import { drawMonitor } from './target.js';
import { Store, Settings } from './storage.js';
import { fmtTime, clamp } from './util.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// ---------- rotating 3D weapon preview (own renderer) ----------
class Preview {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.5;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
    const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(-1, 2, 1.5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xe3a948, 1.2); rim.position.set(1.5, 0.5, -2); this.scene.add(rim);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
    this.holder = new THREE.Group(); this.scene.add(this.holder);
    this.rotY = -0.9; this.rotX = 0.12; this.dist = 1.6; this.auto = true; this.active = false;
    const c = this.canvas;
    let drag = false, lx = 0, ly = 0;
    c.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; this.auto = false; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => { if (!drag) return; this.rotY += (e.clientX - lx) * 0.01; this.rotX = clamp(this.rotX + (e.clientY - ly) * 0.006, -0.8, 0.8); lx = e.clientX; ly = e.clientY; });
    c.addEventListener('pointerup', () => { drag = false; setTimeout(() => (this.auto = true), 2500); });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = clamp((this.zoom || 1) * (e.deltaY > 0 ? 1.08 : 0.93), 0.45, 1.8); }, { passive: false });
    this.zoom = 1;
    const loop = () => { requestAnimationFrame(loop); if (this.active) this.render(); };
    loop();
  }
  attach(slot) { slot.appendChild(this.canvas); this.slot = slot; this.active = true; this.resize(); }
  detach() { this.active = false; }
  resize() {
    if (!this.slot) return;
    const w = this.slot.clientWidth, h = this.slot.clientHeight;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  show(def, loadout) {
    if (this.model) { this.holder.remove(this.model); this.model.traverse((o) => o.geometry && o.geometry.dispose()); }
    const M = makeMaterials(loadout.finish, loadout.stock);
    const built = buildWeaponModel(def, loadout, M, { hands: false });
    this.model = built.root;
    const box = new THREE.Box3().setFromObject(this.model); const ctr = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
    this.model.position.sub(ctr);
    this.dist = Math.max(size.x, size.y, size.z) * 1.9 + 0.1;
    this.holder.add(this.model);
  }
  render() {
    if (this.slot && (this.canvas.width !== Math.floor(this.slot.clientWidth * this.renderer.getPixelRatio()))) this.resize();
    if (this.auto) this.rotY += 0.004;
    const d = this.dist * this.zoom;
    this.camera.position.set(Math.sin(this.rotY) * Math.cos(this.rotX) * d, Math.sin(this.rotX) * d, Math.cos(this.rotY) * Math.cos(this.rotX) * d);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }
}

export class UI {
  constructor() {
    this.store = Store;
    this.settings = Settings.load();
    this.loadouts = Settings.loadLoadouts();
    const last = Settings.loadLast() || {};
    this.sel = { mode: last.mode || 'match10', range: last.range || 'indoor', tod: last.tod || 'day', distIdx: last.distIdx || 0, weapon: last.weapon || 'p10' };
    this.armSel = this.sel.weapon;
    this.screen = 'loading';
    this.preview = null;
    this.cmTimer = null;
    this.monitorCv = $('#monitor'); this.breathCv = $('#breathCv');
  }
  bind(game) {
    this.game = game;
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { game.audio.init(); game.audio.ui('click'); this.showScreen(b.dataset.go); }));
    document.querySelectorAll('button').forEach((b) => b.addEventListener('mouseenter', () => game.audio.ui('hover')));
    $('#startBtn').addEventListener('click', () => this.start());
    $('#pResume').addEventListener('click', () => game.resume());
    $('#pRestart').addEventListener('click', () => game.restart());
    $('#pEnd').addEventListener('click', () => game.endSessionEarly());
    $('#pQuit').addEventListener('click', () => game.quitToMenu());
    $('#pSettings').addEventListener('click', () => { this.settingsReturn = 'pause'; this.showScreen('settings'); });
    $('#settingsBack').addEventListener('click', () => { const r = this.settingsReturn || 'menu'; this.settingsReturn = null; this.showScreen(r); });
    $('#resMenu').addEventListener('click', () => { game.quitToMenu(); });
    $('#resRetry').addEventListener('click', () => { if (this.resultsFromRecords) { this.showScreen('records'); return; } game.restart(); });
    $('#rpPrev').addEventListener('click', () => this.replayStep(-1));
    $('#rpNext').addEventListener('click', () => this.replayStep(1));
    $('#rpPlay').addEventListener('click', () => this.replayPlay());
  }
  loadoutFor(id) {
    const def = weaponById(id);
    const l = this.loadouts[id] || {};
    const optic = def.optics.includes(l.optic) ? l.optic : def.optics[0];
    const o = OPTICS[optic];
    const reticle = o.reticles ? (o.reticles.includes(l.reticle) ? l.reticle : o.reticles[0]) : 'duplex';
    return { optic, reticle, retColor: l.retColor || (optic === 'rd1' ? 'red' : 'black'), finish: l.finish || (def.cls === 'pistol' ? 'graphite' : id === 'r10' ? 'royal' : 'graphite'), stock: l.stock || (id === 'x1' ? 'synthetic' : id === 'r20' ? 'synthetic' : 'walnut') };
  }
  saveLoadout(id, l) { this.loadouts[id] = l; Settings.saveLoadouts(this.loadouts); }

  showScreen(name) {
    const prev = this.screen;
    this.screen = name;
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    const node = $('#' + name); if (node) node.classList.add('show');
    if (this.preview) this.preview.detach();
    if (name === 'menu') { this.renderMenu(); if (this.game && this.game.state !== 'menu' && this.game.state !== 'boot') { /* handled by game */ } }
    if (name === 'setup') this.renderSetup();
    if (name === 'armory') this.renderArmory();
    if (name === 'records') this.renderRecords();
    if (name === 'settings') this.renderSettings();
    if (name === 'hud') { $('#hudBody').style.display = this.settings.showBody ? '' : 'none'; }
    if (name === 'pause') { /* overlay over hud */ $('#hud').classList.add('show'); }
    return prev;
  }
  setLoading(on, text) {
    $('#loading').classList.toggle('show', on);
    if (text) $('#loadText').textContent = 'LOADING · ' + text;
  }
  toast(msg, kind = '') {
    const t = el('div', 'toast ' + kind, msg); $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 2700);
  }
  centerMsg(a, b = '', dur = 1.6) {
    const n = $('#centerMsg'); n.querySelector('.cm-a').textContent = a; n.querySelector('.cm-b').textContent = b;
    n.classList.add('show'); clearTimeout(this.cmTimer);
    this.cmTimer = setTimeout(() => n.classList.remove('show'), dur * 1000);
  }
  hitPop(shot) {
    const n = $('#hitpop');
    n.className = 'hitpop';
    void n.offsetWidth;
    if (!shot) { n.textContent = 'MISS'; n.classList.add('show', 'miss'); return; }
    n.textContent = shot.score === 0 ? 'MISS · 0' : `${shot.dec.toFixed(1)}${shot.inner ? '  ✕' : ''}`;
    n.classList.add('show'); if (shot.score === 10) n.classList.add('ten'); if (shot.score === 0) n.classList.add('miss');
    $('#hudLast').textContent = shot.reaction != null ? `+${shot.dec.toFixed(1)} · ${shot.reaction.toFixed(2)}s` : `+${shot.dec.toFixed(1)}`;
  }

  // ---------- menu ----------
  async renderMenu() {
    const st = await Store.getStats();
    const pb = st.personalBest || {};
    const m10 = Object.entries(pb).filter(([k]) => k.endsWith('|match10')).map(([, v]) => v);
    $('#menuPB').textContent = st.matches ? `MATCHES ${st.matches} · SHOTS ${st.totalShots} · BEST 10-SHOT ${m10.length ? Math.max(...m10) : '—'}` : 'NO RECORDS YET · 첫 경기를 시작하세요';
  }

  // ---------- setup ----------
  renderSetup() {
    const S = this.sel;
    const ml = $('#modeList'); ml.innerHTML = '';
    Object.values(MODES).forEach((m) => {
      const b = el('button', 'item' + (S.mode === m.id ? ' sel' : ''), `<div class="t">${m.name}</div><div class="k">${m.kr}</div><div class="d">${m.desc}</div>`);
      b.onclick = () => { S.mode = m.id; if (m.range) S.range = m.range; this.game.audio.ui('click'); this.renderSetup(); };
      ml.appendChild(b);
    });
    const forced = MODES[S.mode].range;
    if (forced) S.range = forced;
    const rl = $('#rangeList'); rl.innerHTML = '';
    RANGES.forEach((r) => {
      const b = el('button', 'item' + (S.range === r.id ? ' sel' : ''), `<div class="t">${r.name}</div><div class="k">${r.kr}</div><div class="d">${r.desc}</div><div class="r">${r.distances[0]}–${r.distances[r.distances.length - 1]}M</div>`);
      if (forced && forced !== r.id) { b.disabled = true; b.style.opacity = 0.35; }
      b.onclick = () => { S.range = r.id; S.distIdx = 0; if (!r.times.includes(S.tod)) S.tod = r.times[0]; this.game.audio.ui('click'); this.renderSetup(); };
      rl.appendChild(b);
    });
    const R = RANGES.find((r) => r.id === S.range);
    if (!R.times.includes(S.tod)) S.tod = R.times[0];
    const tc = $('#todChips'); tc.innerHTML = '';
    R.times.forEach((t) => { const c = el('button', 'chip' + (S.tod === t ? ' sel' : ''), TIME_LABELS[t]); c.onclick = () => { S.tod = t; this.renderSetup(); }; tc.appendChild(c); });
    const dc = $('#distChips'); dc.innerHTML = '';
    const varDist = S.mode === 'long' || S.mode === 'random';
    R.distances.forEach((d, i) => { const c = el('button', 'chip' + (!varDist && S.distIdx === i ? ' sel' : ''), `${d} M`); c.disabled = varDist; c.onclick = () => { S.distIdx = i; this.renderSetup(); }; dc.appendChild(c); });
    if (varDist) dc.appendChild(el('span', 'dim', S.mode === 'long' ? '&nbsp;단계별 자동 증가' : '&nbsp;무작위 거리'));
    // weapons
    const wt = $('#weaponTabs'); wt.innerHTML = '';
    WEAPONS.forEach((w) => { const t = el('button', 'tab' + (S.weapon === w.id ? ' sel' : ''), w.name); t.onclick = () => { S.weapon = w.id; this.game.audio.ui('click'); this.renderSetup(); }; wt.appendChild(t); });
    this.renderLoadout($('#setupLoadout'), S.weapon, () => this.renderSetup());
    this.ensurePreview($('#setupPreviewSlot'), S.weapon);
    const lo = this.loadoutFor(S.weapon), W = weaponById(S.weapon);
    $('#setupSummary').innerHTML = `<b>${MODES[S.mode].name}</b> · ${R.name} · ${TIME_LABELS[S.tod]} · ${varDist ? 'VAR' : R.distances[S.distIdx] + ' M'}<br><b>${W.name}</b> · ${OPTICS[lo.optic].name} · ${FINISHES[lo.finish].name}`;
  }
  ensurePreview(slot, weaponId) {
    if (!this.preview) this.preview = new Preview();
    this.preview.attach(slot);
    slot.dataset.label = weaponById(weaponId).name + ' · DRAG TO ROTATE';
    const lo = this.loadoutFor(weaponId);
    const key = weaponId + JSON.stringify(lo);
    if (this.previewKey !== key) { this.previewKey = key; this.preview.show(weaponById(weaponId), lo); }
  }
  renderLoadout(node, weaponId, rerender) {
    const def = weaponById(weaponId), lo = this.loadoutFor(weaponId);
    node.innerHTML = '';
    const row = (label, items, cur, set) => {
      node.appendChild(el('div', 'lbl', label));
      const c = el('div', 'chips');
      Object.entries(items).forEach(([k, v]) => { const b = el('button', 'chip' + (cur === k ? ' sel' : ''), v); b.onclick = () => { set(k); this.saveLoadout(weaponId, lo); this.game.audio.ui('click'); rerender(); }; c.appendChild(b); });
      node.appendChild(c);
    };
    const optics = {}; def.optics.forEach((o) => (optics[o] = OPTICS[o].name));
    row('OPTIC', optics, lo.optic, (v) => { lo.optic = v; const o = OPTICS[v]; if (o.reticles && !o.reticles.includes(lo.reticle)) lo.reticle = o.reticles[0]; });
    const o = OPTICS[lo.optic];
    if (o.type === 'scope') {
      node.appendChild(el('div', 'lbl', 'MAGNIFICATION'));
      node.appendChild(el('div', 'dim', o.mags.map((m) => m + '×').join(' · ') + (o.mags.length > 1 ? ' &nbsp;(마우스 휠)' : '')));
      const r = {}; o.reticles.forEach((k) => (r[k] = RETICLES[k]));
      row('RETICLE', r, lo.reticle, (v) => (lo.reticle = v));
      row('ILLUMINATION', RETICLE_COLORS, lo.retColor, (v) => (lo.retColor = v));
    } else {
      node.appendChild(el('div', 'lbl', 'SIGHT'));
      node.appendChild(el('div', 'dim kr', o.type === 'diopter' ? '디옵터 후방 조준구 + 링 인서트 글로브 가늠쇠' : '노치형 가늠자 + 블레이드 가늠쇠'));
    }
    const fin = {}; Object.entries(FINISHES).forEach(([k, v]) => (fin[k] = v.name));
    row('FINISH', fin, lo.finish, (v) => (lo.finish = v));
    const stk = {}; Object.entries(STOCKS).forEach(([k, v]) => (stk[k] = v.name));
    row(def.cls === 'pistol' ? 'GRIP' : 'STOCK', stk, lo.stock, (v) => (lo.stock = v));
  }
  start() {
    const S = this.sel;
    Settings.saveLast(S);
    const lo = this.loadoutFor(S.weapon);
    this.game.startSession({ mode: S.mode, range: S.range, tod: S.tod, distIdx: S.distIdx, weapon: S.weapon, ...lo });
  }

  // ---------- armory ----------
  renderArmory() {
    const list = $('#armoryList'); list.innerHTML = '';
    WEAPONS.forEach((w) => {
      const b = el('button', 'item' + (this.armSel === w.id ? ' sel' : ''), `<div class="t">${w.name}</div><div class="k">${w.kr}</div>`);
      b.onclick = () => { this.armSel = w.id; this.game.audio.ui('click'); this.renderArmory(); };
      list.appendChild(b);
    });
    const W = weaponById(this.armSel);
    $('#armName').textContent = W.name;
    $('#armDesc').textContent = W.desc;
    const st = $('#armStats'); st.innerHTML = '';
    const bars = [['DIFFICULTY', W.stats.difficulty, true], ['AIM STABILITY', W.stats.stability], ['RECOIL', W.stats.recoil, true], ['HANDLING', W.stats.speed]];
    bars.forEach(([n, v, hard]) => {
      const r = el('div', 'stat' + (hard ? ' hard' : ''), `<span>${n}</span><div class="bar">${Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</div><b>${v}</b>`);
      st.appendChild(r);
    });
    const actions = { semi: 'SEMI-AUTO', revolver: 'DOUBLE ACTION', single: 'SINGLE SHOT', bolt: 'BOLT ACTION' };
    $('#armSpec').innerHTML = [
      ['CLASS', W.cls === 'pistol' ? 'SPORT PISTOL' : 'SPORT RIFLE'], ['ACTION', actions[W.action]], ['CAPACITY', W.mag + ' RDS'],
      ['OPTICS', W.optics.map((o) => OPTICS[o].name.split(' ')[0]).join(' / ')], ['TARGET FACE', W.faceStyle.toUpperCase()],
    ].map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('');
    this.renderLoadout($('#armLoadout'), this.armSel, () => this.renderArmory());
    this.ensurePreview($('#armoryPreviewSlot'), this.armSel);
  }

  // ---------- records ----------
  async renderRecords() {
    const st = await Store.getStats();
    const acc = st.totalShots ? (st.totalHits / st.totalShots * 100).toFixed(1) : '0.0';
    $('#recTiles').innerHTML = [
      ['MATCHES', st.matches], ['TOTAL SHOTS', st.totalShots], ['HITS', st.totalHits], ['ACCURACY', acc + '<small>%</small>'],
      ['CENTER (X)', st.totalInner || 0], ['PLAY TIME', fmtTime(st.playTime)],
    ].map(([l, v]) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
    const modes = ['match10', 'match30', 'timed', 'long', 'random'];
    let html = `<tr><th>WEAPON</th>${modes.map((m) => `<th>${MODES[m].name.split(' ')[0]}</th>`).join('')}<th>SHOTS</th><th>X</th><th>TIME</th></tr>`;
    WEAPONS.forEach((w) => {
      const pw = st.perWeapon[w.id];
      html += `<tr><td>${w.name}</td>${modes.map((m) => `<td>${pw && pw.best[m] != null ? pw.best[m] : '—'}</td>`).join('')}<td>${pw ? pw.shots : 0}</td><td>${pw ? pw.inner || 0 : 0}</td><td>${pw ? fmtTime(pw.playTime) : '00:00'}</td></tr>`;
    });
    html += `<tr><td style="color:var(--dim)">AVG / MODE</td>${modes.map((m) => { const pm = st.perMode[m]; return `<td style="color:var(--dim)">${pm && pm.count ? (pm.sum / pm.count).toFixed(1) : '—'}</td>`; }).join('')}<td></td><td></td><td></td></tr>`;
    $('#recWeapons').innerHTML = html;
    const recent = await Store.getMatches(25);
    const box = $('#recRecent'); box.innerHTML = '';
    if (!recent.length) box.appendChild(el('div', 'empty', '아직 기록이 없습니다. START RANGE에서 첫 경기를 시작하세요.'));
    recent.forEach((m) => {
      const r = el('button', 'rrow', `<div class="a">${MODES[m.mode]?.name || m.mode} · ${weaponById(m.weapon)?.name || m.weapon}</div><div class="b">${new Date(m.date).toLocaleString()} · ${RANGES.find((x) => x.id === m.range)?.name || ''} · ${m.shots.length} SHOTS</div><div class="s">${m.total}</div>`);
      r.onclick = () => { this.resultsFromRecords = true; this.showResults(m, analyze(m.shots), null); };
      box.appendChild(r);
    });
  }

  // ---------- settings ----------
  renderSettings() {
    const s = this.settings, body = $('#settingsBody'); body.innerHTML = '';
    const g = this.game;
    const col = (title) => { const c = el('section'); c.appendChild(el('h3', '', title)); body.appendChild(c); return c; };
    const save = () => { Settings.save(s); g.settings = s; g.audio.setVolumes({ master: s.master, weapon: s.weapon, ambient: s.ambient, reverb: s.reverb, ui: s.ui }); };
    const slider = (c, key, label, sub, min, max, step, fmt = (v) => v) => {
      const r = el('div', 'set-row', `<div class="n">${label}<small>${sub}</small></div><div class="val">${fmt(s[key])}</div>`);
      const i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = s[key];
      i.oninput = () => { s[key] = parseFloat(i.value); r.querySelector('.val').textContent = fmt(s[key]); save(); if (key === 'fov') g.resize(); };
      r.appendChild(i); c.appendChild(r);
    };
    const toggle = (c, key, label, sub) => {
      const r = el('div', 'set-row', `<div class="n">${label}<small>${sub}</small></div>`);
      const t = el('button', 'toggle' + (s[key] ? ' on' : '')); t.onclick = () => { s[key] = !s[key]; t.classList.toggle('on', s[key]); save(); g.audio.ui('click'); };
      r.appendChild(t); c.appendChild(r);
    };
    const c1 = col('GRAPHICS');
    const qr = el('div', 'set-row', `<div class="n">QUALITY<small>낮음 / 보통 / 높음 / 최고 — 텍스처 해상도는 다음 사격장 로드 시 적용</small></div>`);
    const qc = el('div', 'chips'); qc.style.gridColumn = '1 / -1';
    [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']].forEach(([k, n]) => {
      const b = el('button', 'chip' + (s.quality === k ? ' sel' : ''), n);
      b.onclick = () => { s.quality = k; save(); g.applyQuality(); this.renderSettings(); };
      qc.appendChild(b);
    });
    qr.appendChild(qc); c1.appendChild(qr);
    const qd = { low: '그림자 끔 · 0.75x 해상도 · FXAA', medium: '그림자 1K · FXAA · 스코프 768', high: '부드러운 그림자 2K · MSAA · 블룸 · 스코프 1024', ultra: '그림자 4K · MSAA · 블룸 · 주변광 차폐(SAO) · 스코프 1536' };
    c1.appendChild(el('div', 'dim kr', qd[s.quality])).style.padding = '10px 0';
    slider(c1, 'fov', 'FIELD OF VIEW', '수직 시야각 (도)', 50, 80, 1, (v) => v + '°');
    toggle(c1, 'crosshair', 'HIP CROSSHAIR', '비조준 시 중앙 점 표시');
    toggle(c1, 'showBody', 'BODY HUD', '호흡 · 심박 · 집중도 표시');
    const c2 = col('CONTROLS');
    slider(c2, 'sens', 'MOUSE SENSITIVITY', '일반 시점 감도', 0.1, 3, 0.05, (v) => v.toFixed(2));
    slider(c2, 'adsSens', 'ADS SENSITIVITY', '조준/스코프 시점 감도 (배율에 맞춰 자동 보정)', 0.1, 2, 0.05, (v) => v.toFixed(2));
    toggle(c2, 'invertY', 'INVERT Y', '상하 반전');
    toggle(c2, 'adsToggle', 'ADS TOGGLE', '켜짐: 우클릭으로 전환 · 꺼짐: 누르는 동안 조준');
    slider(c2, 'shake', 'SCREEN SHAKE', '발사 시 카메라 충격 강도', 0, 1.5, 0.05, (v) => Math.round(v * 100) + '%');
    const c3 = col('AUDIO');
    slider(c3, 'master', 'MASTER', '전체 볼륨', 0, 1, 0.01, (v) => Math.round(v * 100));
    slider(c3, 'weapon', 'WEAPON', '발사음 · 기계음', 0, 1, 0.01, (v) => Math.round(v * 100));
    slider(c3, 'reverb', 'REVERB', '실내 반사음 · 야외 메아리', 0, 1, 0.01, (v) => Math.round(v * 100));
    slider(c3, 'ambient', 'AMBIENT', '환경음 · 관중 · 바람', 0, 1, 0.01, (v) => Math.round(v * 100));
    slider(c3, 'ui', 'INTERFACE', 'UI · 점수 발표음', 0, 1, 0.01, (v) => Math.round(v * 100));
    toggle(c3, 'heartbeatSound', 'HEARTBEAT', '조준 중 심장 박동음');
    const rst = el('button', 'danger', 'RESET ALL RECORDS');
    rst.onclick = async () => { if (confirm('모든 기록을 삭제할까요? 되돌릴 수 없습니다.')) { await Store.clearAll(); this.toast('RECORDS CLEARED'); } };
    c3.appendChild(rst);
    $('#fpsInfo').textContent = `${Math.round(g.fps)} FPS · ${g.renderer.capabilities.isWebGL2 ? 'WEBGL2' : 'WEBGL'}`;
  }

  // ---------- HUD ----------
  onSessionStart(game) {
    this.resultsFromRecords = false;
    const W = game.weapon;
    $('#hudWeapon').textContent = `${W.name} · ${game.optic.name}`;
    $('#ammoMax').textContent = '/' + W.mag;
    $('#hudMode').textContent = MODES[game.session.mode].name;
    $('#hudLast').textContent = '';
    $('#crosshair').style.display = this.settings.crosshair ? '' : 'none';
    this.drawMonitor([], W.faceStyle);
  }
  updateHUD(g) {
    const S = g.session; if (!S) return;
    const total = S.shots.reduce((a, s) => a + s.score, 0), dec = S.shots.reduce((a, s) => a + s.dec, 0);
    $('#hudTotal').textContent = total; $('#hudDec').textContent = dec.toFixed(1);
    let prog = '';
    if (S.mode === 'free') prog = `SHOTS ${S.shots.length} · SERIES ${S.seriesNo}`;
    else if (S.mode === 'timed') prog = `SHOTS ${S.shots.length}`;
    else if (S.mode === 'long') prog = `STAGE ${Math.min(5, S.stage + 1)}/5 · SHOT ${S.shots.length}/10`;
    else if (S.mode === 'random') prog = `TARGET ${Math.min(S.popIdx, S.def.shots)}/${S.def.shots}`;
    else prog = `SHOT ${String(S.shots.length).padStart(2, '0')}/${S.def.shots}`;
    $('#hudProg').textContent = prog;
    $('#hudTime').textContent = S.mode === 'timed' ? (S.phase === 'ready' ? '01:00' : fmtTime(S.timeLeft)) : fmtTime(S.elapsed);
    $('#ammoNum').textContent = g.reloading ? '··' : g.ammo;
    const pips = $('#ammoPips');
    if (pips.childElementCount !== g.weapon.mag) pips.innerHTML = Array.from({ length: g.weapon.mag }, () => '<i></i>').join('');
    [...pips.children].forEach((p, i) => p.classList.toggle('off', i >= g.ammo));
    $('#hudMag').textContent = g.optic.type === 'scope' ? `${g.curMag.toFixed(1)}×` : g.optic.type === 'diopter' ? 'DIOPTER' : 'IRON';
    $('#hudDist').textContent = S.popActive ? `${Math.round(S.popActive.t.distance)} M` : `${S.distance} M`;
    $('#monSeries').textContent = S.mode === 'random' ? 'POP-UP' : `SERIES ${S.seriesNo}`;
    $('#monDist').textContent = $('#hudDist').textContent;
    $('#crosshair').style.opacity = this.settings.crosshair ? String(Math.max(0, 1 - g.ads * 2.5)) : '0';
    $('#engage').classList.toggle('show', !g.locked && !g.freeMouse && g.state === 'playing');
  }
  drawBody(b) {
    if (!this.settings.showBody) return;
    const c = this.breathCv, x = c.getContext('2d'), w = c.width, h = c.height;
    x.clearRect(0, 0, w, h);
    x.strokeStyle = 'rgba(255,255,255,0.08)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
    x.strokeStyle = b.focusActive ? '#e3a948' : 'rgba(232,233,235,0.9)'; x.lineWidth = 2.4; x.beginPath();
    const n = b.history.length;
    for (let i = 0; i < n; i++) {
      const v = b.history[(b.histI + i) % n];
      const px = i / (n - 1) * w, py = h / 2 - v * h * 0.42;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.stroke();
    $('#breathLabel').textContent = b.breathLabel;
    $('#bpm').textContent = Math.round(b.bpm);
    $('#heart').style.transform = `scale(${1 + b.pulse * 0.35})`;
    $('#fatigue').textContent = `FATIGUE ${Math.round(b.fatigue * 100)}%`;
    const fb = $('#focusFill'); fb.style.width = (b.focus * 100).toFixed(1) + '%';
    const bar = fb.parentElement; bar.classList.toggle('active', b.focusActive); bar.classList.toggle('lock', b.focusLock > 0 && !b.focusActive && b.focus < 0.15);
    $('#focusState').textContent = b.focusActive ? 'ACTIVE' : (b.focusLock > 0 && b.focus < 0.15) ? 'RECOVERING' : b.focus < 0.15 ? 'LOW' : 'READY [SHIFT]';
  }
  drawMonitor(shots, style) {
    drawMonitor(this.monitorCv.getContext('2d'), this.monitorCv.width, shots, { style, markLast: true });
  }

  // ---------- results ----------
  showResults(match, a, cmp) {
    this.showScreen('results');
    this.resMatch = match; this.resA = a; this.rpIdx = -1;
    $('#resRetry').innerHTML = this.resultsFromRecords ? 'BACK <span>←</span>' : 'RETRY <span>↻</span>';
    const W = weaponById(match.weapon), R = RANGES.find((r) => r.id === match.range);
    $('#resMeta').textContent = `${MODES[match.mode].name} · ${W.name} · ${R?.name || ''} · ${new Date(match.date).toLocaleString()}`;
    $('#resTotal').textContent = a.total;
    $('#resTotalDec').textContent = a.totalDec.toFixed(1);
    $('#resPB').textContent = cmp && cmp.isPB ? 'PERSONAL BEST' : '';
    const clock = (x, y) => { if (!x && !y) return '—'; const ang = Math.atan2(x, y); let h = Math.round(((ang / (Math.PI * 2)) * 12 + 12) % 12); if (h === 0) h = 12; return `${h}시 방향`; };
    $('#resTiles').innerHTML = [
      ['AVERAGE', a.avgDec.toFixed(2)], ['BEST SHOT', a.best.toFixed(1)], ['CENTER X', a.inner + '<small>/' + a.n + '</small>'],
      ['TENS', a.tens], ['10 STREAK', a.streak10], [a.reaction != null ? 'AVG REACTION' : 'GROUP SIZE', a.reaction != null ? a.reaction.toFixed(2) + '<small>s</small>' : a.spread.toFixed(1) + '<small>rings</small>'],
      ['MISSES', a.misses], ['MPI OFFSET', (Math.hypot(a.mpi.x, a.mpi.y) * 10).toFixed(1) + '<small>rings</small>'], ['MPI DIR', clock(a.mpi.x, a.mpi.y)],
    ].map(([l, v]) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
    // comparison
    let cmpHtml = '';
    if (cmp) {
      if (match.mode === 'free') cmpHtml = '자유 사격 세션 — 총 사격 통계에 반영되었습니다.';
      else {
        const pb = cmp.prevBest, av = cmp.prevAvg;
        const d1 = pb != null ? a.total - pb : null, d2 = av != null ? a.total - av : null;
        cmpHtml = `PREVIOUS BEST <b>${pb ?? '—'}</b> ${d1 != null ? `<span class="${d1 >= 0 ? 'cmp-up' : 'cmp-down'}">${d1 >= 0 ? '+' : ''}${d1}</span>` : ''} &nbsp;·&nbsp; MODE AVERAGE <b>${av != null ? av.toFixed(1) : '—'}</b> ${d2 != null ? `<span class="${d2 >= 0 ? 'cmp-up' : 'cmp-down'}">${d2 >= 0 ? '+' : ''}${d2.toFixed(1)}</span>` : ''}`;
      }
    } else cmpHtml = '저장된 경기 기록';
    $('#resCompare').innerHTML = cmpHtml;
    this.drawHist(a);
    const sl = $('#resShots'); sl.innerHTML = '';
    match.shots.forEach((s, i) => {
      const b = el('button', 'shot' + (s.score === 10 ? ' ten' : '') + (s.score === 0 ? ' miss' : ''), `<div class="i">#${i + 1}${s.inner ? ' · X' : ''}</div><div class="v">${s.score === 0 ? '0' : s.dec.toFixed(1)}<small>${s.reaction != null ? s.reaction.toFixed(2) + 's' : Math.round(s.dist) + 'm'}</small></div>`);
      b.onclick = () => { this.rpIdx = i; this.drawResultTarget(); };
      sl.appendChild(b);
    });
    this.drawResultTarget();
  }
  drawResultTarget(upTo = null) {
    const m = this.resMatch, c = $('#resTarget'), x = c.getContext('2d');
    const shots = upTo != null ? m.shots.slice(0, upTo + 1) : m.shots;
    // auto zoom so the group is readable
    const hits = m.shots.filter((s) => s.score > 0);
    const maxR = hits.length ? Math.max(...hits.map((s) => Math.hypot(s.x, s.y))) : 1;
    const zoom = clamp(0.92 / Math.max(maxR + 0.12, 0.35), 1, 2.6);
    drawMonitor(x, c.width, shots, { style: m.faceStyle, numbers: true, highlight: this.rpIdx, mpi: true, zoom });
    const sel = this.rpIdx;
    document.querySelectorAll('#resShots .shot').forEach((b, i) => b.classList.toggle('sel', i === sel));
    const s = m.shots[sel];
    $('#rpInfo').textContent = s ? `#${sel + 1} · ${s.score === 0 ? 'MISS' : s.dec.toFixed(1)} · ${s.t.toFixed(1)}s${s.inner ? ' · INNER 10' : ''}` : `ALL ${m.shots.length} SHOTS · ZOOM ${zoom.toFixed(1)}×`;
  }
  replayStep(d) {
    const n = this.resMatch.shots.length; if (!n) return;
    this.rpIdx = clamp((this.rpIdx < 0 ? (d > 0 ? -1 : n) : this.rpIdx) + d, 0, n - 1);
    this.drawResultTarget(this.rpIdx);
  }
  replayPlay() {
    clearInterval(this.rpTimer);
    const n = this.resMatch.shots.length; if (!n) return;
    this.rpIdx = 0; this.drawResultTarget(0);
    this.rpTimer = setInterval(() => {
      if (this.screen !== 'results') return clearInterval(this.rpTimer);
      if (this.rpIdx >= n - 1) { clearInterval(this.rpTimer); return; }
      this.rpIdx++; this.drawResultTarget(this.rpIdx); this.game.audio.ui('beep');
    }, 650);
  }
  drawHist(a) {
    const c = $('#resHist'), x = c.getContext('2d'), w = c.width, h = c.height;
    x.clearRect(0, 0, w, h);
    const mx = Math.max(1, ...a.hist); const bw = w / 11;
    x.font = '500 20px "JetBrains Mono", monospace'; x.textAlign = 'center';
    for (let i = 0; i <= 10; i++) {
      const v = a.hist[i], bh = (h - 56) * v / mx;
      x.fillStyle = i === 10 ? '#e3a948' : i === 0 ? '#e0665a' : 'rgba(232,233,235,0.75)';
      x.fillRect(i * bw + bw * 0.18, h - 30 - bh, bw * 0.64, bh);
      x.fillStyle = '#858b92'; x.fillText(String(i), i * bw + bw / 2, h - 6);
      if (v) { x.fillStyle = '#e8e9eb'; x.fillText(String(v), i * bw + bw / 2, h - 38 - bh); }
    }
    x.strokeStyle = 'rgba(255,255,255,0.1)'; x.beginPath(); x.moveTo(0, h - 29.5); x.lineTo(w, h - 29.5); x.stroke();
  }
}
