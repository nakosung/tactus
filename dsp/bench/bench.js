// Same workload through the JavaScript worklet code and the Rust/WASM module:
// 16 ringing strings, a 16th-note acid line and an off-beat mono bass, rendered in 128-sample blocks.
const fs = require('fs'), path = require('path');
const SR = 48000, SECS = +(process.argv[2] || 60), BLOCK = 128;
// --- JS voice, straight from synth.js ---
const src = fs.readFileSync(path.join(__dirname, '../../src/js/synth.js'), 'utf8');
const code = /const SYN_CODE = `([\s\S]*?)`;/.exec(src)[1];
globalThis.sampleRate = SR; globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
let Syn; globalThis.registerProcessor = (n, c) => { if (n === 'pulse-synth') Syn = c; };
new Function(code)();
// --- events ---
function events() {
  const ev = [], step = Math.round(SR * 60 / 132 / 4);
  const acidNotes = [45, 45, 52, 45, 48, 45, 46, 45, 45, 52, 45, 55, 45, 46, 45, 48];
  for (let k = 0, f = 0; f < SR * SECS; k++, f += step) {
    ev.push({ kind: 'acid', frame: f, dur: step - 200, f: 440 * Math.pow(2, (acidNotes[k % 16] - 69) / 12), slide: k % 4 === 2, acc: k % 8 === 0, cut: 400 + 300 * Math.sin(k / 9), res: 14, env: 0.9, dec: 0.14, gain: 0.3, wave: 0, drive: 0.2 });
    // a mono bass line on the off-sixteenths, gliding, with the sub in every other bar
    if (k % 2 === 1) ev.push({ kind: 'mono', frame: f + 37, dur: step - 300, f: 440 * Math.pow(2, (acidNotes[(k * 3) % 16] - 81) / 12), cut: 600 + 250 * Math.sin(k / 7), kt: 0.8, res: 1.6 + (k % 5), env: 0.65, dec: 0.15, atk: 0.003, sus: 0.4, rel: 0.05, gain: 0.3, wave: (k % 7) / 6, sub: (k >> 4) % 2 ? 0.5 : 0, det: 1.004, drive: 0.25, glide: k % 3 === 0 ? 0.06 : 0 });
    if (k % 2 === 0) ev.push({ kind: 'ks', frame: f, dur: step * 2, f: 220 * Math.pow(2, ((k * 5) % 24) / 12), gain: 0.4, pan: Math.sin(k), bright: 0.6, t60: 4, vib: k % 3 ? 0 : 14 });
  }
  return ev;
}
function runJS(only) {
  const p = new Syn(); const ev = events().filter(e => !only || e.kind === only);
  for (const e of ev) p.q.push(e);
  const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK), out = new Float32Array(SR * SECS);
  const t0 = process.hrtime.bigint();
  for (let f = 0; f + BLOCK <= SR * SECS; f += BLOCK) { globalThis.currentFrame = f; p.process([], [[L, R]]); out.set(L, f); }
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, out };
}
function runWasm(only) {
  const m = new WebAssembly.Module(fs.readFileSync(path.join(__dirname, '../tactus_dsp.wasm')));
  const x = new WebAssembly.Instance(m, {}).exports;
  x.init(SR, 12345);
  const ev = events().filter(e => !only || e.kind === only);
  const out = new Float32Array(SR * SECS);
  const oL = new Float32Array(x.memory.buffer, x.out_l(), BLOCK);
  let q = 0;
  const t0 = process.hrtime.bigint();
  for (let f = 0; f + BLOCK <= SR * SECS; f += BLOCK) {
    let pos = 0;
    while (pos < BLOCK) {
      let next = BLOCK;
      if (q < ev.length) next = Math.max(pos, Math.min(BLOCK, ev[q].frame - f));
      if (next > pos) { x.render(next - pos); out.set(oL.subarray(0, next - pos), f + pos); pos = next; }
      while (q < ev.length && ev[q].frame <= f + pos) {
        const e = ev[q++];
        if (e.kind === 'ks') x.ks_on(e.f, e.gain, e.pan, e.bright, e.t60, e.vib, e.dur);
        else if (e.kind === 'mono') x.mono_on(e.f, e.dur, e.cut, e.kt, e.res, e.env, e.dec, e.atk, e.sus, e.rel, e.gain, e.wave, e.sub, e.det, e.drive, e.glide);
        else x.acid_on(e.f, e.dur, +e.slide, +e.acc, e.cut, e.res, e.env, e.dec, e.gain, e.wave, e.drive);
      }
    }
  }
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, out };
}
const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
// warm up both JITs, then measure the best of three
const best = f => { f(); return [f(), f(), f()].sort((a, b) => a.ms - b.ms)[0]; };
const js = best(() => runJS()), wa = best(() => runWasm());
console.log(`audio ${SECS}s · JS ${js.ms.toFixed(0)} ms (${(SECS * 1000 / js.ms).toFixed(0)}x realtime) · WASM ${wa.ms.toFixed(0)} ms (${(SECS * 1000 / wa.ms).toFixed(0)}x realtime) · speed-up ${(js.ms / wa.ms).toFixed(2)}x`);
console.log(`rms JS ${rms(js.out).toFixed(4)} · WASM ${rms(wa.out).toFixed(4)}`);
// the acid voice has no randomness, so the two must match sample for sample
const aj = runJS('acid').out, aw = runWasm('acid').out;
let err = 0; for (let i = 0; i < aj.length; i++) err = Math.max(err, Math.abs(aj[i] - aw[i]));
let pk = 0; for (let i = 0; i < aj.length; i++) pk = Math.max(pk, Math.abs(aj[i]));
console.log(`acid max abs difference ${err.toExponential(2)} (peak ${pk.toFixed(3)})`);
// so has the mono bass
{ const mj = runJS('mono').out, mw = runWasm('mono').out; let e2 = 0, p2 = 0; for (let i = 0; i < mj.length; i++) { e2 = Math.max(e2, Math.abs(mj[i] - mw[i])); p2 = Math.max(p2, Math.abs(mj[i])); } console.log(`mono max abs difference ${e2.toExponential(2)} (peak ${p2.toFixed(3)})`); }
for (const k of ["ks", "acid", "mono"]) { const a = best(() => runJS(k)), b = best(() => runWasm(k)); console.log(k, "JS", a.ms.toFixed(0), "WASM", b.ms.toFixed(0)); }
