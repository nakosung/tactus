// ===================== Sound preview =====================
// Hear an instrument before using it: from the sound list in the guide, from the autocomplete list, or a whole
// code line (Alt over its name). Stopped, it plays at once. Playing, it waits for the next beat and plays in the
// song's key, chords and tempo, with the music turned down a little so it can be heard in context; Shift turns the
// music off for the preview (a DJ cue). Hovering shows a small waveform; sound needs a click or a key.

const PV = { last: '', lastAt: 0, thumbs: new Map(), card: null };
const PV_SUSTAIN = new Set(['pad', 'swarm', 'choir', 'bowed', 'flute']);
const PV_LOW = new Set(['bass', 'mono', 'acid', 'upright', 'sine']);
const PV_GROUPS = [
  ['sndSynth', ['sine', 'tri', 'saw', 'square', 'supersaw', 'pad', 'bass', 'mono', 'analog', 'wt', 'fmsynth', 'acid', 'pluck', 'bell', 'flute', 'bowed', 'epiano', 'zither']],
  ['sndSampled', ['piano', 'upright', 'vibes', 'harp', 'sax', 'harpsi', 'marimba', 'kalimba', 'dantranh']],
  ['sndGpu', ['swarm', 'choir', 'plate', 'membrane', 'nsax']],
  ['sndDrums', ['kick', 'snare', 'clap', 'hat', 'ohat', 'rim', 'tom', 'ride', 'crash', 'shaker']],
  ['sndPerc', ['asnare', 'ahat', 'aohat', 'atom', 'afloor', 'aride', 'acrash', 'handclap', 'conga', 'bongo', 'cajon', 'cajonslap', 'tamb', 'shake', 'claves', 'cowbell', 'woodblock', 'triangle', 'agogo', 'framedrum', 'darbuka', 'gong']],
  ['sndKorean', ['kung', 'deok', 'buk', 'buktak', 'jing', 'kkwaeng', 'kkwaengm']],
];

// what an instrument plays when previewed: drums a hit and a soft echo of it, low voices root-fifth-octave,
// held voices the current chord for a bar, everything else an arpeggio of the current chord
function pvPhrase(inst, drum) {
  if (drum) return 'x . . . . . .45 .';
  if (PV_SUSTAIN.has(inst)) return '0^7 _ _ _';
  if (PV_LOW.has(inst)) return '0 . 4 . 7 . 4 .';
  return '0 2 4 7 4 2 0 _';
}
function pvDefFor(inst) {
  const drum = isHit(inst);
  // parseLine, not compile: compile resets the document's bus names and seed
  let def = null; try { def = parseLine('pv ' + pvPhrase(inst, drum) + ' | ' + inst); } catch (e) { return null; }
  return def && def.type === 'track' ? { ...def, name: '__pv' } : null;
}

