// ===================== Wavetables for the synth engine =====================
// Pure: no audio, so the sound matcher (match.js), the tests and the benchmark use the same tables as the voice.
// Eight tables of 16 frames, each frame stored band-limited at 7 levels (512 harmonics down to 8), so a high note
// reads a level with nothing above the Nyquist frequency. They are made here, from formulas, not recordings:
// basic (sine, triangle, saw, square), pwm, sync, formant (a e i o u), growl (a moving comb), fm, organ, fold.
const WT_SHAPE = { t: 8, f: 16, m: 7, n: 1024 };
let WT_DATA = null;
function fftC(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const h = i + j + len / 2, vr = re[h] * cr - im[h] * ci, vi = re[h] * ci + im[h] * cr; re[h] = re[i + j] - vr; im[h] = im[i + j] - vi; re[i + j] += vr; im[i + j] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
// the harmonics (cosine a, sine b, n = 1..511) of one cycle given as a function of phase
function wtHarm(g) {
  const N = 4096, re = new Float64Array(N), im = new Float64Array(N), a = new Float64Array(512), b = new Float64Array(512);
  for (let i = 0; i < N; i++) re[i] = g(i / N);
  fftC(re, im, false);
  for (let k = 1; k < 512; k++) { a[k] = 2 * re[k] / N; b[k] = -2 * im[k] / N; }
  return { a, b };
}
function wtFrame(t, x) {
  const a = new Float64Array(512), b = new Float64Array(512), odd = n => n % 2 === 1;
  if (t === 0) {
    // sine → triangle → saw → square
    const shapes = [n => n === 1 ? 1 : 0, n => odd(n) ? 8 / (Math.PI * Math.PI) * ((n - 1) / 2 % 2 ? -1 : 1) / (n * n) : 0, n => 2 / Math.PI * (n % 2 ? 1 : -1) / n, n => odd(n) ? 4 / (Math.PI * n) : 0];
    const p = x * 3, i = Math.min(2, Math.floor(p)), f = p - i;
    for (let n = 1; n < 512; n++) b[n] = shapes[i](n) * (1 - f) + shapes[i + 1](n) * f;
    return { a, b };
  }
  if (t === 1) { const w = 0.5 - 0.45 * x; for (let n = 1; n < 512; n++) { a[n] = 2 / (n * Math.PI) * Math.sin(2 * Math.PI * n * w); b[n] = 2 / (n * Math.PI) * (1 - Math.cos(2 * Math.PI * n * w)); } return { a, b }; }
  if (t === 2) { const r = 1 + 4 * x; return wtHarm(ph => 2 * ((ph * r) % 1) - 1); }
  if (t === 3) {
    const F = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]], v = x * 4, i = Math.min(3, Math.floor(v)), f = v - i;
    for (let n = 1; n < 512; n++) { let amp = 0; for (let k = 0; k < 3; k++) { const Fk = F[i][k] * (1 - f) + F[i + 1][k] * f, bw = Fk * 0.08 + 40; amp += [1, 0.5, 0.25][k] / (1 + Math.pow((n * 110 - Fk) / bw, 2)); } b[n] = amp / Math.sqrt(n); }
    return { a, b };
  }
  if (t === 4) { const c = 2 + 10 * x; for (let n = 1; n < 512; n++) { const amp = (0.15 + 0.85 * (0.5 + 0.5 * Math.cos(2 * Math.PI * n / c))) / n; a[n] = amp * Math.sin(Math.PI * n * x); b[n] = amp * Math.cos(Math.PI * n * x); } return { a, b }; }
  if (t === 5) { const I = 8 * x; return wtHarm(ph => Math.sin(2 * Math.PI * ph + I * Math.sin(2 * Math.PI * ph))); }
  if (t === 6) { const bars = [1, 2, 3, 4, 6, 8, 10, 12, 16], lv = [1, 0.8, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25, 0.2]; bars.forEach((n, k) => { b[n] = k === 0 ? 1 : lv[k] * Math.min(1, x * bars.length / k); }); return { a, b }; }
  const G = 1 + 9 * x; return wtHarm(ph => Math.sin(G * Math.sin(2 * Math.PI * ph)));
}
function wtBuild() {
  if (WT_DATA) return WT_DATA;
  const { t: T, f: Fr, m: M, n: N } = WT_SHAPE, out = new Float32Array(T * Fr * M * N);
  for (let t = 0; t < T; t++) for (let j = 0; j < Fr; j++) {
    const { a, b } = wtFrame(t, j / (Fr - 1));
    let scale = 0;
    for (let m = 0; m < M; m++) {
      const H = Math.min(511, 512 >> m), re = new Float64Array(N), im = new Float64Array(N);
      for (let n = 1; n <= H; n++) { re[n] = a[n]; im[n] = -b[n]; }
      fftC(re, im, true);
      if (m === 0) { let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(re[i])); scale = pk > 0 ? 0.9 / pk : 0; }
      const base = ((t * Fr + j) * M + m) * N;
      for (let i = 0; i < N; i++) out[base + i] = re[i] * scale;
    }
  }
  return (WT_DATA = out);
}
const WT_NAMES = ['basic', 'pwm', 'sync', 'formant', 'growl', 'fm', 'organ', 'fold'];
if (typeof module !== 'undefined') module.exports = { wtFrame, wtBuild, wtHarm, fftC, WT_SHAPE, WT_NAMES };
