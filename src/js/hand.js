// ===================== Tactus hand control (camera): conducting =====================
// The right hand is the baton: beat time and the tempo follows (four steady strokes while stopped start the
// music on the next beat); the size of the strokes sets the dynamics, from pp to ff. The left hand shapes and cues:
// its height is k1 and its left/right k3; pointing at an instrument (laid out across the picture like an
// orchestra) and holding there brings it in or takes it out. Right pinch = build-up (release drops on the next
// downbeat), left pinch = beat repeat, one fist = breakdown, both fists = fermata (the sound is held), a fast
// right-hand swipe = next / previous scene. Right-hand height is k2 while it is not beating.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const H = { on: false, busy: false, lm: null, video: null, stream: null, raf: 0, last: -1, st: { L: null, R: null }, fists: 0, swipeAt: 0, res: null,
  // the baton: strokes (time, size), the tempo it gives, the dynamics; cue: the instrument pointed at and since when
  beats: [], bpm: null, dyn: 1, dynDb: 0, beatAt: -1e9, ictusFlash: 0, cue: null, cueSince: 0, cueDone: null, fermata: false, startAt: 0 };

function camAllowedByPage() {
  const pp = document.permissionsPolicy || document.featurePolicy;
  try { return pp && pp.allowsFeature ? pp.allowsFeature('camera') : true; } catch (e) { return true; }
}
async function handsToggle() {
  if (H.busy) return;
  if (H.on) { handsOff(); return; }
  H.busy = true; syncHandsUI();
  try { await handsOn(); } finally { H.busy = false; syncHandsUI(); }
}
async function handsOn() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !camAllowedByPage()) { loopMsg(t('camBlocked'), 'bad', 8000); return; }
  try {
    H.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
  } catch (e) {
    loopMsg(t(e && e.name === 'SecurityError' ? 'camBlocked' : 'camDenied'), 'bad', 8000); return;
  }
  if (!H.video) { H.video = document.createElement('video'); H.video.playsInline = true; H.video.muted = true; }
  H.video.srcObject = H.stream;
  await H.video.play();
  if (!H.lm) {
    loopMsg(t('handLoading'), 'ok', 20000);
    try {
      const vision = await import(MP + '/vision_bundle.mjs');
      const fs = await vision.FilesetResolver.forVisionTasks(MP + '/wasm');
      const opts = d => ({ baseOptions: { modelAssetPath: MP_MODEL, delegate: d }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
      try { H.lm = await vision.HandLandmarker.createFromOptions(fs, opts('GPU')); }
      catch (e) { H.lm = await vision.HandLandmarker.createFromOptions(fs, opts('CPU')); }
    } catch (e) {
      loopMsg(t('handLoadFail'), 'bad', 9000);
      H.stream.getTracks().forEach(tr => tr.stop()); H.stream = null;
      return;
    }
  }
  H.on = true;
  loopMsg(t('handReady'), 'ok', 3500);
  H.raf = requestAnimationFrame(handLoop);
}
function handsOff() {
  H.on = false; cancelAnimationFrame(H.raf);
  for (const s of ['L', 'R']) handLost(s);
  if (H.stream) H.stream.getTracks().forEach(tr => tr.stop());
  H.stream = null; H.res = null;
  syncHandsUI();
}
function handLoop() {
  if (!H.on) return;
  H.raf = requestAnimationFrame(handLoop);
  const v = H.video;
  if (v.readyState < 2 || v.currentTime === H.last) return;
  H.last = v.currentTime;
  let res;
  try { res = H.lm.detectForVideo(v, performance.now()); } catch (e) { return; }
  handProcess(res, performance.now());
  drawHands(res);
}

// ---------- features & gestures ----------
// Pose is measured on MediaPipe's 3D world landmarks (metres, hand-centred), so fingers pointing
// at the camera don't look shorter than they are. Screen landmarks are only used for position.
function handFeat(lm, wl) {
  const P = wl && wl.length === 21 ? wl : lm.map(p => ({ x: p.x * (4 / 3), y: p.y, z: p.z || 0 }));
  const d = (a, b) => Math.hypot(P[a].x - P[b].x, P[a].y - P[b].y, (P[a].z || 0) - (P[b].z || 0));
  const palm = d(0, 9) || 1e-3;
  const pts = [0, 5, 9, 13, 17];
  const cx = pts.reduce((s, i) => s + lm[i].x, 0) / 5, cy = pts.reduce((s, i) => s + lm[i].y, 0) / 5;
  return {
    ux: 1 - cx, uy: 1 - cy, lm,
    pinch: d(4, 8) / palm,                                             // ≈0.1–0.3 touching, ≥0.7 apart
    fold: [[8, 5], [12, 9], [16, 13], [20, 17]].map(([tip, mcp]) => d(tip, mcp) / palm), // ≈1 straight, ≈0.3–0.5 curled
  };
}
function handProcess(res, now) {
  const wls = (res && res.worldLandmarks) || [];
  const hands = (res && res.landmarks || []).map((lm, k) => handFeat(lm, wls[k]));
  let L = null, R = null;
  if (hands.length === 1) { if (hands[0].ux < 0.5) L = hands[0]; else R = hands[0]; }
  else if (hands.length >= 2) { hands.sort((a, b) => a.ux - b.ux); L = hands[0]; R = hands[hands.length - 1]; }
  H.res = { L, R };
  handUpdate('L', L, now); handUpdate('R', R, now);
}
function rawPose(f, prev, now, st) {
  const [i, m, r, p] = f.fold;
  // pinch = thumb tip on index tip with the index reaching out to meet it (other fingers may curl)
  if (prev === 'pinch' && f.pinch < 0.5 && i > 0.47) return 'pinch';
  if (f.pinch < 0.32 && i > 0.52) return 'pinch';
  // fist = index tucked into the palm (the thumb may lie close to it), plus the other three curled;
  // ignored for a moment after a pinch so letting go of a pinch never reads as a fist
  const recentPinch = st && now - st.pinchAt < 450;
  if (!recentPinch && i < 0.52 && m < 0.6 && r < 0.6 && p < 0.65) return 'fist';
  // pointing = the index straight out, the other three curled
  if (f.pinch > 0.45 && i > 0.8 && m < 0.62 && r < 0.62 && p < 0.7) return 'point';
  if (f.pinch > 0.6 && i > 0.75 && m > 0.75) return 'open';
  // a pinch that no longer qualifies ends; anything else keeps its last pose
  return prev === 'pinch' || prev === 'point' ? 'open' : prev;
}
const POSE_GESTURE = { L: { pinch: 'rep4', fist: 'break' }, R: { pinch: 'build', fist: 'break' } };
// one fist is a breakdown; the second fist turns it into a fermata: the sound is frozen and held, nothing moves on
const FERMATA = { name: 'fermata', acts: [{ op: 'freeze' }, { op: 'mute', list: ['all'] }] };
function poseOn(side, pose) {
  const g = POSE_GESTURE[side][pose]; if (!g) return;
  if (g === 'break') {
    H.fists++;
    if (H.fists === 1) gestureOn('break');
    else if (H.fists === 2 && S.ctx && S.playing) { gestureOff('break'); padStart('hand:fermata', FERMATA, S.lastC, false); H.fermata = true; loopMsg(t('handFermata'), 'ok', 1500); }
    return;
  }
  gestureOn(g);
}
function poseOff(side, pose) {
  const g = POSE_GESTURE[side][pose]; if (!g) return;
  if (g === 'break') {
    H.fists = Math.max(0, H.fists - 1);
    if (H.fermata) { padStop('hand:fermata', S.lastC, false); H.fermata = false; if (H.fists === 1) gestureOn('break'); }
    else if (H.fists === 0) gestureOff('break');
    return;
  }
  gestureOff(g);
}
function handLost(side) {
  const st = H.st[side];
  if (st) poseOff(side, st.pose);
  H.st[side] = null;
  if (side === 'R') setDynamics(1, 2);   // no baton, no dynamics: back to as written
  if (side === 'L') H.cue = null;
}
const knobMap = v => Math.max(0, Math.min(1, (v - 0.18) / 0.64));
function handUpdate(side, f, now) {
  if (!f) { if (H.st[side] && now - H.st[side].seen > 250) handLost(side); return; }
  let st = H.st[side];
  if (!st) st = H.st[side] = { pose: 'open', cand: 'open', n: 0, sx: f.ux, sy: f.uy, hist: [], seen: now, pinchAt: -1e9, by: f.uy, dir: 0, top: f.uy, lastT: now };
  st.seen = now; st.f = f;
  const raw = rawPose(f, st.cand, now, st);
  if (raw === 'pinch') st.pinchAt = now;
  if (raw === st.cand) st.n++; else { st.cand = raw; st.n = 1; }
  if (st.n >= (st.cand === 'fist' ? 6 : st.cand === 'point' ? 4 : 3) && st.cand !== st.pose) { poseOff(side, st.pose); st.pose = st.cand; poseOn(side, st.pose); }
  st.sx += 0.35 * (f.ux - st.sx); st.sy += 0.35 * (f.uy - st.sy);
  if (side === 'L' && st.pose === 'point') { cueUpdate(f, now); st.hist = []; return; }
  if (side === 'L') H.cue = null;
  if (st.pose !== 'open') { st.hist = []; return; }
  if (side === 'L') { setKnob(0, knobMap(st.sy)); setKnob(2, knobMap(st.sx * 2)); return; }
  batonUpdate(st, f, now);
  // height is k2 only while the hand is not beating time, so the strokes don't throw the knob around
  if (now - H.beatAt > 1800) setKnob(1, knobMap(st.sy));
  st.hist.push({ t: now, x: f.ux });
  while (st.hist.length && now - st.hist[0].t > 220) st.hist.shift();
  const dx = st.hist.length > 2 ? f.ux - st.hist[0].x : 0;
  if (Math.abs(dx) > 0.22 && now - H.swipeAt > 900) { H.swipeAt = now; st.hist = []; swipeScene(dx > 0 ? 1 : -1); }
}

// ---------- the baton ----------
// A beat is the bottom of a stroke: the hand was going down, by enough, and turns up. The time between beats is
// the tempo, the depth of the strokes is the dynamics.
const BEAT_MIN = 0.035;           // a stroke at least this deep (of the picture's height) counts
function batonUpdate(st, f, now) {
  const y = st.by += 0.55 * (f.uy - st.by);          // lightly smoothed height (up = 1)
  const dir = y < st.prevY - 0.004 ? -1 : y > st.prevY + 0.004 ? 1 : st.dir;
  if (st.dir >= 0 && dir < 0) st.top = st.prevY ?? y;     // started down: remember where from
  if (st.dir < 0 && dir > 0) {                             // turned up: was it a beat?
    const depth = (st.top ?? y) - y;
    if (depth > BEAT_MIN && now - H.beatAt > 230) beat(now, depth);
  }
  st.dir = dir; st.prevY = y;
}
function beat(now, depth) {
  H.beatAt = now; H.ictusFlash = now;
  H.beats.push({ t: now, d: depth });
  while (H.beats.length > 6) H.beats.shift();
  const b = H.beats.filter(x => now - x.t < 4000);
  // dynamics follow the size of the last few strokes: small is pp, wide is ff
  const size = b.slice(-3).reduce((a, x) => a + x.d, 0) / Math.min(3, b.length);
  setDynamics(Math.max(0, Math.min(1, (size - 0.04) / 0.21)), 0.25);
  if (b.length < 4) return;
  const iv = []; for (let i = 1; i < b.length; i++) iv.push(b[i].t - b[i - 1].t);
  const last = iv.slice(-3), mean = last.reduce((a, x) => a + x, 0) / last.length;
  const sd = Math.sqrt(last.reduce((a, x) => a + (x - mean) ** 2, 0) / last.length);
  if (sd / mean > 0.14 || mean < 280 || mean > 1500) return;     // not steady, or not a tempo
  let bpm = 60000 / mean;
  // beating in halves or in eighths of the song's beat: keep to the song's own pulse
  if (S.playing) for (const k of [2, 0.5]) if (Math.abs(bpm * k - S.bpm) < Math.abs(bpm - S.bpm) && Math.abs(bpm * k / S.bpm - 1) < 0.2) bpm *= k;
  H.bpm = bpm;
  if (!S.playing) {
    // the conductor's preparation: steady beats while stopped start the music on the next one
    if (now - H.startAt > 3000) { H.startAt = now; setTimeout(() => { if (!S.playing) { writeBpm(Math.round(bpm)); togglePlay(true); loopMsg(t('handStart', { b: Math.round(bpm) }), 'ok', 2000); } }, Math.max(0, mean - 90)); }
    return;
  }
  // follow, a step at a time, so one odd stroke can't throw the tempo
  const target = Math.max(S.bpm * 0.92, Math.min(S.bpm * 1.08, bpm));
  if (Math.abs(target - S.bpm) >= 1.5) writeBpm(Math.round(target));
}
// 0..1 -> -12 dB .. +2 dB on the master, ramped so it breathes rather than steps
function setDynamics(x, tau) {
  H.dyn = x; H.dynDb = x === 1 && tau === 2 ? 0 : -12 + 14 * x;
  if (!S.ctx || !A.dyn) return;
  A.dyn.gain.setTargetAtTime(Math.pow(10, H.dynDb / 20), S.ctx.currentTime, tau);
}
const DYN_MARKS = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
const dynMark = db => DYN_MARKS[Math.max(0, Math.min(5, Math.round((db + 12) / 14 * 5)))];

// ---------- cues ----------
// The tracks sit across the picture like an orchestra, left to right in code order. Point with the left hand
// and hold for a moment: a silent track comes in, a playing one leaves.
const CUE_HOLD = 700;
function cueTracks() { return S.order.filter(n => { const d = S.tracks.get(n); return d && d.kind !== 'loop'; }); }
function cueUpdate(f, now) {
  const names = cueTracks(); if (!names.length) { H.cue = null; return; }
  const x = Math.max(0, Math.min(0.999, 1 - f.lm[8].x));      // where the index fingertip is, mirrored
  const name = names[Math.floor(x * names.length)];
  if (name !== H.cue) { H.cue = name; H.cueSince = now; if (H.cueDone !== name) H.cueDone = null; return; }
  if (H.cueDone === name || now - H.cueSince < CUE_HOLD) return;
  H.cueDone = name;
  const out = !S.muted.has(name);
  toggleSet(S.muted, name); render();
  loopMsg(t(out ? 'handCueOut' : 'handCueIn', { n: name }), 'ok', 1500);
}

function swipeScene(dir) {
  const names = [...S.scenes.keys()];
  if (!names.length) return;
  const cur = (sceneNameAt(S.playing ? S.lastC : 0) || {}).name;
  const i = names.indexOf(cur);
  const next = names[mod((i < 0 ? 0 : i) + dir, names.length)];
  launchScene(next, 'phrase');
  loopMsg(t('handScene', { n: next }), 'ok', 1800);
}

// ---------- what the camera sees, and what the hands are doing ----------
function drawHands(res) {
  const cv = $('#handcv'); if (!cv || cv.hidden) return;
  const dpr = devicePixelRatio, w = cv.width = cv.clientWidth * dpr, h = cv.height = cv.clientHeight * dpr;
  const g = cv.getContext('2d'), now = performance.now();
  g.save(); g.translate(w, 0); g.scale(-1, 1); g.globalAlpha = 0.45; g.drawImage(H.video, 0, 0, w, h); g.restore();
  const css = getComputedStyle(document.documentElement), mono = css.getPropertyValue('--f-code');
  const col = { L: css.getPropertyValue('--sky').trim(), R: css.getPropertyValue('--amber').trim() };
  // the orchestra: the tracks across the top, the one pointed at lit, with a ring filling up while it is held
  const st0 = H.st.L;
  if (st0 && st0.pose === 'point') {
    const names = cueTracks(), n = names.length, bw = w / Math.max(1, n);
    g.font = `${10 * dpr}px ${mono}`; g.textAlign = 'center';
    names.forEach((nm, i) => {
      const on = nm === H.cue, x = (i + 0.5) * bw, y = 16 * dpr, muted = S.muted.has(nm);
      g.globalAlpha = on ? 1 : 0.65; g.fillStyle = on ? col.L : 'rgba(0,0,0,.45)';
      g.beginPath(); g.roundRect(x - bw / 2 + 2 * dpr, 4 * dpr, bw - 4 * dpr, 20 * dpr, 6 * dpr); g.fill();
      g.fillStyle = on ? '#000' : muted ? 'rgba(255,255,255,.45)' : '#fff';
      g.fillText((muted ? '· ' : '') + nm, x, y + 2 * dpr);
      if (on && H.cueDone !== nm) {
        const q = Math.min(1, (now - H.cueSince) / CUE_HOLD);
        g.strokeStyle = col.L; g.lineWidth = 3 * dpr; g.globalAlpha = 1;
        g.beginPath(); g.arc(x, 40 * dpr, 9 * dpr, -Math.PI / 2, -Math.PI / 2 + q * 2 * Math.PI); g.stroke();
      }
    });
    g.globalAlpha = 1; g.textAlign = 'start';
  }
  for (const side of ['L', 'R']) {
    const f = H.res && H.res[side], st = H.st[side];
    if (!f) continue;
    const P = i => [(1 - f.lm[i].x) * w, f.lm[i].y * h];
    g.strokeStyle = col[side]; g.fillStyle = col[side]; g.lineWidth = 2 * dpr;
    g.beginPath();
    for (const [a, b] of HAND_LINKS) { const pa = P(a), pb = P(b); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); }
    g.stroke();
    for (let i = 0; i < 21; i++) { const p = P(i); g.beginPath(); g.arc(p[0], p[1], 2.2 * dpr, 0, 7); g.fill(); }
    // each beat flashes a ring at the baton tip
    if (side === 'R' && now - H.ictusFlash < 260) {
      const p = P(8), k = (now - H.ictusFlash) / 260;
      g.globalAlpha = 1 - k; g.lineWidth = 3 * dpr; g.beginPath(); g.arc(p[0], p[1], (10 + 26 * k) * dpr, 0, 7); g.stroke(); g.globalAlpha = 1;
    }
    const p0 = P(0);
    g.font = `${11 * dpr}px ${mono}`;
    g.fillText(handLabel(side, st), p0[0] - 30 * dpr, p0[1] + 16 * dpr);
  }
  // the baton's reading: tempo and dynamics, big, while it beats
  if (now - H.beatAt < 1800 && H.bpm) {
    g.fillStyle = col.R; g.font = `600 ${16 * dpr}px ${mono}`; g.textAlign = 'right';
    g.fillText(`♩ = ${Math.round(S.playing ? S.bpm : H.bpm)}   ${dynMark(H.dynDb)}`, w - 10 * dpr, h - 12 * dpr);
    g.textAlign = 'start';
  }
  if (H.fermata) { g.fillStyle = '#fff'; g.font = `600 ${22 * dpr}px ${mono}`; g.textAlign = 'center'; g.fillText('𝄐', w / 2, h / 2); g.textAlign = 'start'; }
}
function handLabel(side, st) {
  if (!st) return '';
  if (H.fermata && st.pose === 'fist') return t('gFermata');
  const g = POSE_GESTURE[side][st.pose];
  if (g) return t({ build: 'gBuild', rep4: 'gRep4', break: 'gBreak' }[g]);
  if (side === 'L' && st.pose === 'point') return H.cue ? '→ ' + H.cue : '';
  if (side === 'R' && performance.now() - H.beatAt < 1800) return t('gBaton');
  return side === 'L' ? `k1 ${Math.round(S.knobs[0] * 100)} · k3 ${Math.round(S.knobs[2] * 100)}` : `k2 ${Math.round(S.knobs[1] * 100)}`;
}
function syncHandsUI() {
  const b = $('#handsBtn'); if (!b) return;
  b.setAttribute('aria-pressed', H.on);
  b.textContent = t(H.busy ? 'handLoadingShort' : H.on ? 'handsOff' : 'hands');
  b.disabled = H.busy;
  $('#handcv').hidden = !H.on;
  $('#handsMap').hidden = !H.on;
  $('#gestStrip').hidden = !H.on;
}

