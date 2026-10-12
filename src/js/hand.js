// ===================== Tactus hand control (camera) =====================
// Left hand height -> k1, left hand left/right -> k3, right hand height -> k2.
// Right pinch = build-up (release drops on the next downbeat), left pinch = beat repeat,
// fist = breakdown, fast right-hand swipe = next / previous scene.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const H = { on: false, busy: false, lm: null, video: null, stream: null, raf: 0, last: -1, st: { L: null, R: null }, fists: 0, swipeAt: 0, res: null };

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
  if (f.pinch > 0.6 && i > 0.75 && m > 0.75) return 'open';
  // a pinch that no longer qualifies ends; anything else keeps its last pose
  return prev === 'pinch' ? 'open' : prev;
}
const POSE_GESTURE = { L: { pinch: 'rep4', fist: 'break' }, R: { pinch: 'build', fist: 'break' } };
function poseOn(side, pose) {
  const g = POSE_GESTURE[side][pose]; if (!g) return;
  if (g === 'break' && H.fists++ > 0) return;
  gestureOn(g);
}
function poseOff(side, pose) {
  const g = POSE_GESTURE[side][pose]; if (!g) return;
  if (g === 'break' && --H.fists > 0) return;
  H.fists = Math.max(0, H.fists);
  gestureOff(g);
}
function handLost(side) {
  const st = H.st[side];
  if (st) poseOff(side, st.pose);
  H.st[side] = null;
}
const knobMap = v => Math.max(0, Math.min(1, (v - 0.18) / 0.64));
function handUpdate(side, f, now) {
  if (!f) { if (H.st[side] && now - H.st[side].seen > 250) handLost(side); return; }
  let st = H.st[side];
  if (!st) st = H.st[side] = { pose: 'open', cand: 'open', n: 0, sx: f.ux, sy: f.uy, hist: [], seen: now, pinchAt: -1e9 };
  st.seen = now; st.f = f;
  const raw = rawPose(f, st.cand, now, st);
  if (raw === 'pinch') st.pinchAt = now;
  if (raw === st.cand) st.n++; else { st.cand = raw; st.n = 1; }
  if (st.n >= (st.cand === 'fist' ? 6 : 3) && st.cand !== st.pose) { poseOff(side, st.pose); st.pose = st.cand; poseOn(side, st.pose); }
  st.sx += 0.35 * (f.ux - st.sx); st.sy += 0.35 * (f.uy - st.sy);
  if (st.pose !== 'open') { st.hist = []; return; }
  if (side === 'L') { setKnob(0, knobMap(st.sy)); setKnob(2, knobMap(st.sx * 2)); }
  else {
    setKnob(1, knobMap(st.sy));
    st.hist.push({ t: now, x: f.ux });
    while (st.hist.length && now - st.hist[0].t > 220) st.hist.shift();
    const dx = st.hist.length > 2 ? f.ux - st.hist[0].x : 0;
    if (Math.abs(dx) > 0.22 && now - H.swipeAt > 900) { H.swipeAt = now; st.hist = []; swipeScene(dx > 0 ? 1 : -1); }
  }
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

// ---------- preview ----------
function drawHands(res) {
  const cv = $('#handcv'); if (!cv || cv.hidden) return;
  const w = cv.width = cv.clientWidth * devicePixelRatio, h = cv.height = cv.clientHeight * devicePixelRatio;
  const g = cv.getContext('2d');
  g.save(); g.translate(w, 0); g.scale(-1, 1); g.globalAlpha = 0.45; g.drawImage(H.video, 0, 0, w, h); g.restore();
  const css = getComputedStyle(document.documentElement);
  const col = { L: css.getPropertyValue('--sky').trim(), R: css.getPropertyValue('--amber').trim() };
  for (const side of ['L', 'R']) {
    const f = H.res && H.res[side], st = H.st[side];
    if (!f) continue;
    const P = i => [(1 - f.lm[i].x) * w, f.lm[i].y * h];
    g.strokeStyle = col[side]; g.fillStyle = col[side]; g.lineWidth = 2 * devicePixelRatio;
    g.beginPath();
    for (const [a, b] of HAND_LINKS) { const pa = P(a), pb = P(b); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); }
    g.stroke();
    for (let i = 0; i < 21; i++) { const p = P(i); g.beginPath(); g.arc(p[0], p[1], 2.2 * devicePixelRatio, 0, 7); g.fill(); }
    const p0 = P(0);
    g.font = `${11 * devicePixelRatio}px ${css.getPropertyValue('--f-code')}`;
    g.fillText(handLabel(side, st), p0[0] - 30 * devicePixelRatio, p0[1] + 16 * devicePixelRatio);
    if (st && st.f) {
      g.globalAlpha = 0.8; g.font = `${9.5 * devicePixelRatio}px ${css.getPropertyValue('--f-code')}`;
      g.fillText(`pinch ${st.f.pinch.toFixed(2)} · fold ${st.f.fold.map(x => x.toFixed(1)).join(' ')}`, p0[0] - 30 * devicePixelRatio, p0[1] + 29 * devicePixelRatio);
      g.globalAlpha = 1;
    }
  }
}
function handLabel(side, st) {
  if (!st) return '';
  const g = POSE_GESTURE[side][st.pose];
  if (g) return t({ build: 'gBuild', rep4: 'gRep4', break: 'gBreak' }[g]);
  return side === 'L' ? `k1 ${Math.round(S.knobs[0] * 100)} · k3 ${Math.round(S.knobs[2] * 100)}` : `k2 ${Math.round(S.knobs[1] * 100)}`;
}
function syncHandsUI() {
  const b = $('#handsBtn'); if (!b) return;
  b.setAttribute('aria-pressed', H.on);
  b.textContent = t(H.busy ? 'handLoadingShort' : H.on ? 'handsOff' : 'hands');
  b.disabled = H.busy;
  $('#handcv').hidden = !H.on;
  $('#handsMap').hidden = !H.on;
}
