// Drum separation on a made-up loop whose parts are known: are the stems the drums and the rest, do they add up to
// the loop, and is the beat written down where it was played?
// Run: node tests/sep.test.js
const { sepSplit, sepBeats } = require('../src/js/sep.js');
const sr = 44100, bpm = 120, barSec = 240 / bpm, bars = 2, N = Math.round(barSec * bars * sr), stepN = barSec / 16 * sr;
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 * 2 - 1;
const drums = [new Float32Array(N), new Float32Array(N)], rest = [new Float32Array(N), new Float32Array(N)];
const KICK = [0, 8, 10, 16, 24, 27], SNARE = [4, 12, 20, 28], HAT = []; for (let s = 0; s < 32; s += 2) HAT.push(s);
function add(ch, at, fn, len) { const a = Math.round(at); for (let i = 0; i < len && a + i < N; i++) { const v = fn(i / sr, i); ch[0][a + i] += v; ch[1][a + i] += v; } }
// kick: a falling sine; snare: a tone and noise; hat: a short bright noise (a first difference of noise)
for (const s of KICK) { let ph = 0; add(drums, s * stepN, t => { ph += 2 * Math.PI * (50 + 90 * Math.exp(-t * 30)) / sr; return 0.8 * Math.sin(ph) * Math.exp(-t * 9); }, sr * 0.4); }
for (const s of SNARE) add(drums, s * stepN, t => (0.25 * Math.sin(2 * Math.PI * 190 * t) + 0.35 * rnd()) * Math.exp(-t * 18), sr * 0.25);
for (const s of HAT) { let p = 0; add(drums, s * stepN, t => { const n = rnd(), v = n - p; p = n; return 0.18 * v * Math.exp(-t * 60); }, sr * 0.08); }
// the rest: a bass line and held chords, changing every half bar
const roots = [45, 45, 41, 43], chords = [[57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
for (let h = 0; h < 4; h++) {
  const a = h * barSec / 2 * sr, len = barSec / 2 * sr - 200, f = m => 440 * Math.pow(2, (m - 69) / 12);
  add(rest, a, (t, i) => 0.35 * Math.sin(2 * Math.PI * f(roots[h]) * t) * Math.min(1, i / 200, (len - i) / 400), len);
  for (const m of chords[h]) add(rest, a, (t, i) => { let v = 0; for (let k = 1; k < 8; k++) v += Math.sin(2 * Math.PI * f(m) * k * t) / k; return 0.06 * v * Math.min(1, i / 400, (len - i) / 400); }, len);
}
const L = new Float32Array(N), R = new Float32Array(N); for (let i = 0; i < N; i++) { L[i] = drums[0][i] + rest[0][i]; R[i] = drums[1][i] + rest[1][i]; }
const t0 = Date.now(), out = sepSplit(L, R, sr), ms = Date.now() - t0;
const sdr = (ref, est) => { let s = 0, e = 0; for (let i = 0; i < ref.length; i++) { s += ref[i] * ref[i]; e += (ref[i] - est[i]) ** 2; } return 10 * Math.log10(s / e); };
let fail = 0; const check = (name, ok, got) => { if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got}`); };
let rec = 0; for (let i = 0; i < N; i++) rec = Math.max(rec, Math.abs(out.drums[0][i] + out.rest[0][i] - L[i]));
check('the stems add up to the loop', rec < 1e-3, rec.toExponential(2));
const sd = sdr(drums[0], out.drums[0]), sh = sdr(rest[0], out.rest[0]), base = sdr(drums[0], L);
check('drums stem is mostly drums (9 dB cleaner than the loop)', sd > 4.5 && sd > base + 8, `${sd.toFixed(1)} dB (the loop itself: ${base.toFixed(1)} dB)`);
check('rest stem is mostly the rest', sh > 6, `${sh.toFixed(1)} dB`);
const b = sepBeats(out.spec, bars, barSec);
const steps = k => new Set((b.lines[k] || []).map((v, i) => v !== '.' ? i : -1).filter(i => i >= 0));
for (const [k, truth] of [['kick', KICK], ['snare', SNARE], ['hat', HAT]]) {
  const got = steps(k), tp = truth.filter(s => got.has(s)).length, fp = [...got].filter(s => !truth.includes(s)).length;
  check(`${k} written where it was played`, tp >= truth.length - 1 && fp <= 1, `${tp}/${truth.length} found, ${fp} extra · ${(b.lines[k] || []).join('')}`);
}
console.log(`time ${ms} ms for ${(N / sr).toFixed(1)} s of stereo`);
console.log(fail ? `sep: ${fail} failed` : 'sep: all passed');
process.exitCode = fail ? 1 : 0;
