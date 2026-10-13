// Voice to code on synthesized voices: a beatbox take (boom / chik / ts) and a hummed tune with vibrato,
// sung a little flat and a little off the beat. Run: node tests/voice.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console, Math, Float32Array, Float64Array, Array, Set, Object };
vm.createContext(ctx);
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8');
vm.runInContext(src('engine.js').replace("if (typeof module !== 'undefined') module.exports", 'if (false) module.exports') + '\n;this.SCALES = SCALES;', ctx);
vm.runInContext(src('vxdsp.js').replace("if (typeof module !== 'undefined') module.exports", 'if (false) module.exports') + '\n;this.vx = { vxBeat, vxHum, vxPattern, vxNotch };', ctx);
const { vxBeat, vxHum, vxPattern, vxNotch } = ctx.vx;
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const sr = 48000, bpm = 100, barSec = 240 / bpm, pre = 0.12, bars = 2;
const buf = () => new Float32Array(Math.ceil((pre + bars * barSec + 0.2) * sr));
const noise = (x, i0, dur, amp, hp, lp) => { let a = 0, b = 0; for (let i = 0; i < dur * sr && i0 + i < x.length; i++) { const w = rnd() * 2 - 1; a += (w - a) * lp; b += (a - b) * hp; const env = Math.exp(-i / (sr * dur * 0.25)); x[i0 + i] += (a - b) * amp * env; } };
// a mouth kick: a falling low thump with a little click; a snare "chik": mid-high noise; a hat "ts": very high, short noise
const kick = (x, i0) => { let ph = 0; for (let i = 0; i < 0.16 * sr; i++) { const f = 70 + 120 * Math.exp(-i / (sr * 0.02)); ph += 2 * Math.PI * f / sr; x[i0 + i] += Math.sin(ph) * 0.6 * Math.exp(-i / (sr * 0.05)); } noise(x, i0, 0.01, 0.15, 0.3, 0.5); };
const snare = (x, i0) => noise(x, i0, 0.12, 0.5, 0.25, 0.6);
const hat = (x, i0) => noise(x, i0, 0.04, 0.35, 0.85, 0.95);
const click = (x) => { for (let b = -4; b < bars * 4; b++) { const i0 = Math.round((pre + b * barSec / 4 + 0.012) * sr); if (i0 < 0) continue; for (let i = 0; i < 0.012 * sr; i++) x[i0 + i] += Math.sin(2 * Math.PI * 3800 * i / sr) * 0.25 * Math.exp(-i / (sr * 0.003)); } };
const at = step => Math.round((pre + step * barSec / 16 + (rnd() - 0.5) * 0.03) * sr);   // ±15 ms of human timing

let fail = 0;
const check = (name, got, want) => { const ok = got === want; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got}${ok ? '' : `  (want ${want})`}`); };

// 1. kick, snare and hat
{
  const x = buf();
  // boom ts chik ts | boom ts chik ts boom boom chik ts: a beatboxer alternates, so hats sit between the other hits
  const K = [0, 8, 16, 22, 24], Sn = [4, 12, 20, 28], H = [2, 6, 10, 14, 18, 26, 30];
  K.forEach(s => kick(x, at(s))); Sn.forEach(s => snare(x, at(s))); H.forEach(s => hat(x, at(s)));
  for (let i = 0; i < x.length; i++) x[i] += (rnd() - 0.5) * 0.002;
  click(x);
  const r = vxBeat(vxNotch(x, sr, 3800), sr, barSec, bars, pre);
  const want = (steps) => { const g = Array(32).fill('.'); steps.forEach(s => g[s] = 'x'); return vxPattern(g, bars, false); };
  for (const [k, st] of [['kick', K], ['snare', Sn], ['hat', H]]) check('beatbox ' + k, r.lines[k] ? vxPattern(r.lines[k], bars, false) : '(none)', want(st));
}
// 2. just "tuk chik tuk chik": two sounds become kick and snare
{
  const x = buf();
  [0, 8, 16, 24].forEach(s => kick(x, at(s))); [4, 12, 20, 28].forEach(s => snare(x, at(s)));
  const r = vxBeat(x, sr, barSec, bars, pre);
  check('two sounds kick', r.lines.kick && vxPattern(r.lines.kick, bars, false), 'x x');
  check('two sounds snare', r.lines.snare && vxPattern(r.lines.snare, bars, false), '. x . x');
}
// 3. a hummed tune in A minor, sung 30 cents flat, with vibrato and soft note edges, one octave low
{
  const x = buf(), notes = [[0, 2, 57], [2, 1, 60], [3, 1, 64], [4, 3, 62], [8, 2, 60], [10, 1, 59], [11, 1, 57], [12, 4, 57]];   // [8th, length, midi]
  let ph = 0;
  for (const [s, len, m] of notes) {
    const i0 = Math.round((pre + s * barSec / 8 + (rnd() - 0.5) * 0.02) * sr), n = Math.round((len * barSec / 8 - 0.05) * sr);
    for (let i = 0; i < n; i++) {
      const f = 440 * 2 ** ((m - 12 - 69 - 0.3) / 12) * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * i / sr));
      ph += 2 * Math.PI * f / sr;
      const env = Math.min(1, i / (sr * 0.03), (n - i) / (sr * 0.03));
      x[i0 + i] += 0.3 * env * (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph));
    }
  }
  for (let i = 0; i < x.length; i++) x[i] += (rnd() - 0.5) * 0.002;
  const r = vxHum(x, sr, barSec, bars, pre, { root: 9, scale: 'minor' });
  check('hum melody', vxPattern(r.tokens, bars, true), '<[a4 _ c5 e5 d5 _ _ .] [c5 _ b4 a4 a4 _ _ _]>');
  check('hum tuning found', (Math.round(r.tune * 10) / 10).toFixed(1), '-0.3');
  check('hum moved up two octaves (sung low)', String(r.shift), '24');
}
console.log(fail ? `${fail} failed` : 'voice: all passed');
process.exit(fail ? 1 : 0);
