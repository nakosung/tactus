// ===================== Voice to code: recording and the page =====================
// Beatbox or hum into the mic for 1, 2 or 4 bars, in time with the music, and get code lines back.
// The take works like a loop recording (the same capture and latency correction), with a one-bar count-in of clicks.
// The clicks are a pure 3.8 kHz tone, so a notch takes them back out of what the mic heard. On speakers the music is
// muted while you record (clicks only), as the loop recorder does, so the mic hears only you.

const VX = { take: null, mode: 'beat', bars: 2, result: null, undo: null };
const VX_CLICK = 3800;

function vxChunk(f, l) {
  const tk = VX.take, a = Math.max(f, tk.f0), b = Math.min(f + l.length, tk.f0 + tk.L.length);
  if (b > a) tk.L.set(l.subarray(a - f, b - f), a - tk.f0);
}
async function vxRecord() {
  if (VX.take) { vxCancel(); return; }
  if (LS.take || LS.cal) { vxSay(t('vxBusy'), 'bad'); return; }
  initAudio(); await S.ctx.resume();
  const r = await ensureMic();
  if (r !== 'ok') { vxSay(t(r === 'blocked' ? 'micBlocked' : 'micDenied'), 'bad'); return; }
  await ensureCapture();
  connectCapture('mic'); LS.capOn(true);
  if (!S.playing) togglePlay(true);
  const ctx = S.ctx, sr = ctx.sampleRate, bars = VX.bars, barSec = 1 / S.cps;
  // at least half a bar from now, so the count-in bar is heard whole
  const startC = Math.ceil(S.lastC + 0.5 - 1e-6), pre = 0.12, lat = compSec('mic');
  const t0 = timeOf(startC) + lat;
  VX.take = { mode: VX.mode, startC, bars, barSec, pre, sr, f0: Math.round((t0 - pre) * sr), L: new Float32Array(Math.ceil((pre + bars * barSec + 0.25) * sr)), endT: timeOf(startC + bars) + lat + 0.3, silent: LS.speaker };
  for (let k = (startC - 1) * 4; k < (startC + bars) * 4; k++) click(timeOf(k / 4), VX_CLICK, (k % 4 ? 0.12 : 0.3) * (LS.speaker ? 0.7 : 1));
  if (LS.speaker) { const g = A.out.gain; g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(g.value, ctx.currentTime); g.setTargetAtTime(0, timeOf(startC), 0.004); g.setTargetAtTime(OUT_GAIN, timeOf(startC + bars), 0.01); }
  VX.result = null; vxRender();
}
function vxRestore() { if (VX.take && VX.take.silent && S.ctx) { const g = A.out.gain, now = S.ctx.currentTime; g.cancelScheduledValues(now); g.setTargetAtTime(OUT_GAIN, now, 0.01); } }
function vxCancel() { vxRestore(); VX.take = null; if (!LS.take && LS.capOn) LS.capOn(false); vxRender(); }
// called by the animation loop: finish when the last bar (and the audio still in flight) has arrived
function vxTick(now) {
  const tk = VX.take; if (!tk) return;
  if (!S.playing) { vxCancel(); return; }
  if (now < tk.endT) return;
  VX.take = null; if (!LS.take) LS.capOn(false);
  const x = vxNotch(vxNotch(tk.L, tk.sr, VX_CLICK, 4), tk.sr, VX_CLICK * 2, 4);
  let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  if (pk < 0.01) { vxSay(t('vxQuiet'), 'bad'); vxRender(); return; }
  const key = { root: S.root, scale: S.scale };
  if (tk.mode === 'beat') {
    const r = vxBeat(x, tk.sr, tk.barSec, tk.bars, tk.pre);
    const lines = ['kick', 'snare', 'hat'].filter(k => r.lines[k]).map(k => ({ name: k, pat: vxPattern(r.lines[k], tk.bars, false) }));
    VX.result = { mode: 'beat', lines, hits: r.hits, x, tk };
    vxSay(lines.length ? t('vxBeatDone', { n: r.hits.length }) : t('vxNothing'), lines.length ? 'ok' : 'bad');
  } else {
    const r = vxHum(x, tk.sr, tk.barSec, tk.bars, tk.pre, key);
    const has = r.tokens.some(v => v !== '.' && v !== '_');
    VX.result = { mode: 'hum', lines: has ? [{ name: 'hum', pat: vxPattern(r.tokens, tk.bars, true), params: 'pluck gain .5 delay .15 verb .2' }] : [], hum: r, x, tk };
    vxSay(has ? t('vxHumDone', { k: S.keySrc }) + (r.shift ? ' ' + t('vxShift', { n: r.shift / 12 }) : '') : t('vxNothing'), has ? 'ok' : 'bad');
  }
  vxRender();
}

