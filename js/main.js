// PRECISION RANGE — bootstrap
import { UI } from './ui.js';
import { Game, analyze } from './game.js';
import { scoreHit } from './target.js';

async function boot() {
  const ui = new UI();
  let game;
  try {
    game = new Game(document.getElementById('gl'), ui, ui.settings);
  } catch (e) {
    document.getElementById('loadText').textContent = 'WEBGL UNAVAILABLE · ' + e.message;
    throw e;
  }
  ui.bind(game);
  game.audio.setVolumes({ master: ui.settings.master, weapon: ui.settings.weapon, ambient: ui.settings.ambient, reverb: ui.settings.reverb, ui: ui.settings.ui });
  const last = ui.sel;
  await game.showMenuBackground(last.range === 'mountain' ? 'outdoor' : last.range, last.tod);
  game.loop();
  ui.setLoading(false);
  ui.showScreen('menu');
  // unlock audio on the first interaction anywhere
  const unlock = () => { game.audio.init(); window.removeEventListener('pointerdown', unlock); };
  window.addEventListener('pointerdown', unlock);

  // Test / debug surface (used for automated verification)
  window.PR = {
    game, ui, analyze, scoreHit,
    selfTest() {
      const R = 1; const w = R / 10; const out = [];
      const cases = [[0, 0, 0, 10], [w * 0.99, 0, 0, 10], [w * 1.01, 0, 0, 9], [w * 1.01, 0, 0.02, 10], [w * 5.5, 0, 0, 5], [R * 0.999, 0, 0, 1], [R * 1.01, 0, 0, 0], [0, -w * 9.5, 0, 1], [w * 3.5 / Math.SQRT2, w * 3.5 / Math.SQRT2, 0, 7]];
      for (const [x, y, hr, exp] of cases) { const r = scoreHit(x, y, R, hr); out.push({ x, y, hr, exp, got: r.score, dec: r.dec, ok: r.score === exp }); }
      return { pass: out.every((o) => o.ok), out };
    },
  };
}
boot();