// ---------- pictures of the gestures ----------
// Small drawings for the guide and under the camera: a hand pose, where it is, and how it moves.
// Left hands are drawn in the left-hand colour, right hands in the right-hand colour, as in the camera view.
// (x, y) is the middle of the palm; s scales the hand (1 = about 30 units across).
function handIcon(pose, x, y, s, side) {
  const c = side === 'L' ? 'var(--sky)' : 'var(--amber)', bg = 'var(--raised)';
  const cap = (cx, top, h, w = 6.4) => `<rect x="${x + (cx - w / 2) * s}" y="${y + top * s}" width="${w * s}" height="${h * s}" rx="${w / 2 * s}"/>`;
  const palm = `<rect x="${x - 13 * s}" y="${y - 10 * s}" width="${26 * s}" height="${24 * s}" rx="${8 * s}"/>`;
  const thumb = (ang, len = 15) => `<rect x="${x - 16 * s}" y="${y - 1 * s}" width="${7 * s}" height="${len * s}" rx="${3.5 * s}" transform="rotate(${ang} ${x - 12.5 * s} ${y + 10 * s})"/>`;
  const knuckles = xs => xs.map(cx => `<circle cx="${x + cx * s}" cy="${y - 9 * s}" r="${3.6 * s}"/>`).join('');
  const FX = [-9.4, -3.1, 3.2, 9.5];
  let body;
  if (pose === 'open') body = palm + [22, 26, 24, 19].map((h, k) => cap(FX[k], -8 - h, h + 4)).join('') + thumb(-40);
  else if (pose === 'fist') body = `<rect x="${x - 14 * s}" y="${y - 10 * s}" width="${28 * s}" height="${25 * s}" rx="${10 * s}"/>` + knuckles(FX) + `<rect x="${x - 13 * s}" y="${y + 1 * s}" width="${20 * s}" height="${6.5 * s}" rx="${3.25 * s}" fill="${bg}" opacity=".55"/>`;
  else if (pose === 'point') body = palm + cap(FX[0], -34, 30) + knuckles(FX.slice(1)) + thumb(-70, 13);
  else if (pose === 'pinch') body = palm + [26, 24, 19].map((h, k) => cap(FX[k + 1], -8 - h, h + 4)).join('') + thumb(-25, 12)
    + `<circle cx="${x - 12 * s}" cy="${y - 15 * s}" r="${6.5 * s}" fill="none" stroke="${c}" stroke-width="${5 * s}"/>`;
  return `<g fill="${c}">${body}</g>`;
}
const arrow = (d, side, dash) => `<path d="${d}" fill="none" stroke="${side === 'L' ? 'var(--sky)' : 'var(--amber)'}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"${dash ? ' stroke-dasharray="4 4"' : ''} marker-end="url(#ah${side})"/>`;
const ARROWHEADS = `<defs>${['L', 'R'].map(sd => `<marker id="ah${sd}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${sd === 'L' ? 'var(--sky)' : 'var(--amber)'}"/></marker>`).join('')}</defs>`;
const svgText = (x, y, txt, size = 11, anchor = 'middle', fill = 'var(--fg)') => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" fill="${fill}" font-family="var(--f-code)">${txt}</text>`;
const GESTURES = [
  // the baton: the 4/4 pattern, down-in-out-up, with the beats numbered; the hand waits at the top
  ['gsBeat', `${ARROWHEADS}${arrow('M52 12 C52 40 52 54 52 68', 'R')}${arrow('M52 68 C42 56 30 50 18 48', 'R')}${arrow('M18 48 C42 48 70 50 88 50', 'R')}${arrow('M88 50 C80 34 66 18 56 13', 'R')}
    ${[[52, 80, '1'], [10, 51, '2'], [96, 54, '3'], [62, 10, '4']].map(([x, y, n]) => svgText(x, y, n, 12)).join('')}${handIcon('open', 104, 26, 0.5, 'R')}`],
  ['gsSize', `${ARROWHEADS}${arrow('M28 40 L28 58', 'R')}${arrow('M88 26 L88 74', 'R')}${svgText(28, 76, 'pp', 13)}${svgText(110, 54, 'ff', 13)}${handIcon('open', 28, 26, 0.42, 'R')}${handIcon('open', 88, 14, 0.52, 'R')}`],
  ['gsStart', `${ARROWHEADS}${[0, 1, 2, 3].map(i => arrow(`M${14 + i * 22} 20 L${14 + i * 22} 48`, 'R')).join('')}${[1, 2, 3, 4].map(i => svgText(14 + (i - 1) * 22, 64, i, 10)).join('')}<path d="M98 22 L116 36 L98 50z" fill="var(--amber)"/>`],
  ['gsCue', `${['bass', 'keys', 'lead', 'pad'].map((n, i) => `<rect x="${4 + i * 28.5}" y="4" width="25" height="15" rx="4" fill="${i === 2 ? 'var(--sky)' : 'none'}" stroke="var(--line)"/>${svgText(16.5 + i * 28.5, 15, n, 8, 'middle', i === 2 ? '#000' : 'var(--dim)')}`).join('')}
    <circle cx="69" cy="30" r="6" fill="none" stroke="var(--sky)" stroke-width="2.5" stroke-dasharray="25 40"/>${handIcon('point', 72, 70, 0.6, 'L')}`],
  ['gsLeft', `${ARROWHEADS}${arrow('M22 74 L22 14', 'L')}${arrow('M22 14 L22 74', 'L')}${svgText(10, 46, 'k1', 11)}${arrow('M58 76 L112 76', 'L')}${arrow('M112 76 L58 76', 'L')}${svgText(85, 70, 'k3', 11)}${handIcon('open', 85, 38, 0.62, 'L')}`],
  ['gsBuild', `${ARROWHEADS}${handIcon('pinch', 40, 52, 0.85, 'R')}${arrow('M70 66 C84 54 94 36 104 12', 'R', true)}`],
  ['gsRepeat', `${handIcon('pinch', 40, 52, 0.85, 'L')}${svgText(92, 42, '♪♪♪♪', 15, 'middle', 'var(--sky)')}${svgText(92, 58, '× 4', 11, 'middle', 'var(--dim)')}`],
  ['gsBreak', `${handIcon('fist', 38, 44, 0.95, 'R')}<g stroke="var(--dim)" stroke-width="2" fill="none"><ellipse cx="90" cy="34" rx="16" ry="6"/><path d="M74 34 V52 M106 34 V52"/><path d="M74 52 Q90 60 106 52"/></g><path d="M74 24 L108 62" stroke="var(--amber)" stroke-width="3" stroke-linecap="round"/>`],
  ['gsFermata', `${handIcon('fist', 26, 52, 0.8, 'L')}${handIcon('fist', 94, 52, 0.8, 'R')}${svgText(60, 36, '𝄐', 28)}`],
  ['gsSwipe', `${ARROWHEADS}${arrow('M18 38 L106 38', 'R')}${arrow('M18 46 L96 46', 'R')}${handIcon('open', 30, 64, 0.48, 'R')}`],
];
// each picture gets its own arrowhead ids: a marker inside a hidden copy (the strip under the camera) draws nothing
let gestureUid = 0;
function gestureCards(cls) {
  return GESTURES.map(([k, svg0]) => { const u = 'g' + gestureUid++, svg = svg0.replace(/\bah([LR])\b/g, `ah${u}$1`); return `<figure class="gcard ${cls || ''}"><svg viewBox="0 0 120 86" role="img" aria-label="${esc(t(k))}">${svg}</svg><figcaption><b>${esc(t(k))}</b><span>${esc(t(k + 'D'))}</span></figcaption></figure>`; }).join('');
}
function renderGestureCards() {
  for (const el of document.querySelectorAll('[data-gestures]')) el.innerHTML = gestureCards(el.dataset.gestures);
}
