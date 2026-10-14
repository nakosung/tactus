// ===================== Drum separation for loops (pure, like engine.js) =====================
// A loaded loop is split into its drums and the rest by harmonic/percussive separation (Fitzgerald 2010): in a
// spectrogram, a held note is a horizontal line and a drum hit a vertical one, so a median across time keeps the
// notes and a median across frequency keeps the hits. Soft masks from the two (Wiener-like, squared) split every
// bin between drums and the rest, and they add up to one, so the two stems played together give back the loop.
// Then the drums are written down: onsets in three bands (kick, snare, hat) on the loop's 16th grid.
// Runs in a worker (sepWorker below) so the page does not stall; tests/sep.test.js runs it in Node.

const SEP_N = 2048, SEP_HOP = 512;
function sepFft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const p = i + k, q = p + h, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
function sepWinMake() { const w = new Float32Array(SEP_N); for (let i = 0; i < SEP_N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / SEP_N); return w; }
const sepWin = sepWinMake();
// the spectrum of x: frames × (N/2+1) bins, real and imaginary parts in flat arrays; x is padded at both ends
function sepStft(x) {
  const K = SEP_N / 2 + 1, pad = SEP_N, n = x.length + 2 * pad, F = Math.ceil((n - SEP_N) / SEP_HOP) + 1;
  const RE = new Float32Array(F * K), IM = new Float32Array(F * K), re = new Float64Array(SEP_N), im = new Float64Array(SEP_N);
  for (let f = 0; f < F; f++) {
    const s = f * SEP_HOP - pad;
    for (let i = 0; i < SEP_N; i++) { const j = s + i; re[i] = j >= 0 && j < x.length ? x[j] * sepWin[i] : 0; im[i] = 0; }
    sepFft(re, im);
    for (let k = 0; k < K; k++) { RE[f * K + k] = re[k]; IM[f * K + k] = im[k]; }
  }
  return { RE, IM, F, K, len: x.length, pad };
}
// back to samples, with each bin scaled by the mask (overlap-add with the same window; Hann² at 75% overlap sums to 1.5)
function sepIstft(S, M, out) {
  const { RE, IM, F, K, len, pad } = S, re = new Float64Array(SEP_N), im = new Float64Array(SEP_N), acc = new Float64Array(len + 2 * pad);
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < K; k++) { const m = M[f * K + k]; re[k] = RE[f * K + k] * m; im[k] = IM[f * K + k] * m; }
    for (let k = 1; k < K - 1; k++) { re[SEP_N - k] = re[k]; im[SEP_N - k] = -im[k]; }
    for (let i = 0; i < SEP_N; i++) im[i] = -im[i];
    sepFft(re, im);
    const s = f * SEP_HOP;
    for (let i = 0; i < SEP_N; i++) acc[s + i] += re[i] / SEP_N * sepWin[i];
  }
  for (let i = 0; i < len; i++) out[i] = acc[i + pad] / 1.5;
  return out;
}
// the median of a small window, by insertion sort (windows are 17 long)
function sepMedian(buf, n) { for (let i = 1; i < n; i++) { const v = buf[i]; let j = i - 1; while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; } buf[j + 1] = v; } return buf[n >> 1]; }
// split a stereo loop: returns the two stems and the drums' spectrogram (for writing the beat down)
function sepSplit(L0, R0, sr, opt = {}) {
  // a loop goes round: its end runs into its start, so it is wrapped by a little at both ends before the medians
  // (a hit on the first beat is then a hit, not the jump from silence) and cut back afterwards
  const n0 = L0.length, ext = Math.min(n0, Math.round(0.75 * sr));
  const wrap = x => { const y = new Float32Array(n0 + 2 * ext); y.set(x.subarray(n0 - ext), 0); y.set(x, ext); y.set(x.subarray(0, ext), ext + n0); return y; };
  const L = wrap(L0), R = R0 && R0 !== L0 ? wrap(R0) : L;
  const mono = new Float32Array(L.length); for (let i = 0; i < L.length; i++) mono[i] = 0.5 * (L[i] + R[i]);
  const S = sepStft(mono), { F, K } = S, mag = new Float32Array(F * K);
  for (let i = 0; i < F * K; i++) mag[i] = Math.hypot(S.RE[i], S.IM[i]);
  // window lengths: about half a second across time (longer than a drum's ring, shorter than a held note), about
  // 500 Hz across frequency
  const wt = Math.max(7, (Math.round(0.5 * sr / SEP_HOP) | 1)), wf = Math.max(7, (Math.round(500 / (sr / SEP_N)) | 1)), ht = wt >> 1, hf = wf >> 1;
  const H = new Float32Array(F * K), P = new Float32Array(F * K), buf = new Float32Array(Math.max(wt, wf));
  for (let k = 0; k < K; k++) for (let f = 0; f < F; f++) {
    let n = 0; for (let g = f - ht; g <= f + ht; g++) if (g >= 0 && g < F) buf[n++] = mag[g * K + k];
    H[f * K + k] = sepMedian(buf, n);
  }
  for (let f = 0; f < F; f++) for (let k = 0; k < K; k++) {
    let n = 0; for (let q = k - hf; q <= k + hf; q++) if (q >= 0 && q < K) buf[n++] = mag[f * K + q];
    P[f * K + k] = sepMedian(buf, n);
  }
  // masks: drums get a bin by how much more vertical than horizontal it is. Under 160 Hz a kick is a short low tone,
  // too narrow to be vertical, so there what rises above the bin's own half-second median counts as the drums
  const p = opt.power || 2, M = new Float32Array(F * K), Mr = new Float32Array(F * K), kLow = Math.round(160 / (sr / SEP_N));
  for (let f = 0; f < F; f++) for (let k = 0; k < K; k++) {
    const i = f * K + k, pv = k <= kLow ? Math.max(P[i], mag[i] - H[i]) : P[i];
    const a = Math.pow(pv, p), b = Math.pow(H[i], p), m = a + b > 1e-20 ? a / (a + b) : 0.5;
    M[i] = m; Mr[i] = 1 - m;
  }
  const out = { drums: [], rest: [] };
  for (const ch of R !== L ? [L, R] : [L]) {
    const C = R === L ? S : sepStft(ch);
    out.drums.push(sepIstft(C, M, new Float32Array(ch.length)).slice(ext, ext + n0));
    out.rest.push(sepIstft(C, Mr, new Float32Array(ch.length)).slice(ext, ext + n0));
  }
  const dm = new Float32Array(F * K); for (let i = 0; i < F * K; i++) dm[i] = mag[i] * M[i];
  return { ...out, spec: { mag: dm, F, K, sr, off: ext } };
}
// the drums written down: onsets in three bands, on the 16th grid of the loop. A step has a hit when its band rose
// sharply there and is loud there (a snare's low thump also lifts the kick's band a little, but not to a kick's level).
// The snare band sits between the kick and the hats (300 Hz to 2 kHz), where the hats have little to give.
const SEP_BANDS = { kick: { hz: [35, 110], rise: 0.42, min: 0.5, lv: 1.5 }, snare: { hz: [300, 2000], rise: 0.6, min: 0.5, lv: 1.2 }, hat: { hz: [7000, 16000], rise: 0.08, min: 0.8, lv: 4 } };
function sepBeats(spec, bars, barSec, steps = 16) {
  const { mag, F, K, sr } = spec, hz = sr / SEP_N, fsec = SEP_HOP / sr, f0 = (SEP_N + (spec.off || 0)) / SEP_HOP;
  const total = bars * steps, stepSec = barSec / steps, lines = {}, hits = [];
  for (const [name, B] of Object.entries(SEP_BANDS)) {
    const a = Math.max(1, Math.round(B.hz[0] / hz)), b = Math.min(K - 1, Math.round(B.hz[1] / hz)), e = new Float32Array(F);
    for (let f = 0; f < F; f++) { let s = 0; for (let k = a; k <= b; k++) s += mag[f * K + k]; e[f] = Math.log(1e-6 + s); }
    // onset strength: how much the band rose since a moment ago
    const on = new Float32Array(F); for (let f = 2; f < F; f++) on[f] = Math.max(0, e[f] - Math.max(e[f - 1], e[f - 2]));
    // per step: the strongest rise near it, and how loud the band is just after it
    const st = new Float32Array(total), lv = new Float32Array(total).fill(-99);
    for (let j = 0; j < total; j++) {
      const c = j * stepSec / fsec + f0, r = Math.max(1, stepSec / fsec * 0.45);
      for (let f = Math.max(0, Math.floor(c - r)); f <= Math.min(F - 1, Math.ceil(c + r)); f++) if (on[f] > st[j]) st[j] = on[f];
      for (let f = Math.max(0, Math.round(c)); f <= Math.min(F - 1, Math.round(c) + 3); f++) if (e[f] > lv[j]) lv[j] = e[f];
    }
    const top = Array.from(st).sort((x, y) => x - y)[Math.floor(total * 0.95)] || 0, loud = Math.max(...lv);
    if (top < B.min) continue;
    const g = Array(total).fill('.'); let n = 0;
    for (let j = 0; j < total; j++) if (st[j] >= Math.max(B.min, top * B.rise) && lv[j] >= loud - B.lv) { g[j] = st[j] > top * 0.85 && name !== 'hat' ? 'X' : 'x'; n++; hits.push({ kind: name, step: j, s: st[j] }); }
    if (n) lines[name] = g;
  }
  return { lines, hits };
}
// the same functions as a worker's source, so a long loop is split without stalling the page
function sepWorkerSrc() {
  return `const SEP_N = ${SEP_N}, SEP_HOP = ${SEP_HOP}, SEP_BANDS = ${JSON.stringify(SEP_BANDS)};\n` + [sepWinMake, sepFft, sepStft, sepIstft, sepMedian, sepSplit, sepBeats].map(String).join('\n') +
    `\nconst sepWin = sepWinMake();\nonmessage = e => { const d = e.data, o = sepSplit(d.L, d.R, d.sr), b = sepBeats(o.spec, d.bars, d.barSec); postMessage({ drums: o.drums, rest: o.rest, lines: b.lines }, [...o.drums, ...o.rest].map(a => a.buffer)); };`;
}
if (typeof module !== 'undefined') module.exports = { sepSplit, sepBeats, sepStft, sepIstft };
