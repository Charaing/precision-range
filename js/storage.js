// Persistent records in IndexedDB (falls back to localStorage if IDB is unavailable).
const DB = 'precision-range', VER = 1;
let dbp = null;

function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no idb'));
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('matches')) db.createObjectStore('matches', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((res, rej) => {
    const t = db.transaction(store, mode); const s = t.objectStore(store);
    let out; const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
  }));
}
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('pr_' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pr_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export function emptyStats() {
  return { totalShots: 0, totalHits: 0, totalTens: 0, totalInner: 0, matches: 0, playTime: 0, perWeapon: {}, perMode: {}, personalBest: {} };
}

export const Store = {
  async getStats() {
    try { const r = await tx('kv', 'readonly', (s) => s.get('stats')); return r ? r.value : emptyStats(); }
    catch { return LS.get('stats', emptyStats()); }
  },
  async setStats(v) {
    try { await tx('kv', 'readwrite', (s) => s.put({ key: 'stats', value: v })); }
    catch { LS.set('stats', v); }
  },
  async addMatch(m) {
    try { return await tx('matches', 'readwrite', (s) => s.add(m)); }
    catch { const a = LS.get('matches', []); m.id = Date.now(); a.push(m); LS.set('matches', a.slice(-60)); return m.id; }
  },
  async getMatches(limit = 30) {
    let all;
    try { all = await tx('matches', 'readonly', (s) => s.getAll()); }
    catch { all = LS.get('matches', []); }
    return (all || []).sort((a, b) => b.date - a.date).slice(0, limit);
  },
  async getMatch(id) {
    try { return await tx('matches', 'readonly', (s) => s.get(id)); }
    catch { return LS.get('matches', []).find((m) => m.id === id); }
  },
  async clearAll() {
    try { await tx('matches', 'readwrite', (s) => s.clear()); await tx('kv', 'readwrite', (s) => s.clear()); } catch { /* ignore */ }
    LS.set('matches', []); LS.set('stats', emptyStats());
  },
  // Record a finished match and fold it into the aggregate stats. Returns {prevBest, prevAvg, isPB}
  async record(match) {
    const st = await this.getStats();
    const key = `${match.weapon}|${match.mode}`;
    const prevBest = st.personalBest[key] ?? null;
    const pm = st.perMode[match.mode] || { count: 0, sum: 0, best: 0 };
    const prevAvg = pm.count ? pm.sum / pm.count : null;
    const hits = match.shots.filter((s) => s.score > 0).length;
    st.totalShots += match.shots.length; st.totalHits += hits;
    st.totalTens += match.shots.filter((s) => s.score === 10).length;
    st.totalInner += match.shots.filter((s) => s.inner).length;
    st.matches += 1; st.playTime += match.duration;
    const pw = st.perWeapon[match.weapon] || { shots: 0, hits: 0, playTime: 0, matches: 0, best: {}, inner: 0 };
    pw.shots += match.shots.length; pw.hits += hits; pw.playTime += match.duration; pw.matches += 1;
    pw.inner = (pw.inner || 0) + match.shots.filter((s) => s.inner).length;
    if (match.mode !== 'free') pw.best[match.mode] = Math.max(pw.best[match.mode] ?? 0, match.total);
    st.perWeapon[match.weapon] = pw;
    if (match.mode !== 'free') {
      pm.count += 1; pm.sum += match.total; pm.best = Math.max(pm.best, match.total);
      st.perMode[match.mode] = pm;
      if (prevBest === null || match.total > prevBest) st.personalBest[key] = match.total;
    }
    await this.setStats(st);
    match.id = await this.addMatch(match);
    return { prevBest, prevAvg, isPB: match.mode !== 'free' && (prevBest === null || match.total > prevBest) };
  },
};

export const Settings = {
  defaults: {
    quality: 'high', fov: 72, sens: 1.0, adsSens: 0.8, invertY: false, adsToggle: true, shake: 1.0,
    crosshair: true, showBody: true,
    master: 0.8, weapon: 0.85, ambient: 0.6, reverb: 0.7, ui: 0.6, heartbeatSound: true,
  },
  load() { return { ...this.defaults, ...LS.get('settings', {}) }; },
  save(s) { LS.set('settings', s); },
  loadLoadouts() { return LS.get('loadouts', {}); },
  saveLoadouts(l) { LS.set('loadouts', l); },
  loadLast() { return LS.get('last', null); },
  saveLast(v) { LS.set('last', v); },
};