// the events of one bar of def, from pattern bar k, each sent to play(event, bar offset 0..1)
function pvEvents(def, k, play) {
  for (const e of def.pat.q(k, k + 1)) if (e.s >= k - EPS && e.s < k + 1 - EPS && e.v !== '~') play(e, e.s - k);
}
// play one event the way the scheduler would, into strip r (or a bare output when rendering a thumbnail)
function pvPlayEvent(def, e, time, cps, c, r, out) {
  const P = evalParams(def, e.s);
  P._lfos = def.lfos; P._c = c;
  if (r) stripAt(r, P, time);
  if (e.pan !== undefined) P.pan = e.pan;
  const vel = accentOf(e.v) * (P.vel ?? 1) * (e.amp ?? 1), dur = e.d / cps * P.len;
  if (def.kind === 'drum') {
    const raw = e.v.replace(/'+$/, ''), v0 = raw === 'X' ? 1.3 : /^[\d.]+$/.test(raw) ? +raw : 1;
    playDrum(def.inst, time, v0 * vel, P, out);
    return;
  }
  let notes = atomNotes(e.v, S.root, S.scale, Math.round(P.oct), def.fixed ? 0 : progAt(c), (e.tr || 0) + Math.round(P.tr || 0), e.inv);
  if (!notes) return;
  if (notes.length > 1) notes = voiceChord(def, notes, def.opts && def.opts.voicing);
  playNotes(def, notes, time, dur, P, vel, r || { input: out });
}

// the preview channel: its own strip after the music's duck, so the music can step back while it plays
function pvStrip() {
  let r = S.rt.get('__pv');
  if (!r) { r = makeStrip(A.pvIn); S.rt.set('__pv', r); }
  return r;
}
function previewDef(def, key, cue) {
  if (!def) return;
  initAudio(); S.ctx.resume();
  // the first preview may come before the sample kit is decoded: wait for it, then play
  if (!KIT.ready && (SAMPLE_PITCHED.has(def.inst) || SAMPLE_HITS.has(def.inst))) { const l = loadKit(); if (l) { l.then(() => previewDef(def, key + '*', cue)); return; } }
  const ctx = S.ctx, now = ctx.currentTime;
  if (key === PV.last && now - PV.lastAt < 0.35) return;
  PV.last = key; PV.lastAt = now;
  const r = pvStrip(), live = S.playing, cps = live ? S.cps : (S.bpm || 120) / 240;
  // start: the next beat of the song, or right away
  const c0 = live ? Math.ceil(S.lastC * 4 - 1e-6) / 4 : 0, t0 = live ? timeOf(c0) : now + 0.06;
  const k = live ? c0 - patOrigin(c0) : 0, tEnd = t0 + 1 / cps;
  // an earlier preview stops where this one starts
  const g = A.pvIn.gain; g.cancelScheduledValues(now); g.setTargetAtTime(0, now, 0.012); g.setValueAtTime(0, Math.max(now + 0.03, t0 - 0.004)); g.setValueAtTime(1, Math.max(now + 0.031, t0 - 0.003));
  if (live) {
    const d = A.pvDuck.gain; d.cancelScheduledValues(now); d.setValueAtTime(d.value, now);
    d.setTargetAtTime(cue ? 0.0001 : 0.65, t0 - 0.03, 0.02); d.setTargetAtTime(1, tEnd + 0.15, 0.12);
  }
  pvEvents(def, k, (e, off) => pvPlayEvent(def, e, t0 + off / cps, cps, c0 + off, r, r.input));
}
function previewInst(inst, cue) { previewDef(pvDefFor(inst), 'i:' + inst, cue); }
// a code line: the track as it plays now (its parameters, sends and pattern), one bar of it
function previewLine(name, cue) {
  const def = (S.pending && S.pending.state.tracks.get(name)) || S.tracks.get(name);
  if (!def || def.kind === 'loop') return;
  previewDef({ ...def, name: '__pv' }, 'l:' + name + def.line, cue);
}

// ---------- waveform thumbnails, rendered offline ----------
// The voices are written against S.ctx, so for a moment it points at an offline context; nothing else runs then.
async function pvThumb(inst) {
  if (PV.thumbs.has(inst)) return PV.thumbs.get(inst);
  const def = pvDefFor(inst); if (!def) return null;
  if (!KIT.ready && loadKit()) await loadKit();
  const sr = 44100, len = Math.round(sr * 2.6), off = new OfflineAudioContext(2, len, sr);   // full rate: voices set filters up to 18 kHz
  const real = S.ctx, wk = WK.ok, out = off.createGain();
  out.connect(off.destination);
  try {
    S.ctx = off; WK.ok = false;   // worklet voices live in the real context; their JS stand-ins render here
    pvEvents(def, 0, (e, o) => pvPlayEvent(def, e, 0.02 + o * 2, 0.5, o, null, out));
  } finally { S.ctx = real; WK.ok = wk; }
  const buf = await off.startRendering();
  const a = buf.getChannelData(0), b = buf.getChannelData(1), W = 96, env = new Float32Array(W);
  let pk = 1e-6;
  for (let i = 0; i < W; i++) {
    let m = 0; const i0 = Math.floor(i * len / W), i1 = Math.floor((i + 1) * len / W);
    for (let j = i0; j < i1; j++) m = Math.max(m, Math.abs(a[j]), Math.abs(b[j]));
    env[i] = m; pk = Math.max(pk, m);
  }
  for (let i = 0; i < W; i++) env[i] = Math.sqrt(env[i] / pk);   // square root so quiet tails still show
  PV.thumbs.set(inst, env);
  return env;
}
function pvDraw(cv, env) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
  cv.width = w; cv.height = h;
  const x = cv.getContext('2d'), col = getComputedStyle(cv).color;
  x.clearRect(0, 0, w, h); x.fillStyle = col;
  if (!env) return;
  x.beginPath(); x.moveTo(0, h / 2);
  for (let i = 0; i < env.length; i++) x.lineTo(i / (env.length - 1) * w, h / 2 - env[i] * h * 0.46);
  for (let i = env.length - 1; i >= 0; i--) x.lineTo(i / (env.length - 1) * w, h / 2 + env[i] * h * 0.46);
  x.closePath(); x.fill();
}

