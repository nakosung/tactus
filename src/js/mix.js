// ===================== Tactus mix: buses, returns, master =====================
// Code lines that shape the mix instead of playing notes:
//   bus wash | chorus .5 verb .6 hpf 300     a bus: a channel strip without notes. Any track sends to it
//                                           with a parameter named after it ("pad ... | wash .4").
//   bus verb | pre 30 hpf 300 lpf 6000      the built-in reverb return: pre-delay (ms), filters, level
//   bus delay | time 3 fb .5 lpf 3000       the built-in delay: time in 16ths, feedback, filters, level
//   master warm | thr -20 ratio 3 low 1 high 1.5 width 1.2 drive .1 limit -1 gain 1
//                                           the master: glue compressor, EQ, stereo width, tape drive,
//                                           limiter ceiling (dB) and gain into the limiter (dB)
// Every value can move like a track parameter (0~1/4, 300>6000, k1(…), <…>); it is re-read every 16th.
S.buses = new Map(); S.busRt = new Map(); S.masterParams = {}; S.dlSteps = 3;
const RET_BASE = {
  verb: { gain: 0.85, pre: 22, hpf: 240, lpf: 8500 },
  delay: { gain: 0.75, time: 3, fb: 0.42, hpf: 300, lpf: 4200 },
};
// called after each compile: keep strips for buses that still exist, retire the rest
function mixApply(r) {
  S.buses = new Map([...r.buses].filter(([n]) => n !== 'verb' && n !== 'delay'));
  S.retParams = { verb: (r.buses.get('verb') || {}).params || {}, delay: (r.buses.get('delay') || {}).params || {} };
  const sig = JSON.stringify(r.masterParams || {});
  if (sig !== S.masterSig) { S.masterSig = sig; S.masterParams = r.masterParams || {}; S.mixLast = {}; S.masterSat = null; if (S.ctx) { applyMaster(S.masterMode); resetMasterExtras(); } if (typeof mstRender === 'function' && typeof MST_READY !== 'undefined') { if (S.ctx) mstSync(transport(S.ctx.currentTime), 0); mstRender(); } }
  if (S.ctx) mixSync();
}
function mixSync() {
  for (const [n, b] of S.busRt) if (!S.buses.has(n)) {
    // a removed bus: silence its sends, then let it go
    for (const r of S.rt.values()) { const sg = r.sends.get(n); if (sg) { sg.gain.setTargetAtTime(0, S.ctx.currentTime, 0.02); r.sends.delete(n); setTimeout(() => { try { sg.disconnect(); } catch (e) { } }, 200); } }
    b.out.gain.setTargetAtTime(0, S.ctx.currentTime, 0.05);
    S.busRt.delete(n);
  }
  for (const n of S.buses.keys()) if (!S.busRt.has(n)) {
    const ctx = S.ctx, out = ctx.createGain(), pan = ctx.createStereoPanner();
    const b = makeStrip(out); b.out = out; b.pan = pan; out.connect(pan); pan.connect(A.synIn);
    S.busRt.set(n, b);
  }
}
const busP = (bus, s) => { const P = { gain: 1, pan: 0 }; for (const k in bus.params) { const x = valueAt(bus.params[k], s, k); if (x !== null) P[k] = x; } return P; };
// buses, returns and the master follow their parameters every 16th
function mixTick(a, b) {
  if (!S.ctx) return;
  for (let k = Math.ceil(a * 16 - 1e-9); k / 16 < b; k++) {
    const s = k / 16, time = Math.max(S.ctx.currentTime, timeOf(s));
    for (const [n, bus] of S.buses) {
      const r = S.busRt.get(n); if (!r) continue;
      const P = busP(bus, s);
      stripAt(r, P, time);
      r.out.gain.setTargetAtTime(Math.max(0, P.gain), time, 0.01); r.pan.pan.setTargetAtTime(clamp(P.pan || 0, -1, 1), time, 0.01);
    }
    returnsAt(s, time);
    masterAt(s, time);
  }
}
// only changed values are written, so pads that throw the delay or open the filters are left alone
function setIf(key, param, v, time) {
  const L = S.mixLast || (S.mixLast = {});
  if (L[key] === v) return;
  L[key] = v; param.setTargetAtTime(v, time, 0.02);
}
function returnsAt(s, time) {
  const rp = S.retParams || { verb: {}, delay: {} }, ev = (name) => { const P = { ...RET_BASE[name] }; for (const k in rp[name]) { const x = valueAt(rp[name][k], s, k); if (x !== null) P[k] = x; } return P; };
  const v = ev('verb'), d = ev('delay');
  if (A.rOut) {
    setIf('vg', A.rOut.gain, Math.max(0, v.gain), time);
    if (rp.verb.pre != null) setIf('vp', A.rPre.delayTime, clamp(v.pre, 0, 200) / 1000, time);
    setIf('vh', A.rHP.frequency, clamp(v.hpf, 20, 2000), time); setIf('vl', A.rLP.frequency, clamp(v.lpf, 500, 20000), time);
  }
  if (A.dOut) {
    setIf('dg', A.dOut.gain, Math.max(0, d.gain), time);
    S.dlFb = clamp(d.fb, 0, 0.9); setIf('df', A.dFb.gain, S.dlFb, time);
    setIf('dh', A.dHP.frequency, clamp(d.hpf, 20, 3000), time); setIf('dl', A.dLP.frequency, clamp(d.lpf, 300, 20000), time);
    const steps = clamp(Math.round(d.time * 4) / 4, 0.25, 16);
    if (steps !== S.dlSteps) { S.dlSteps = steps; for (const x of A.dls) x.delayTime.setTargetAtTime(steps / 16 / S.cps, time, 0.03); }
  }
}
function resetMasterExtras() {
  if (!A.mLow) return;
  const now = S.ctx.currentTime;
  for (const f of [A.mLow, A.mMid, A.mHigh]) f.gain.setTargetAtTime(0, now, 0.03);
  widthAt(1, now);
}
function widthAt(w, time) {
  w = clamp(w, 0, 2);
  const a = (1 + w) / 2, b = (1 - w) / 2;
  A.wM[0].gain.setTargetAtTime(a, time, 0.02); A.wM[1].gain.setTargetAtTime(b, time, 0.02); A.wM[2].gain.setTargetAtTime(b, time, 0.02); A.wM[3].gain.setTargetAtTime(a, time, 0.02);
}
function masterAt(s, time) {
  if (typeof mstSync === 'function') mstSync(s, time);
  const mp = S.masterParams; if (!mp || !A.glue) return;
  const keys = Object.keys(mp); if (!keys.length) return;
  const P = {}; for (const k of keys) { const x = valueAt(mp[k], s, k); if (x !== null) P[k] = x; }
  const m = MASTER[S.masterMode] || MASTER.default;
  if (P.thr != null) setIf('mt', A.glue.threshold, clamp(P.thr, -60, 0), time);
  if (P.ratio != null) setIf('mr', A.glue.ratio, clamp(P.ratio, 1, 20), time);
  if (P.catk != null) setIf('ma', A.glue.attack, clamp(P.catk, 0.1, 500) / 1000, time);
  if (P.crel != null) setIf('mc', A.glue.release, clamp(P.crel, 10, 2000) / 1000, time);
  if (P.low != null) setIf('ml', A.mLow.gain, clamp(P.low, -12, 12), time);
  if (P.mid != null) setIf('mm', A.mMid.gain, clamp(P.mid, -12, 12), time);
  if (P.midf != null) setIf('mf', A.mMid.frequency, clamp(P.midf, 60, 12000), time);
  if (P.high != null) setIf('mh', A.mHigh.gain, clamp(P.high, -12, 12), time);
  if (P.width != null && P.width !== (S.mixLast || {}).mw) { (S.mixLast || (S.mixLast = {})).mw = P.width; widthAt(P.width, time); }
  if (P.limit != null) setIf('mx', A.lim.threshold, clamp(P.limit, -12, 0), time);
  // drive and gain go through the same level bookkeeping as the master modes
  if (P.drive != null || P.gain != null || P.thr != null || P.ratio != null) {
    const sat = P.drive != null ? clamp(P.drive, 0, 1) : m.sat, thr = P.thr != null ? clamp(P.thr, -60, 0) : m.gT, ratio = P.ratio != null ? clamp(P.ratio, 1, 20) : m.gR;
    const key = Math.round(sat * 20) / 20;
    if (key !== S.masterSat) { S.masterSat = key; A.sat.curve = curve(sat); }
    const d = MASTER.default, mk = compMakeupDb(d.gT, d.gR) - compMakeupDb(thr, ratio);
    setIf('mg', A.satOut.gain, curveGain(d.sat) / curveGain(sat) * Math.pow(10, (mk + (m.trim || 0) + clamp(P.gain || 0, -12, 12)) / 20), time);
  }
}
// the kick's sidechain also reaches buses and returns that ask for it
function mixDuck(time, s) {
  const hit = (g, d) => { g.setTargetAtTime(1 - d, time, 0.004); g.setTargetAtTime(1, time + 0.03, 0.07 / Math.max(0.5, S.cps * 2)); };
  for (const [n, bus] of S.buses) { if (!bus.params.duck) continue; const r = S.busRt.get(n); const d = clamp(valueAt(bus.params.duck, s, 'duck') || 0, 0, 1); if (r && d) hit(r.duck.gain, d); }
  const rp = S.retParams || {};
  if (rp.verb && rp.verb.duck && A.rDuck) { const d = clamp(valueAt(rp.verb.duck, s, 'duck') || 0, 0, 1); if (d) hit(A.rDuck.gain, d); }
  if (rp.delay && rp.delay.duck && A.dDuck) { const d = clamp(valueAt(rp.delay.duck, s, 'duck') || 0, 0, 1); if (d) hit(A.dDuck.gain, d); }
}
