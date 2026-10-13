// Sound match on made-up notes whose settings are known: does it find the shape, the filter and the envelopes?
// Run: node tests/match.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console, Math, Float32Array, Float64Array, Array, Set, Object, String };
vm.createContext(ctx);
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8').replace("if (typeof module !== 'undefined') module.exports", 'if (false) module.exports');
for (const f of ['vxdsp.js', 'wavetables.js', 'match.js']) vm.runInContext(src(f), ctx);
vm.runInContext('this.sm = { smAnalyze, smFit };', ctx);
const { smAnalyze, smFit } = ctx.sm;
const sr = 48000;
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
// a test note: oscillator → 12 dB low-pass (cut may move) → ADSR, 1.2 s, held for 0.9 s
function note({ f = 110, shape = 'saw', cut = 20000, cutAt = null, q = 0.7, atk = 0.01, dec = 0.3, sus = 0.6, rel = 0.15, vib = 0, bend = 0, bendT = 0.015, noise = 0, hold = 0.9, len = 1.3 }) {
  const x = new Float32Array(Math.round(len * sr)); let ph = 0, s1 = 0, s2 = 0, amp = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    const fi = f * Math.pow(2, (bend * Math.exp(-t / bendT)) / 12 + vib / 1200 * Math.sin(2 * Math.PI * 5.5 * t));
    ph += fi / sr; ph -= Math.floor(ph);
    let o = 0;
    if (shape === 'saw') for (let n = 1; n * fi < sr / 2; n++) o += Math.sin(2 * Math.PI * n * ph) / n * (n % 2 ? 1 : -1);
    else if (shape === 'square') for (let n = 1; n * fi < sr / 2; n += 2) o += Math.sin(2 * Math.PI * n * ph) / n;
    else o = Math.sin(2 * Math.PI * ph);
    o += noise * (rnd() * 2 - 1);
    const fc = cutAt ? cutAt(t) : cut, g = Math.tan(Math.PI * Math.min(fc, sr * 0.45) / sr), k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, v3 = o - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
    s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
    if (t < hold) amp = t < atk ? t / atk : sus + (1 - sus) * Math.exp(-(t - atk) / (dec / 3)); else amp *= Math.exp(-1 / (rel / 4 * sr));
    x[i] = v2 * amp * 0.3;
  }
  return x;
}
let fail = 0;
const check = (name, ok, got) => { if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got}`); };
const fit = x => smFit(smAnalyze(x, sr));

{ const r = fit(note({ f: 110, cut: 900 }));
  check('saw through 900 Hz: a saw-like frame', r.P.table === 'basic' && r.P.scan > 0.5 && r.P.scan < 0.85 || r.P.table === 'sync' && r.P.scan < 0.1, `${r.P.table} ${r.P.scan}`);
  const fc = r.P.cut * Math.pow(110 / 261.6, 0.3); check('  cutoff near 900 Hz', fc > 900 / 1.7 && fc < 900 * 1.7, Math.round(fc));
  check('  sustain near .6', Math.abs(r.P.sus - 0.6) < 0.15, r.P.sus); check('  quick attack', r.P.atk < 0.03, r.P.atk);
  check('  the note', r.note, r.note); }
{ const r = fit(note({ f: 220, shape: 'square', sus: 0, dec: 0.5, hold: 1.2 }));
  const odd = r.P.table === 'basic' && r.P.scan > 0.85 || r.P.table === 'pwm' && r.P.scan < 0.15;
  check('square pluck: an odd-harmonic frame', odd, `${r.P.table} ${r.P.scan}`); check('  no sustain (a pluck)', r.P.sus === 0, r.P.sus); check('  decay near .5', r.P.dec > 0.25 && r.P.dec < 1, r.P.dec); }
{ const r = fit(note({ f: 440, shape: 'sine', vib: 22 }));
  check('sine with vibrato: a sine-like frame', r.P.table === 'basic' && r.P.scan < 0.2 || r.P.cut * Math.pow(440 / 261.6, 0.3) < 600, `${r.P.table} ${r.P.scan} cut ${r.P.cut}`); check('  vibrato found', r.P.vib >= 10 && r.P.vib <= 50, r.P.vib); }
{ const r = fit(note({ f: 110, cut: 2500, bend: 12, bendT: 0.02 }));
  check('saw falling an octave into the note: pitch envelope', r.P.penv >= 5 && r.P.penv <= 14, r.P.penv); }
{ const r = fit(note({ f: 110, cut: 3000, noise: 0.35 }));
  check('saw with noise: noise found', r.P.noise > 0.05, r.P.noise); }
{ const r = fit(note({ f: 110, cutAt: t => 400 + 4000 * Math.exp(-t / 0.06), sus: 0.7 }));
  check('filter pluck: filter envelope found', r.P.env > 0.1, `env ${r.P.env} fdec ${r.P.fdec}`); }
{ const r = smAnalyze(new Float32Array(sr), sr); check('silence says so', !r.ok && r.why === 'quiet', r.why); }
{ const x = new Float32Array(sr); for (let i = 0; i < x.length; i++) x[i] = (rnd() * 2 - 1) * 0.3 * Math.exp(-i / (sr * 0.2)); const r = smAnalyze(x, sr); check('noise burst has no pitch', !r.ok && r.why === 'pitch', r.why); }
{ const r = fit(note({ f: 110, cut: 900 })); check('the line compiles', /^match  a2 /.test(r.code), r.code); }
console.log(fail ? `match: ${fail} failed` : 'match: all passed');
process.exitCode = fail ? 1 : 0;