// ---------- putting the lines into the code ----------
// A line with the same name gets the new pattern and keeps its sound after |; a new line goes at the end of the tracks.
// A new track is added to scenes that list their tracks, so it plays in the song too.
function vxInsert() {
  const res = VX.result; if (!res || !res.lines.length) return;
  VX.undo = srcEl.value;
  let lines = srcEl.value.split('\n');
  const has = n => lines.some(l => new RegExp(`^\\s*${n}\\s`).test(l));
  for (let { name, pat, params } of res.lines) {
    // the song's own drum names: a beatboxed snare goes to its clap if it has no snare
    if (name === 'snare' && !has('snare') && has('clap')) name = 'clap';
    const re = new RegExp(`^(\\s*${name}\\s+)([^|]*?)(\\s*\\|.*)?$`);
    const i = lines.findIndex(l => re.test(l) && !/^\s*\/\//.test(l));
    if (i >= 0) { lines[i] = lines[i].replace(re, (m, a, b, c) => a + pat + (c || '')); continue; }
    let at = lines.length; for (let j = lines.length - 1; j >= 0; j--) if (/^\s*(scene|song)\b/.test(lines[j])) at = j; else if (lines[j].trim() && !/^\s*\/\//.test(lines[j])) break;
    while (at > 0 && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, `${name.padEnd(6)} ${pat}${params ? ' | ' + params : ''}`);
    lines = lines.map(l => {
      const m = /^(\s*scene\s+\S+\s+)([^|]*?)(\s*\|.*)?$/.exec(l);
      if (!m || /\ball\b/.test(m[2]) || new RegExp(`\\b${name}\\b`).test(m[2])) return l;
      return m[1] + m[2] + ' ' + name + (m[3] || '');
    });
  }
  srcEl.value = lines.join('\n');
  evaluate('bar'); render();
  vxSay(t('vxInserted'), 'ok'); vxRender();
}
function vxUndo() { if (VX.undo == null) return; srcEl.value = VX.undo; VX.undo = null; evaluate('bar'); render(); vxSay(t('vxUndone'), 'ok'); vxRender(); }

// ---------- the panel ----------
const vxEl = id => document.getElementById(id);
function vxSay(m, cls = '') { const el = vxEl('vxMsg'); if (el) { el.textContent = m; el.className = 'note vxmsg ' + cls; } }
function vxRender() {
  const rec = vxEl('vxRec'); if (!rec) return;
  rec.textContent = t(VX.take ? 'vxCancel' : 'vxRec'); rec.classList.toggle('on', !!VX.take);
  document.querySelectorAll('#vxMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === VX.mode));
  document.querySelectorAll('#vxBars button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.b === VX.bars));
  const res = VX.result, out = vxEl('vxOut');
  out.hidden = !(res && res.lines.length);
  if (res && res.lines.length) out.innerHTML = res.lines.map(l => `<span class="nmn">${esc(l.name.padEnd(6))}</span> ${esc(l.pat)}${l.params ? ` <span class="pipe">|</span> <span class="in">${esc(l.params)}</span>` : ''}`).join('\n');
  vxEl('vxActs').hidden = !(res && res.lines.length) && VX.undo == null;
  vxEl('vxInsert').hidden = !(res && res.lines.length);
  vxEl('vxUndo').hidden = VX.undo == null;
  vxEl('vxView').hidden = !res;
  if (res) vxDraw(res);
}
// what was heard: the loudness over the take on a beat grid, and on it the hits (beatbox) or the sung pitch and the notes
function vxDraw(res) {
  const cv = vxEl('vxView'), dpr = devicePixelRatio || 1, w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), cs = getComputedStyle(document.documentElement), col = v => cs.getPropertyValue(v).trim();
  const tk = res.tk, total = tk.bars * tk.barSec, X = tt => (tt / total) * w;
  g.clearRect(0, 0, w, h);
  for (let k = 0; k <= tk.bars * 4; k++) { g.fillStyle = col(k % 4 ? '--scr-line' : '--scr-dim'); g.fillRect(Math.round(X(k * tk.barSec / 4)), 0, dpr, h); }
  // loudness
  g.fillStyle = col('--scr-faint'); const n = Math.floor(w / dpr), x = res.x, sr = tk.sr;
  for (let i = 0; i < n; i++) {
    const a = Math.floor((tk.pre + i / n * total) * sr), b = Math.floor((tk.pre + (i + 1) / n * total) * sr);
    let m = 0; for (let j = a; j < b && j < x.length; j += 4) m = Math.max(m, Math.abs(x[j]));
    const v = Math.min(1, Math.sqrt(m) * 1.2) * h * 0.45; g.fillRect(i * dpr, h / 2 - v, dpr, v * 2);
  }
  if (res.mode === 'beat') {
    const kc = { kick: col('--k-orange'), snare: col('--k-blue'), hat: col('--k-yellow') }, row = { kick: 0.78, snare: 0.5, hat: 0.22 };
    for (const hit of res.hits) {
      if (!hit.kind) continue;
      g.fillStyle = kc[hit.kind]; g.beginPath(); g.arc(X(hit.t), h * row[hit.kind], 4.5 * dpr, 0, 7); g.fill();
      g.fillRect(X(hit.step * tk.barSec / 16) - dpr, h * row[hit.kind] - 9 * dpr, 2 * dpr, 18 * dpr);
    }
  } else {
    const hm = res.hum, ms = hm.contour.filter(c => c.m != null).map(c => c.m), lo = Math.min(...ms) - 2, hi = Math.max(...ms) + 2, Y = m => h - (m - lo) / Math.max(1, hi - lo) * h;
    g.fillStyle = col('--scr-fg');
    for (const c of hm.contour) if (c.m != null && c.t >= 0 && c.t < total) g.fillRect(X(c.t), Y(c.m) - dpr, dpr * 1.5, dpr * 2);
    g.fillStyle = col('--k-green'); const step = tk.barSec / hm.per;
    hm.notes.forEach((nt, k) => { if (nt) g.fillRect(X(k * step) + dpr, Y(nt.m + hm.shift) - 3 * dpr, X(step) - 2 * dpr, 6 * dpr); });
  }
}
function vxInit() {
  const box = vxEl('vxBox'); if (!box) return;
  vxEl('vxMode').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b && !VX.take) { VX.mode = b.dataset.m; vxRender(); } });
  vxEl('vxBars').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (b && !VX.take) { VX.bars = +b.dataset.b; vxRender(); } });
  vxEl('vxRec').addEventListener('click', vxRecord);
  vxEl('vxInsert').addEventListener('click', vxInsert);
  vxEl('vxUndo').addEventListener('click', vxUndo);
  vxRender();
}
vxInit();
