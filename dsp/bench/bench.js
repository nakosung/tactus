// Same workload through the JavaScript worklet code and the Rust/WASM module:
// 16 ringing strings, a 16th-note acid line and an off-beat mono bass, rendered in 128-sample blocks.
const fs = require('fs'), path = require('path');
const SR = 48000, SECS = +(process.argv[2] || 60), BLOCK = 128;
// --- JS voice, straight from synth.js ---
const src = fs.readFileSync(path.join(__dirname, '../../src/js/synth.js'), 'utf8');
const code = /const SYN_CODE = `([\s\S]*?)`;/.exec(src)[1];
globalThis.sampleRate = SR; globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
let Syn, Live, Master, Speaker; globalThis.registerProcessor = (n, c) => { if (n === 'pulse-synth') Syn = c; if (n === 'tactus-live') Live = c; if (n === 'tactus-master') Master = c; if (n === 'tactus-speaker') Speaker = c; };
globalThis.currentTime = 0;
new Function(code)();
// the engine's wavetables, made by the same code the app uses
const WT = require('../../src/js/wavetables.js').wtBuild();
// engine notes: analog with sync and unison, wavetable with a scan lfo and vowel, FM with feedback, mono with glide
function vsP(over) {
  const p = new Float32Array(96);
  Object.assign(p, { 0: 110, 1: 0, 2: 0.25, 4: 0.005, 5: 0.3, 6: 0.6, 7: 0.2, 8: 900, 9: 0.8, 10: 1.5, 11: 0.5, 13: 0.2, 15: 1, 18: 0.05, 19: 1, 23: 0.5, 24: 1, 29: 2, 32: -1 });
  for (const k in over) p[k] = over[k];
  for (let u = 0; u < 7; u++) { const n = p[19], x = n > 1 ? u / (n - 1) - 0.5 : 0; p[46 + u] = Math.pow(2, 20 * x / 1200); p[53 + u] = Math.cos((x + 1) * Math.PI / 4) * Math.SQRT2 / Math.sqrt(n); p[60 + u] = Math.sin((x + 1) * Math.PI / 4) * Math.SQRT2 / Math.sqrt(n); }
  return p;
}
// --- events ---
function events() {
  const ev = [], step = Math.round(SR * 60 / 132 / 4), f0 = k => k * step + 11;
  const acidNotes = [45, 45, 52, 45, 48, 45, 46, 45, 45, 52, 45, 55, 45, 46, 45, 48];
  for (let k = 0, f = 0; f < SR * SECS; k++, f += step) {
    ev.push({ kind: 'acid', frame: f, dur: step - 200, f: 440 * Math.pow(2, (acidNotes[k % 16] - 69) / 12), slide: k % 4 === 2, acc: k % 8 === 0, cut: 400 + 300 * Math.sin(k / 9), res: 14, env: 0.9, dec: 0.14, gain: 0.3, wave: 0, drive: 0.2 });
    // a mono bass line on the off-sixteenths, gliding, with the sub in every other bar
    if (k % 2 === 1) ev.push({ kind: 'mono', frame: f + 37, dur: step - 300, f: 440 * Math.pow(2, (acidNotes[(k * 3) % 16] - 81) / 12), cut: 600 + 250 * Math.sin(k / 7), kt: 0.8, res: 1.6 + (k % 5), env: 0.65, dec: 0.15, atk: 0.003, sus: 0.4, rel: 0.05, gain: 0.3, wave: (k % 7) / 6, sub: (k >> 4) % 2 ? 0.5 : 0, det: 1.004, drive: 0.25, glide: k % 3 === 0 ? 0.06 : 0 });
    if (k % 4 === 0) {
      const kind = (k >> 2) % 4, f = 440 * Math.pow(2, (acidNotes[k % 16] - 69) / 12);
      const over = [
        { 0: f, 1: 0, 19: 5, 24: 1 + (k % 3), 22: 0.3, 23: 0.3, 15: 2, 10: 3, 21: 0.1, 36: 1, 37: 2, 38: 0.25, 39: 1, 40: 400 },
        { 0: f * 2, 1: 1, 26: (k >> 4) % 8, 27: 0.4, 32: (k % 5), 36: 4, 37: 0.7, 38: 0, 39: 0, 40: 0.4, 41: 7, 42: 3, 43: 0.5, 44: 5, 45: 0.5 },
        { 0: f * 2, 1: 2, 28: 3, 29: 2, 30: 0.3, 31: 0.2, 15: 3, 8: 200, 17: 12, 18: 0.04 },
        { 0: f / 2, 1: 0, 33: 0.08, 34: 1, 20: 0.6, 15: 4, 8: 600, 16: 0.4, 12: 0.05, 14: 0.4 },
      ][kind];
      ev.push({ kind: 'vs', frame: f0(k), dur: step * 3, p: vsP(over) });
    }
    if (k % 2 === 0) ev.push({ kind: 'ks', frame: f, dur: step * 2, f: 220 * Math.pow(2, ((k * 5) % 24) / 12), gain: 0.4, pan: Math.sin(k), bright: 0.6, t60: 4, vib: k % 3 ? 0 : 14 });
  }
  return ev;
}
function runJS(only) {
  const p = new Syn(); p.vseed = 777; p.wt = WT; const ev = events().filter(e => !only || e.kind === only);
  for (const e of ev) p.q.push(e);
  const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK), out = new Float32Array(SR * SECS);
  const t0 = process.hrtime.bigint();
  for (let f = 0; f + BLOCK <= SR * SECS; f += BLOCK) { globalThis.currentFrame = f; p.process([], [[L, R]]); out.set(L, f); }
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, out };
}
function runWasm(only) {
  const m = new WebAssembly.Module(fs.readFileSync(path.join(__dirname, '../tactus_dsp.wasm')));
  const x = new WebAssembly.Instance(m, {}).exports;
  x.init(SR, 12345); x.vs_seed(777);
  new Float32Array(x.memory.buffer, x.wt_ptr(), x.wt_len()).set(WT);
  const pb = new Float32Array(x.memory.buffer, x.vs_params(), 96);
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
        else if (e.kind === 'vs') { pb.set(e.p); x.vs_on(e.dur); }
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
// and the engine (whose unison phases and noise come from the same seeded generator on both sides)
{ const mj = runJS('vs').out, mw = runWasm('vs').out; let e2 = 0, p2 = 0; for (let i = 0; i < mj.length; i++) { e2 = Math.max(e2, Math.abs(mj[i] - mw[i])); p2 = Math.max(p2, Math.abs(mj[i])); } console.log(`engine max abs difference ${e2.toExponential(2)} (peak ${p2.toFixed(3)})`); }
for (const k of ["ks", "acid", "mono", "vs"]) { const a = best(() => runJS(k)), b = best(() => runWasm(k)); console.log(k, "JS", a.ms.toFixed(0), "WASM", b.ms.toFixed(0)); }

// the live effects: a plucked guitar-like tone through every effect at once, with the song at 120 BPM, through the
// JavaScript class and through the module; the chain is deterministic, so the two must agree sample for sample
function fxSig(i) { const t = i / SR; let v = 0; for (let h = 1; h < 12; h++) v += Math.sin(2 * Math.PI * 196 * h * t) / h; return 0.2 * v * Math.exp(-((t % 0.75) * 2)); }
const FXP = { 0: -55, 1: 0.4, 2: 0.5, 3: 0.25, 4: 0.5, 5: 1, 6: 2, 7: -1, 8: 3, 9: -1, 10: 0.4, 11: 2, 12: 0.3, 13: 4, 14: 0.4, 15: 2, 16: 0.3, 17: 0.125,
  18: 0.3, 19: 0.1875, 20: 0.45, 21: 1, 22: 0.3, 23: 0.6, 24: 7, 25: 0.3, 26: 0.3, 27: 2, 28: 0.4, 29: 0, 30: 7, 31: 2741, 32: 1 };
function fxRun(useWasm, secs) {
  const N = SR * secs, out = new Float32Array(N * 2), inb = new Float32Array(BLOCK), cps = 120 / 240;
  let x, fx, pi, pl, pr, pp;
  if (useWasm) {
    x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(__dirname, '../tactus_dsp.wasm'))), {}).exports; x.fx_init(SR);
    pp = new Float32Array(x.memory.buffer, x.fx_params(), 48); for (const k in FXP) pp[k] = FXP[k];
    pi = new Float32Array(x.memory.buffer, x.fx_in(), BLOCK); pl = new Float32Array(x.memory.buffer, x.fx_out_l(), BLOCK); pr = new Float32Array(x.memory.buffer, x.fx_out_r(), BLOCK);
  } else { fx = new Live().fx; for (const k in FXP) fx.p[k] = FXP[k]; pl = new Float32Array(BLOCK); pr = new Float32Array(BLOCK); }
  const t0 = process.hrtime.bigint();
  for (let f = 0; f + BLOCK <= N; f += BLOCK) {
    for (let k = 0; k < BLOCK; k++) inb[k] = fxSig(f + k);
    const c = f * cps / SR;
    if (useWasm) { pi.set(inb); x.fx_process(BLOCK, c, cps); } else fx.process(inb, pl, pr, BLOCK, c, cps);
    for (let k = 0; k < BLOCK; k++) { out[2 * (f + k)] = pl[k]; out[2 * (f + k) + 1] = pr[k]; }
  }
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, out };
}
{
  const fs_ = Math.min(SECS, 10), a = fxRun(false, fs_), b = fxRun(true, fs_);
  let e = 0, pk = 0; for (let i = 0; i < a.out.length; i++) { e = Math.max(e, Math.abs(a.out[i] - b.out[i])); pk = Math.max(pk, Math.abs(a.out[i])); }
  console.log(`live effects max abs difference ${e.toExponential(2)} (peak ${pk.toFixed(3)}) · ${fs_}s, every effect on: JS ${a.ms.toFixed(0)} ms, WASM ${b.ms.toFixed(0)} ms (${(fs_ * 1000 / b.ms).toFixed(0)}x realtime)`);
}