// ---------- the hover card ----------
function pvCard() {
  if (PV.card) return PV.card;
  const el = document.createElement('div');
  el.className = 'pvcard'; el.hidden = true;
  el.innerHTML = '<b></b><canvas></canvas><span></span>';
  document.body.appendChild(el);
  return (PV.card = el);
}
function pvShow(inst, anchor) {
  const el = pvCard(), rc = anchor.getBoundingClientRect();
  el.querySelector('b').textContent = inst;
  el.querySelector('span').textContent = t(S.playing ? 'pvLive' : 'pvClick');
  el.hidden = false;
  const cw = el.offsetWidth, ch = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(innerWidth - cw - 8, rc.left)) + 'px';
  el.style.top = (rc.bottom + ch + 8 > innerHeight ? rc.top - ch - 6 : rc.bottom + 6) + 'px';
  const cv = el.querySelector('canvas'); pvDraw(cv, PV.thumbs.get(inst));
  el.dataset.inst = inst;
  // thumbnails need the audio engine (and its samples), which starts on the first click or key
  if (!PV.thumbs.has(inst) && S.ctx) pvThumb(inst).then(env => { if (el.dataset.inst === inst && !el.hidden) pvDraw(cv, env); }).catch(() => { });
}
function pvHide() { if (PV.card) PV.card.hidden = true; }

// ---------- where previews start ----------
function pvInit() {
  // the sound list (its own tab)
  const box = document.getElementById('sounds');
  if (box) {
    box.innerHTML = PV_GROUPS.map(([k, list]) => `<div class="sgrp"><h4 data-i18n="${k}">${esc(t(k))}</h4><div>${list.map(n => `<button class="snd" data-inst="${n}">${n}</button>`).join('')}</div></div>`).join('');
    box.addEventListener('click', e => { const b = e.target.closest('.snd'); if (b) previewInst(b.dataset.inst, e.shiftKey); });
    box.addEventListener('pointerover', e => { const b = e.target.closest('.snd'); if (b) pvShow(b.dataset.inst, b); });
    box.addEventListener('pointerout', e => { if (e.target.closest('.snd') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.snd'))) pvHide(); });
  }
  // Alt over a track's name in the code plays one bar of that line
  let altLine = -1;
  srcEl.addEventListener('pointermove', e => {
    if (!e.altKey || e.buttons) { altLine = -1; return; }
    const cs = getComputedStyle(srcEl), rc = srcEl.getBoundingClientRect();
    const line = Math.floor((e.clientY - rc.top - parseFloat(cs.paddingTop) + srcEl.scrollTop) / lineH);
    const col = Math.floor((e.clientX - rc.left - parseFloat(cs.paddingLeft) + srcEl.scrollLeft) / charW);
    const text = srcEl.value.split('\n')[line] || '', m = /^(\s*)([a-zA-Z]\w*)/.exec(text);
    if (!m || GLOBALS.has(m[2]) || col < m[1].length || col > m[0].length) { altLine = -1; return; }
    if (line === altLine) return;
    altLine = line; previewLine(m[2], e.shiftKey);
  });
  srcEl.addEventListener('pointerleave', () => { altLine = -1; });
}