// ---- the master and the speaker check ----
// A made-up mix (kick, snare, hats, a bass and chords, with a quiet verse and a loud chorus), through the mastering
// in JavaScript and in Rust; both must agree. Then the checks that matter: true peak (by 8x oversampling) under the
// ceiling, the loud part at the loudness target, the quiet part still quieter.
function mixSig(N) {
  const L = new Float32Array(N), R = new Float32Array(N), beat = SR * 60 / 124; let seed = 9, ph = 0, ph2 = 0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 * 2 - 1;
  for (let i = 0; i < N; i++) {
    const t = i / SR, b = i / beat, bp = b % 1, loud = Math.floor(t / 8) % 2 ? 1 : 0.35;
    let k = 0; if (bp < 0.3) { ph += 2 * Math.PI * (48 + 110 * Math.exp(-bp * beat / SR * 30)) / SR; k = 0.9 * Math.sin(ph) * Math.exp(-bp * beat / SR * 7); }
    const sb = (b + 1) % 2 - 1, sn = sb >= 0 && sb < 0.25 ? 0.35 * rnd() * Math.exp(-sb * beat / SR * 22) : 0;
    const hb = (b * 2) % 1, h = 0.12 * rnd() * Math.exp(-hb * beat / 2 / SR * 60);
    const root = [45, 41, 43, 40][Math.floor(b / 4) % 4], f = 440 * Math.pow(2, (root - 69) / 12);
    ph2 += f / SR; const bass = 0.35 * ((ph2 % 1) * 2 - 1);
    let ch = 0; for (const iv of [12, 15, 19]) ch += Math.sin(2 * Math.PI * f * Math.pow(2, iv / 12) * t) * 0.08;
    L[i] = (k + sn + h * 0.7 + bass + ch * 1.2) * 0.5 * loud; R[i] = (k + sn + h * 1.3 + bass + ch * 0.8) * 0.5 * loud;
  }
  return [L, R];
}
const MSP = { 0: 1, 1: 0.5, 2: -14, 3: -1, 4: 120, 5: 0, 6: 60 };
function mstRun(useWasm, L, R) {
  const N = L.length, oL = new Float32Array(N), oR = new Float32Array(N); let ms, x, io, m, blocks = [];
  if (useWasm) {
    x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(__dirname, '../tactus_dsp.wasm'))), {}).exports; x.mst_init(SR);
    const b = x.memory.buffer, pp = new Float32Array(b, x.mst_params(), 16); for (const k in MSP) pp[k] = MSP[k];
    io = [new Float32Array(b, x.mst_in_l(), BLOCK), new Float32Array(b, x.mst_in_r(), BLOCK), new Float32Array(b, x.mst_out_l(), BLOCK), new Float32Array(b, x.mst_out_r(), BLOCK)]; m = new Float32Array(b, x.mst_meter(), 16);
  } else { ms = new Master().ms; for (const k in MSP) ms.p[k] = MSP[k]; m = ms.m; }
  const tl = new Float32Array(BLOCK), tr = new Float32Array(BLOCK); let last = 0;
  const t0 = process.hrtime.bigint();
  for (let f = 0; f + BLOCK <= N; f += BLOCK) {
    if (useWasm) { io[0].set(L.subarray(f, f + BLOCK)); io[1].set(R.subarray(f, f + BLOCK)); x.mst_process(BLOCK); oL.set(io[2], f); oR.set(io[3], f); }
    else { ms.process(L.subarray(f, f + BLOCK), R.subarray(f, f + BLOCK), tl, tr, BLOCK); oL.set(tl, f); oR.set(tr, f); }
    if (m[11] !== last) { last = m[11]; blocks.push(m[0]); }
  }
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, oL, oR, blocks, auto: m[7] };
}
// true peak by 8x oversampling with a windowed sinc (a reference, not the cheap estimate the limiter uses)
function truePeak(x) {
  const O = 8, T = 32, h = []; for (let p = 0; p < O; p++) { const row = []; for (let j = -T; j <= T; j++) { const u = j - p / O; const w = 0.5 + 0.5 * Math.cos(Math.PI * u / (T + 1)); row.push(u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u) * w); } h.push(row); }
  let pk = 0;
  for (let i = T; i < x.length - T; i++) for (let p = 0; p < O; p++) { let s = 0; const row = h[p]; for (let j = -T; j <= T; j++) s += row[j + T] * x[i + j]; const a = Math.abs(s); if (a > pk) pk = a; }
  return pk;
}
const lufs = pw => -0.691 + 10 * Math.log10(pw + 1e-20);
{
  const secs = 32, [L, R] = mixSig(SR * secs), a = mstRun(false, L, R), b = mstRun(true, L, R);
  let e = 0, pk = 0; for (let i = 0; i < L.length; i++) { e = Math.max(e, Math.abs(a.oL[i] - b.oL[i]), Math.abs(a.oR[i] - b.oR[i])); pk = Math.max(pk, Math.abs(a.oL[i])); }
  console.log(`master max abs difference ${e.toExponential(2)} (peak ${pk.toFixed(3)}) · ${secs}s: JS ${a.ms.toFixed(0)} ms, WASM ${b.ms.toFixed(0)} ms (${(secs * 1000 / b.ms).toFixed(0)}x realtime)`);
  const tp = 20 * Math.log10(Math.max(truePeak(b.oL.subarray(SR * 4)), truePeak(b.oR.subarray(SR * 4))));
  // the loud half's momentary loudness in its second pass (24-32 s) and the quiet half's (16-24 s)
  const mean = (arr, a0, a1) => arr.slice(a0, a1).reduce((s, v) => s + v, 0) / (a1 - a0);
  const loudL = lufs(mean(b.blocks, 244, 320)), quietL = lufs(mean(b.blocks, 164, 240)), inL = lufs(mean(mstRun(true, L, R).blocks, 0, 1));
  console.log(`master: true peak ${tp.toFixed(2)} dBTP (ceiling -1) · loud part ${loudL.toFixed(1)} LUFS (target -14), quiet part ${quietL.toFixed(1)} LUFS · auto gain ${b.auto.toFixed(1)} dB`);
}
// each speaker: pink noise in at -20 LUFS, out at about the same loudness (the trims are set from this)
{
  const N = SR * 6, L = new Float32Array(N), R = new Float32Array(N); let seed = 5, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, c0 = 0, c1 = 0, c2 = 0, c3 = 0, c4 = 0, c5 = 0, c6 = 0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 * 2 - 1;
  const pink = (x, s) => { s[0] = 0.99886 * s[0] + x * 0.0555179; s[1] = 0.99332 * s[1] + x * 0.0750759; s[2] = 0.969 * s[2] + x * 0.153852; s[3] = 0.8665 * s[3] + x * 0.3104856; s[4] = 0.55 * s[4] + x * 0.5329522; s[5] = -0.7616 * s[5] - x * 0.016898; const y = (s[0] + s[1] + s[2] + s[3] + s[4] + s[5] + s[6] + x * 0.5362) * 0.11; s[6] = x * 0.115926; return y; };
  const sl = [0, 0, 0, 0, 0, 0, 0], sr_ = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) { L[i] = pink(rnd(), sl); R[i] = pink(rnd(), sr_); }
  const kw = (l, r) => { const ms = new Master().ms; ms.p[0] = 0; const oL = new Float32Array(BLOCK), oR = new Float32Array(BLOCK), bl = []; let last = 0; for (let f = 0; f + BLOCK <= l.length; f += BLOCK) { ms.process(l.subarray(f, f + BLOCK), r.subarray(f, f + BLOCK), oL, oR, BLOCK); if (ms.m[11] !== last) { last = ms.m[11]; bl.push(ms.m[1]); } } return lufs(bl[bl.length - 1]); };
  const g = Math.pow(10, (-20 - kw(L, R)) / 20); for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }
  const names = ['phone', 'laptop', 'earbuds', 'speaker', 'car', 'tv', 'cube', 'club', 'radio'], row = [];
  const x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(__dirname, '../tactus_dsp.wasm'))), {}).exports; x.sp_init(SR);
  const xl = new Float32Array(x.memory.buffer, x.sp_l(), BLOCK), xr = new Float32Array(x.memory.buffer, x.sp_r(), BLOCK);
  let e = 0;
  for (let mo = 1; mo <= 9; mo++) {
    const sp = new Speaker().sp; sp.set(mo); x.sp_set(mo);
    const oL = L.slice(), oR = R.slice(), wL = L.slice(), wR = R.slice();
    for (let f = 0; f + BLOCK <= N; f += BLOCK) {
      sp.process(oL.subarray(f, f + BLOCK), oR.subarray(f, f + BLOCK), BLOCK);
      xl.set(wL.subarray(f, f + BLOCK)); xr.set(wR.subarray(f, f + BLOCK)); x.sp_process(BLOCK); wL.set(xl, f); wR.set(xr, f);
    }
    for (let i = 0; i < N; i++) e = Math.max(e, Math.abs(oL[i] - wL[i]), Math.abs(oR[i] - wR[i]));
    row.push(`${names[mo - 1]} ${(kw(oL, oR) + 20).toFixed(1)}`);
  }
  console.log(`speakers max abs difference ${e.toExponential(2)} · loudness change on pink noise (dB): ${row.join(', ')}`);
}
