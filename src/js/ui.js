// ===================== Tactus editor + performance UI =====================
const $ = s => document.querySelector(s);
const srcEl = $('#src'), hlEl = $('#hl'), gutEl = $('#gutter'), statusEl = $('#status');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let autoEval = true, evalTimer = null;

const DEMO = { ko: presetText(PRESETS[0], 'ko'), en: presetText(PRESETS[0], 'en') };
// one colour per track, shared by the gutter lights and the visualizations (the code screen is dark in both themes)
const TRACK_COLORS = ['#ff9a4d', '#a48bff', '#5fd6a4', '#6fb6ff', '#ff6b8e', '#f2c443', '#e58cff', '#9be36a', '#62d9e8', '#ffb6a0'];

// ---------- i18n ----------
function applyI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  syncPlayBtn();
}
function switchLang(other) {
  if (other === LANG || !['ko', 'en'].includes(other)) return;
  const cur = PRESETS.find(p => srcEl.value === presetText(p, LANG));
  if (cur) srcEl.value = presetText(cur, other);
  LANG = other;
  try { localStorage.setItem('pulse-lang', LANG); } catch (e) { }
  applyI18n(); skinLabels(); buildSlots(); buildPresets(); syncHandsUI(); buildChips(); evaluate('bar'); renderPads(true); renderGestureCards();
}
$('#lang').addEventListener('click', () => switchLang(LANG === 'ko' ? 'en' : 'ko'));
// the welcome page shares the language: a switch there, in another tab, switches here too
const onSharedLang = switchLang;

// ---------- evaluation ----------
function evaluate(mode = 'bar', opts = {}) {
  const r = compile(srcEl.value);
  sndApplyCode(r.samples);
  S.errors = r.errors; S.lineNames = r.lineNames;
  S.progGen = r.progGen;
  { const sig = [...r.pads.values()].map(p => p.name + p.key + p.latch + p.src + r.autos.has(p.name)).join('|'); S.pads = r.pads; S.autoNames = new Set(r.autos.keys()); if (sig !== padSig) { padSig = sig; renderPads(); } }
  // a broken line keeps playing its last good version
  const entries = r.order.map(n => [r.tracks.get(n).line, n, r.tracks.get(n)]);
  for (const [line, err] of r.errors) {
    if (err.name && !r.tracks.has(err.name)) {
      const old = S.tracks.get(err.name);
      if (old) { old.line = line; entries.push([line, err.name, old]); }
    }
  }
  entries.sort((a, b) => a[0] - b[0]);
  const tracks = new Map(), order = [];
  let structural = false;
  for (const [line, name, def] of entries) {
    const old = S.tracks.get(name);
    if (old && old !== def && old.patKey === def.patKey) {
      // same rhythm & notes: parameters change right now, no waiting
      old.params = def.params; old.fixed = def.fixed; old.opts = def.opts; old.line = line;
      tracks.set(name, old);
    } else { tracks.set(name, def); if (old !== def) structural = true; }
    order.push(name);
  }
  for (const n of S.tracks.keys()) if (!tracks.has(n)) structural = true;
  let key = r.key ?? { root: S.root, scale: S.scale, src: S.keySrc };
  if (r.scale) key = { root: key.root, scale: r.scale, src: `${NOTE_NAMES[key.root]} ${r.scale}` };
  if (key.root !== S.root || key.scale !== S.scale) structural = true;
  if (r.progSrc !== S.progSrc) structural = true;
  const autoSig = [...r.autos.values()].map(a => a.name + ' ' + a.src).join('\n');
  if (autoSig !== (S.autoSig || '')) structural = true;
  if (r.arrSrc !== S.arrSrc || opts.resetSong) structural = true;
  const newBpm = r.bpm && r.bpm !== S.bpm ? r.bpm : null;
  const deferBpm = newBpm && S.playing && structural && mode === 'phrase';
  if (newBpm && !deferBpm) setBpm(newBpm);
  S.swing = r.swing ?? 0;
  { const m = r.master || 'default'; if (m !== S.masterMode) { S.masterMode = m; S.mixLast = {}; S.masterSat = null; if (S.ctx) applyMaster(m); } }
  mixApply(r);
  { const sp = r.space || 'hall-default'; if (sp !== (S.space || 'hall-default')) { S.space = sp; if (S.ctx) applySpace(sp); } }
  // backdrops: a changed viz line takes over again from any button pressed before
  { const sig = r.viz ? r.viz.list.join(' ') + '/' + r.viz.per : ''; if (sig !== S.vizSig) { S.vizSig = sig; S.vizManual = false; } S.vizCode = r.viz; S.shaders = r.shaders; }
  const state = { tracks, order, autos: r.autos, autoSig, key, prog: r.prog, progSrc: r.progSrc, bpm: deferBpm ? newBpm : null, scenes: r.scenes, song: r.song, arrSrc: r.arrSrc, resetSong: !!opts.resetSong };
  if (S.playing && structural) {
    const applyAt = mode === 'phrase' ? Math.ceil(S.lastC / 4 - 1e-6) * 4 : Math.ceil(S.lastC - 1e-6);
    S.pending = { applyAt, state, mode };
  } else {
    S.pending = null;
    if (opts.resetSong) { S.songMode = true; S.liveScene = null; S.songCue = 0; }
    applyState(state);
  }
  render(); buildArr();
}
let padSig = '';
function scheduleEval() {
  clearTimeout(evalTimer);
  if (autoEval) evalTimer = setTimeout(() => evaluate('bar'), 450);
}

// ---------- highlighting ----------
const INST_SET = new Set([...DRUMS, ...SYNTHS, ...LOOPS, ...Object.keys(SCALES), ...Object.keys(SCALE_ALIAS), 'fixed', 'fast', 'slow', ...VOICINGS, ...ARPS, ...MASTERS, 'every', 'rev', 'inv', 'skip', 'ply', 'r', ...TF_WORDS]);
function hlPattern(text, base, line) {
  let toks;
  try { toks = tokenize(text, base); } catch (e) { return esc(text); }
  let out = '', pos = base, prevTilde = false;
  for (const tk of toks) {
    out += esc(text.slice(pos - base, tk.c0 - base));
    const s = esc(text.slice(tk.c0 - base, tk.c1 - base));
    const gen = prevTilde && tk.t === 'atom' && tk.c0 === pos;
    prevTilde = tk.t === 'rest' && text[tk.c0 - base] === '~';
    if (tk.t === 'atom') out += `<span class="at${gen ? ' gen' : ''}" id="a${line}_${tk.c0}">${s}</span>`;
    else if (prevTilde && /^[a-z]/.test(text[tk.c1 - base] || '')) out += `<span class="at gen">~</span>`;
    else if (tk.t === 'rest') out += `<span class="rs">${s}</span>`;
    else if (tk.t === 'var') out += `<span class="nmn">${s}</span>`;
    else if ('[]<>'.includes(tk.t)) out += `<span class="br">${s}</span>`;
    else out += `<span class="op">${s}</span>`;
    pos = tk.c1;
  }
  return out + esc(text.slice(pos - base));
}
function hlParams(text) {
  return text.replace(/(-?(?:\d+\.?\d*|\.\d+))|(k[1-4])(?=\(|\s|$)|([a-zA-Z]\w*)|([^\s\w.-]+)|(\s+)|(.)/g, (m, num, knob, word, sym) => {
    if (num) return `<span class="nm">${m}</span>`;
    if (knob) return `<span class="kn">${m}</span>`;
    if (word) return `<span class="${INST_SET.has(word) || /^[A-G][#b]?$/.test(word) ? 'in' : PARAMS.includes(word) ? 'pk' : 'wd'}">${m}</span>`;
    if (sym) return `<span class="op">${esc(m)}</span>`;
    return esc(m);
  });
}
function hlFx(text) {
  const bar = text.indexOf('|'), head = bar >= 0 ? text.slice(0, bar) : text, body = bar >= 0 ? text.slice(bar + 1) : '';
  let k = 0;
  const h = head.replace(/(\S+)|(\s+)/g, (m, w) => !w ? m : k++ === 0 ? `<span class="nmn">${esc(w)}</span>` : w === 'latch' || w === 'off' ? `<span class="in">${w}</span>` : `<span class="kn">${esc(w)}</span>`);
  const b = body.replace(/(-?(?:\d+\.?\d*|\.\d+)(?:>-?(?:\d+\.?\d*|\.\d+))?)|([a-zA-Z*][\w.*]*)|(\s+)|(.)/g, (m, num, word) => num ? `<span class="nm">${esc(m)}</span>` : word ? `<span class="${PAD_OPS[word] !== undefined ? 'in' : /^[x.]+$/.test(word) ? 'op' : 'tr'}">${esc(m)}</span>` : esc(m));
  return h + (bar >= 0 ? '<span class="pipe">|</span>' + b : '');
}
function hlArr(text, kind) {
  let first = true, k = 0;
  return text.replace(/(\S+)|(\s+)/g, (m, w) => {
    if (!w) return m;
    if (kind === 'song') { const [n, b] = w.split(':'); return `<span class="sp" id="sp${k++}"><span class="nmn">${esc(n)}</span>${b !== undefined ? `<span class="op">:</span><span class="nm">${esc(b)}</span>` : ''}</span>`; }
    if (first) { first = false; return `<span class="scn-n">${esc(w)}</span>`; }
    if (SCENE_FX.includes(w) || w === 'all') return `<span class="in">${esc(w)}</span>`;
    return `<span class="${w[0] === '-' ? 'rs' : 'tr'}">${esc(w)}</span>`;
  });
}
function hlLine(text, i) {
  const ci = commentAt(text);
  const code = ci >= 0 ? text.slice(0, ci) : text, comment = ci >= 0 ? text.slice(ci) : '';
  let out;
  const m = HEAD_RE.exec(code);
  if (!m) out = esc(code);
  else {
    const name = m[2], base = m[0].length, rest = code.slice(base);
    out = esc(m[1]);
    if (GLOBALS.has(name)) {
      out += `<span class="gl">${esc(m[0].slice(m[1].length))}</span>`;
      const lm = name === 'let' && /^(\s*[a-zA-Z_]\w*\s*=\s*)/.exec(rest);
      if (lm) out += `<span class="nmn">${esc(lm[1])}</span>` + hlPattern(rest.slice(lm[1].length), base + lm[1].length, i);
      else out += name === 'prog' ? hlPattern(rest, base, i) : name === 'scene' || name === 'song' ? hlArr(rest, name) : name === 'fx' ? hlFx(rest) : hlParams(rest);
    } else {
      out += `<span class="nmn">${esc(m[0].slice(m[1].length))}</span>`;
      const bar = rest.indexOf('|');
      if (bar < 0) out += hlPattern(rest, base, i);
      else out += hlPattern(rest.slice(0, bar), base, i) + '<span class="pipe">|</span>' + hlParams(rest.slice(bar + 1));
    }
  }
  if (comment) out += `<span class="cm">${esc(comment)}</span>`;
  const name = S.lineNames.get(i);
  const cls = ['ln'];
  if (S.errors.has(i)) cls.push('err');
  if (name && S.tracks.has(name) && (!audible(name) || !activeIn(curScene(), name))) cls.push('mut');
  const sm = /^\s*scene\s+(\w+)/.exec(code);
  if (sm && S.scenes.size && sm[1] === shownScene) cls.push('scn-live');
  return `<span class="${cls.join(' ')}">${out || ' '}</span>`;
}
function render() {
  const lines = srcEl.value.split('\n');
  hlEl.innerHTML = lines.map(hlLine).join('\n') + '\n ';
  let idx = 0, g = '';
  lines.forEach((ln, i) => {
    const name = S.lineNames.get(i);
    const live = name && (S.tracks.has(name) || (S.pending && S.pending.state.tracks.has(name)));
    if (S.errors.has(i)) g += `<div class="gr bad" title="${esc(S.errors.get(i).msg)}"><span class="dot"></span></div>`;
    else if (live) {
      idx++;
      const m = S.muted.has(name), so = S.solo.has(name);
      const oi = S.order.indexOf(name), col = TRACK_COLORS[(oi < 0 ? idx - 1 : oi) % TRACK_COLORS.length];
      g += `<div class="gr" style="--tc:${col}"><button class="mute${m ? ' off' : ''}${so ? ' solo' : ''}" data-name="${esc(name)}" title="${esc(t('muteBtn', { n: name }))}">${idx <= 9 ? idx : '·'}</button><i class="led" id="led${i}"></i></div>`;
    } else g += '<div class="gr"></div>';
  });
  gutEl.innerHTML = g + '<div class="gr"></div>';
  gutEl.scrollTop = srcEl.scrollTop;
  syncLoopVols();
  updateStatus(); updateKnobLabels(); renderLoops();
  shownPart = -2;
  if (window.VZ) VZ.ver++;
  S.dirty = true;
}
function trackNamesInOrder() { return [...S.lineNames.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]).filter(n => S.tracks.has(n)); }

// ---------- status ----------
function caretLine() { return srcEl.value.slice(0, srcEl.selectionStart).split('\n').length - 1; }
let flashT = null, flashing = false;
function updateStatus() {
  if (flashing) return;
  const li = caretLine();
  let msg, cls = '';
  if (S.errors.has(li)) { msg = t('lineErrKeep', { n: li + 1, m: S.errors.get(li).msg }); cls = 'bad'; }
  else if (S.errors.size) { const [l, e] = S.errors.entries().next().value; msg = t('lineErr', { n: l + 1, m: e.msg }); cls = 'bad'; }
  else {
    const gp = genPreview(li);
    if (gp) { statusEl.className = 'status'; statusEl.innerHTML = `${esc(gp.label)} <span class="gtxt">${esc(gp.txt.length > 180 ? gp.txt.slice(0, 180) + '…' : gp.txt)}</span>`; return; }
    msg = t('hint');
  }
  statusEl.textContent = msg; statusEl.className = 'status ' + cls;
}
function loopMsg(m, cls = 'ok', ms = 2200) {
  statusEl.textContent = m; statusEl.className = 'status ' + cls;
  flashing = true; clearTimeout(flashT);
  flashT = setTimeout(() => { flashing = false; updateStatus(); }, ms);
}
const flashStatus = m => loopMsg(m, 'ok', 1400);
// ---------- generators: preview and bake ----------
function defAtLine(li) {
  const name = S.lineNames.get(li); if (!name) return null;
  return (S.pending && S.pending.state.tracks.get(name)) || S.tracks.get(name) || null;
}
const nowBar = () => (S.playing && S.ctx ? Math.max(0, transport(S.ctx.currentTime)) : 0);
function genPreview(li) {
  const code = stripComment(srcEl.value.split('\n')[li] || '');
  if (/^\s*prog\s+~gen/.test(code) && S.progGen) return { label: t('genNow', { k: 'prog ~gen' }), txt: S.progGen };
  const def = defAtLine(li);
  if (!def || !def.gen || !/~[a-z]/.test(code)) return null;
  const g = genAt(def.gen, nowBar() - patOrigin(nowBar()));
  return { label: t('genNow', { k: '~' + def.gen.kind }) + (def.gen.evolve ? ' ' + t('genGen', { g: g + 1 }) : ''), txt: genText(def.gen, g) };
}
// replace a generator with the notes it is playing right now, so the line can be edited by hand
function bakeLine() {
  const li = caretLine(), v = srcEl.value, lines = v.split('\n'), ln = lines[li];
  const ci = commentAt(ln), code = ci >= 0 ? ln.slice(0, ci) : ln, comment = ci >= 0 ? ln.slice(ci) : '';
  let out = null;
  if (/^\s*prog\s+~gen/.test(code) && S.progGen) out = code.replace(/~gen(\s+\d+)?/, S.progGen);
  else {
    const def = defAtLine(li), hm = HEAD_RE.exec(code);
    if (!def || !def.gen || !hm) { loopMsg(t('bakeNone'), 'bad', 2400); return; }
    const txt = genText(def.gen, genAt(def.gen, nowBar() - patOrigin(nowBar())));
    const base = hm[0].length, bar = code.indexOf('|', base);
    let params = bar >= 0 ? code.slice(bar + 1) : '';
    params = params.replace(/\s*\b(seed|dens|evolve|bars)\s+-?[\d.]+/g, '');
    out = code.slice(0, base) + ' ' + txt + (params.trim() ? '  |' + params.replace(/\s+$/, '') : '');
  }
  let ls = 0; for (let i = 0; i < li; i++) ls += lines[i].length + 1;
  srcEl.setRangeText(out + (comment ? ' ' + comment : ''), ls, ls + ln.length, 'end');
  render(); evaluate('bar'); flashStatus(t('baked'));
}

// ---------- number scrubbing ----------
const NUM_G = /-?(?:\d+\.?\d*|\.\d+)/g;
function numberAt(text, idx) {
  const ls = text.lastIndexOf('\n', idx - 1) + 1;
  let le = text.indexOf('\n', idx); if (le < 0) le = text.length;
  const line = text.slice(ls, le), col = idx - ls;
  NUM_G.lastIndex = 0; let m;
  while ((m = NUM_G.exec(line))) {
    const a = m.index, b = a + m[0].length;
    if (col >= a && col <= b) {
      const prev = line[a - 1] || ' ';
      if (/[a-zA-Z#\^]/.test(prev)) return null;
      return { start: ls + a, end: ls + b, str: m[0] };
    }
  }
  return null;
}
function stepFor(str) {
  const dec = (str.split('.')[1] || '').length;
  if (str.includes('.')) return Math.pow(10, -Math.max(1, dec));
  const a = Math.abs(+str);
  return a >= 1000 ? 100 : a >= 200 ? 10 : 1;
}
function fmt(v, like) {
  const dec = like.includes('.') ? Math.max(1, (like.split('.')[1] || '').length) : 0;
  let s = v.toFixed(dec);
  if (dec && /^-?\./.test(like) && Math.abs(v) < 1) s = s.replace(/^(-?)0\./, '$1.');
  return s;
}
function replaceNum(n, val, keepCaret) {
  const s = fmt(val, n.str);
  srcEl.setRangeText(s, n.start, n.end, 'preserve');
  const caret = Math.min(n.start + (keepCaret ?? 0), n.start + s.length);
  srcEl.setSelectionRange(caret, caret);
  return { start: n.start, end: n.start + s.length, str: s };
}
function nudge(idx, dir, big) {
  const n = numberAt(srcEl.value, idx);
  if (!n) return false;
  const step = stepFor(n.str) * (big ? 10 : 1);
  replaceNum(n, +n.str + dir * step, idx - n.start);
  evaluate('bar');
  return true;
}
let charW = 8.4, lineH = 22;
function measure() {
  const c = document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(srcEl);
  c.font = `${cs.fontSize} ${cs.fontFamily}`;
  charW = c.measureText('0123456789').width / 10;
  lineH = parseFloat(cs.lineHeight) || 22;
}
function idxFromPoint(x, y) {
  const r = srcEl.getBoundingClientRect(), cs = getComputedStyle(srcEl);
  const line = Math.floor((y - r.top - parseFloat(cs.paddingTop) + srcEl.scrollTop) / lineH);
  const col = Math.round((x - r.left - parseFloat(cs.paddingLeft) + srcEl.scrollLeft) / charW - 0.5);
  const lines = srcEl.value.split('\n');
  if (line < 0 || line >= lines.length) return -1;
  let idx = 0; for (let i = 0; i < line; i++) idx += lines[i].length + 1;
  return idx + Math.max(0, Math.min(col, lines[line].length));
}
let drag = null;
srcEl.addEventListener('mousedown', e => {
  if (!e.altKey) return;
  const idx = idxFromPoint(e.clientX, e.clientY);
  const n = idx >= 0 && numberAt(srcEl.value, idx);
  if (!n) return;
  e.preventDefault();
  drag = { x: e.clientX, y: e.clientY, n, v0: +n.str, step: stepFor(n.str), last: 0 };
  document.body.classList.add('scrubbing');
});
window.addEventListener('mousemove', e => {
  if (!drag) return;
  const k = Math.round(((e.clientX - drag.x) - (e.clientY - drag.y)) / 7);
  if (k === drag.last) return;
  drag.last = k;
  drag.n = replaceNum(drag.n, drag.v0 + k * drag.step * (e.shiftKey ? 10 : 1), 0);
  evaluate('bar');
});
window.addEventListener('mouseup', () => { if (drag) { drag = null; document.body.classList.remove('scrubbing'); } });
srcEl.addEventListener('wheel', e => {
  if (!e.altKey) return;
  const idx = idxFromPoint(e.clientX, e.clientY);
  if (idx >= 0 && nudge(idx, e.deltaY < 0 ? 1 : -1, e.shiftKey)) e.preventDefault();
}, { passive: false });

// ---------- autocomplete ----------
const AC_RANGES = { lpf: [300, 8000], mid: [-9, 6], midf: [200, 4000], chorus: [0, 1], phaser: [0, 1], dist: [0, .8], crush: [0, .8], thr: [-36, -6], ratio: [1.5, 8], catk: [1, 50], crel: [40, 400], bright: [.2, .9], slide: [0, 1], acc: [0, 1], hpf: [20, 800], low: [-12, 6], high: [-12, 6], drive: [0, .8], width: [0, 1], vib: [0, 30], cut: [300, 6000], gain: [0, 1], pan: [-1, 1], res: [1, 15], verb: [0, .8], delay: [0, .6], duck: [0, 1], shape: [0, .8], detune: [0, 40], env: [0, 1], oct: [2, 5], len: [.25, 1], atk: [.005, 1], dec: [.05, 1], sus: [0, 1], rel: [.05, 2], tune: [.7, 1.4], slices: [4, 16], vel: [.5, 1.3], nudge: [-30, 30], human: [0, 1], swing: [0, .6], sgrid: [8, 16], comp: [0, 1], rate: [4, 32], tr: [-7, 7], range: [3, 12] };
const AC_QUAL = ['', 'm', '7', 'maj7', 'm7', '9', 'm9', 'maj9', 'sus2', 'sus4', '7sus4', 'dim', 'dim7', 'm7b5', 'aug', '6', 'm6', 'add9', 'madd9', '11', 'm11', '13', '7b9', '7#9', 'mM7', '5'];
const AC_TRACKS = ['kick', 'snare', 'clap', 'hat', 'ohat', 'ride', 'crash', 'shaker', 'rim', 'tom', 'bass', 'keys', 'flute', 'strings', 'gayageum', 'piano', 'vibes', 'sax', 'harp', 'harpsi', 'asnare', 'ahat', 'aride', 'acrash', 'conga', 'bongo', 'cajon', 'tamb', 'gong', 'sub', 'acid', 'lead', 'pad', 'arp', 'pluck', 'stab', 'bell', 'chord', ...LOOPS];
const acEl = document.createElement('div');
acEl.className = 'ac'; acEl.hidden = true; acEl.setAttribute('role', 'listbox');
srcEl.parentNode.appendChild(acEl);
const ac = { items: [], sel: 0, start: 0, end: 0 };
const noteName = m => NOTE_NAMES[mod(m, 12)];
function docNames(re) { const out = []; for (const l of srcEl.value.split('\n')) { const m = re.exec(stripComment(l)); if (m && !out.includes(m[1])) out.push(m[1]); } return out; }
function acItems(pre, word) {
  const before = pre.slice(0, pre.length - word.length);
  const hm = /^\s*([a-zA-Z]\w*)/.exec(pre), head = hm && hm[1];
  if (/^\s*$/.test(before)) {
    const g = ['bpm', 'key', 'scale', 'swing', 'prog', 'scene', 'song', 'master', 'seed', 'fx', 'auto', 'let', 'sample', 'bus', 'space', 'viz', 'shader'].map(n => ({ label: n, ins: n + ' ', desc: t('ac_' + n) }));
    const tr = AC_TRACKS.map(n => ({ label: n, ins: n.padEnd(7) + ' ', desc: instForName(n), inst: LOOPS.includes(n) ? null : instForName(n) }));
    return [...tr, ...g];
  }
  if (word.startsWith('$')) return docNames(/^\s*let\s+([a-zA-Z_]\w*)/).map(n => ({ label: '$' + n, ins: '$' + n + ' ', desc: t('ac_var') }));
  if (head === 'key') return /^\s*key\s+\S+\s+$/.test(before) ? Object.keys(SCALES).concat(['pyeongjo', 'gyemyeonjo']).map(s => ({ label: s, ins: s, desc: t('ac_scaleName') })) : [];
  if (head === 'fx') {
    if (!before.includes('|')) return [];
    return Object.keys(PAD_OPS).map(o => ({ label: o, ins: o + ' ', desc: t('op_' + o) }));
  }
  if (head === 'prog' && word.startsWith('~')) return [{ label: '~gen', ins: '~gen 4', desc: t('genProg') }];
  const isTrack0 = head && !GLOBALS.has(head);
  if (isTrack0 && word.startsWith('~') && /^\s*[a-zA-Z]\w*\s+$/.test(before)) return GEN_KINDS.map(k => ({ label: '~' + k, ins: '~' + k + ' ', desc: t('gen' + k[0].toUpperCase() + k.slice(1)) }));
  { const gm = /~(\w+)\s+$/.exec(before);
    if (isTrack0 && gm && !before.includes('|')) { const st = { beat: BEAT_STYLES, bass: BASS_STYLES, chords: CHORD_STYLES.concat(['tri']), arp: Object.keys(ARP_SHAPES) }[gm[1]] || []; return st.map(x => ({ label: x, ins: x + ' ', desc: t('genStyle') })); } }
  // mix lines: after | the parameters each line takes
  if ((head === 'master' || head === 'bus') && before.includes('|')) {
    const bn = (/^\s*bus\s+(\w+)/.exec(pre) || [])[1];
    const list = head === 'master' ? MASTER_PARAMS : bn === 'verb' ? VERB_PARAMS : bn === 'delay' ? DELAY_PARAMS : BUS_PARAMS;
    if (list.includes((/(\S+)\s+$/.exec(before) || [])[1])) return [];
    return list.map(n => ({ label: n, ins: n + ' ', desc: t('p_' + n) }));
  }
  if (head === 'master') return MASTERS.map(m => ({ label: m, ins: m, desc: t('ac_master_' + m) }));
  if (head === 'space') return SPACES_LIST.map(m => ({ label: m, ins: m, desc: t('ac_space') }));
  if (head === 'scale') return Object.keys(SCALES).concat(['pyeongjo', 'gyemyeonjo']).map(s => ({ label: s, ins: s, desc: t('ac_scaleName') }));
  if (head === 'song') return docNames(/^\s*scene\s+(\w+)/).map(n => ({ label: n, ins: n + ':', desc: t('ac_sceneRef') }));
  if (head === 'scene') {
    if (!/^\s*scene\s+\S+\s+/.test(before)) return [];
    const names = docNames(/^\s*([a-zA-Z]\w*)/).filter(n => !GLOBALS.has(n));
    const base = [...names, ...LOOPS.filter(l => !names.includes(l))];
    const items = word.startsWith('-') ? base.map(n => ({ label: '-' + n, ins: '-' + n + ' ', desc: t('ac_exclude') }))
      : [...base.map(n => ({ label: n, ins: n + ' ', desc: t('ac_track') })), { label: 'all', ins: 'all ', desc: t('ac_all') },
        ...SCENE_FX.map(f => ({ label: f, ins: f + ' ', desc: t('ac_' + f) }))];
    if (before.includes('|')) return [];
    return items;
  }
  const isTrack = head && !GLOBALS.has(head);
  if ((head === 'prog' || (isTrack && !before.includes('|'))) && /^[A-G][#b]?/.test(word)) {
    const root = /^[A-G][#b]?/.exec(word)[0];
    return AC_QUAL.map(q => { const c = parseChord(root + q); return c && { label: root + q, ins: root + q, desc: c.tones.map(x => noteName(c.root + x)).join(' ') }; }).filter(Boolean);
  }
  if (isTrack && before.includes('|')) {
    const prev = (/(\S+)\s+$/.exec(before) || [])[1];
    if (prev === 'every') return [2, 4, 8].map(n => ({ label: String(n), ins: n + ' ', desc: t('ac_every') }));
    if (/^\d+$/.test(prev) && /every\s+\d+\s+$/.test(before)) return ['rev', 'inv', 'skip', 'fast 2', 'ply 2', '+2', '-2'].map(n => ({ label: n, ins: n + ' ', desc: t('ac_everyFn') }));
    if (PARAMS.includes(prev)) {
      const [lo, hi] = AC_RANGES[prev] || [0, 1];
      return [1, 2, 3, 4].map(k => ({ label: `k${k}(${lo},${hi})`, ins: `k${k}(${lo},${hi}) `, desc: t('ac_knob', { k }) }))
        .concat([{ label: `${lo}~${hi}/8`, ins: `${lo}~${hi}/8 `, desc: t('ac_lfo') }, { label: `rand(${lo},${hi})`, ins: `rand(${lo},${hi}) `, desc: t('ac_rand') }, { label: `perlin(${lo},${hi},2)`, ins: `perlin(${lo},${hi},2) `, desc: t('ac_perlin') }]);
    }
    return PARAMS.filter(n => !RETURN_ONLY.includes(n)).map(n => ({ label: n, ins: n + ' ', desc: t('p_' + n) }))
      .concat(docNames(/^\s*bus\s+([a-zA-Z]\w*)/).filter(n => n !== 'verb' && n !== 'delay').map(n => ({ label: n, ins: n + ' ', desc: t('ac_send') })))
      .concat([...SYNTHS, ...DRUMS, ...USER_SOUNDS.keys(), ...CODE_SOUNDS.keys()].map(n => ({ label: n, ins: n + ' ', desc: soundOf(n) ? t('sndMine') : t('ac_inst'), inst: n })), LOOPS.map(n => ({ label: n, ins: n + ' ', desc: t('ac_inst') })))
      .concat(['fixed', 'fast', 'slow', 'every'].map(n => ({ label: n, ins: n + ' ', desc: t('ac_' + n) })))
      .concat(TF_WORDS.map(n => ({ label: n, ins: n + ' ', desc: t('tf_' + n) })))
      .concat(VOICINGS.map(n => ({ label: n, ins: n + ' ', desc: t('ac_voicing') })))
      .concat(ARPS.map(n => ({ label: n, ins: n + ' ', desc: t('ac_arp') })));
  }
  return [];
}
function acUpdate(force) {
  const v = srcEl.value, pos = srcEl.selectionStart;
  if (pos !== srcEl.selectionEnd) return acClose();
  const ls = v.lastIndexOf('\n', pos - 1) + 1, pre = v.slice(ls, pos);
  if (commentAt(pre) >= 0) return acClose();
  const wm = /\$\w*$/.exec(pre) || /~[a-z]*$/.exec(pre) || /-?[A-Za-z_][\w#]*$/.exec(pre) || /-$/.exec(pre);
  const word = wm ? wm[0] : '';
  if (!word && !force) return acClose();
  const items = acItems(pre, word).filter(it => it.label.startsWith(word) && it.label !== word).slice(0, 30);
  if (!items.length) return acClose();
  ac.items = items; ac.sel = 0; ac.nav = false; ac.start = pos - word.length; ac.end = pos;
  acEl.innerHTML = items.map((it, i) => `<div class="ac-i${i ? '' : ' sel'}" role="option" data-i="${i}"><code>${esc(it.label)}</code><span>${esc(it.desc || '')}</span>${it.inst ? `<b class="pv" title="${esc(t('pvClick'))}">▶ ${esc(t('pvAc'))}</b>` : ''}</div>`).join('');
  const cs = getComputedStyle(srcEl), line = v.slice(0, ls).split('\n').length - 1, col = pre.length - word.length;
  const left = parseFloat(cs.paddingLeft) + col * charW - srcEl.scrollLeft;
  const top = parseFloat(cs.paddingTop) + (line + 1) * lineH - srcEl.scrollTop + 2;
  acEl.hidden = false;
  const maxLeft = srcEl.clientWidth - acEl.offsetWidth - 8;
  acEl.style.left = Math.max(4, Math.min(left, maxLeft)) + 'px';
  acEl.style.top = (top + acEl.offsetHeight > srcEl.clientHeight ? top - lineH - acEl.offsetHeight - 4 : top) + 'px';
}
function acClose() { acEl.hidden = true; ac.items = []; pvHide(); }
function acMove(d) {
  ac.sel = mod(ac.sel + d, ac.items.length);
  acEl.querySelectorAll('.ac-i').forEach((el, i) => el.classList.toggle('sel', i === ac.sel));
  const el = acEl.children[ac.sel]; if (el) el.scrollIntoView({ block: 'nearest' });
  // stepping through instruments with the arrows plays each one
  const it = ac.items[ac.sel];
  if (it && it.inst && el) { previewInst(it.inst); pvShow(it.inst, el); } else pvHide();
}
function acAccept(i = ac.sel) {
  const it = ac.items[i]; if (!it) return;
  srcEl.setRangeText(it.ins, ac.start, ac.end, 'end');
  acClose(); render(); scheduleEval();
  if (/[: ]$/.test(it.ins)) acUpdate(true);
}
acEl.addEventListener('mousedown', e => {
  const r = e.target.closest('.ac-i'); if (!r) return; e.preventDefault();
  const it = ac.items[+r.dataset.i];
  if (e.target.closest('.pv') && it && it.inst) { previewInst(it.inst, e.shiftKey); return; }
  acAccept(+r.dataset.i);
});
acEl.addEventListener('pointerover', e => { const r = e.target.closest('.ac-i'), it = r && ac.items[+r.dataset.i]; if (it && it.inst) pvShow(it.inst, r); });
acEl.addEventListener('pointerleave', pvHide);
srcEl.addEventListener('blur', () => setTimeout(acClose, 100));
srcEl.addEventListener('click', acClose);
srcEl.addEventListener('scroll', acClose);

// ---------- editor keys ----------
function toggleComment() {
  const v = srcEl.value, a = srcEl.selectionStart, b = srcEl.selectionEnd;
  const ls = v.lastIndexOf('\n', a - 1) + 1;
  let le = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b); if (le < 0) le = v.length;
  const block = v.slice(ls, le).split('\n');
  const allC = block.every(l => /^\s*\/\//.test(l) || !l.trim());
  const nb = block.map(l => !l.trim() ? l : allC ? l.replace(/^(\s*)\/\/ ?/, '$1') : '// ' + l).join('\n');
  srcEl.setRangeText(nb, ls, le, 'select');
  evaluate('bar');
}
srcEl.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (!acEl.hidden) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ac.nav = true; acMove(e.key === 'ArrowDown' ? 1 : -1); return; }
    // Tab always accepts; Enter only after picking with the arrows, so typing a new line never gets hijacked
    if ((e.key === 'Tab' || (e.key === 'Enter' && ac.nav)) && !mod && !e.shiftKey) { e.preventDefault(); acAccept(); return; }
    if (e.key === 'Enter') acClose();
    if (e.key === 'Escape') { e.preventDefault(); acClose(); return; }
  }
  if (mod && e.code === 'Space') { e.preventDefault(); acUpdate(true); return; }
  if (mod && e.key === 'Enter') { e.preventDefault(); evaluate(e.shiftKey ? 'phrase' : 'bar'); flashStatus(t(e.shiftKey ? 'queuedPhrase' : 'queuedBar')); return; }
  if (mod && (e.key === '/' || e.code === 'Slash')) { e.preventDefault(); toggleComment(); return; }
  if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); bakeLine(); return; }
  if (mod && e.key === '.') { e.preventDefault(); togglePlay(false); return; }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    nudge(srcEl.selectionStart, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
    return;
  }
  if (e.key === 'Tab' && !mod) { e.preventDefault(); srcEl.setRangeText('  ', srcEl.selectionStart, srcEl.selectionEnd, 'end'); render(); scheduleEval(); return; }
  if (e.key === 'Escape') { e.preventDefault(); srcEl.blur(); return; }
});
srcEl.addEventListener('input', e => {
  render(); scheduleEval();
  if (e.inputType === 'insertText' && /[\w#\-~]/.test(e.data || '')) acUpdate(false); else if (e.inputType !== 'insertText' || (e.data && /\s/.test(e.data))) acClose();
});
srcEl.addEventListener('scroll', () => { hlEl.scrollTop = srcEl.scrollTop; hlEl.scrollLeft = srcEl.scrollLeft; gutEl.scrollTop = srcEl.scrollTop; });
['keyup', 'click'].forEach(ev => srcEl.addEventListener(ev, updateStatus));

gutEl.addEventListener('click', e => {
  const b = e.target.closest('.mute'); if (!b) return;
  const n = b.dataset.name;
  if (e.shiftKey) toggleSet(S.solo, n); else toggleSet(S.muted, n);
  render();
});
function toggleSet(set, v) { set.has(v) ? set.delete(v) : set.add(v); }

// ---------- performance keys ----------
const KEY_CODE = k => (/^[A-Z]$/.test(k) ? 'Key' + k : { ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon' }[k]);
const padByCode = code => { for (const p of S.pads.values()) if (p.key && KEY_CODE(p.key) === code) return p.name; return null; };
const RKEYS = { KeyQ: 0, KeyW: 1, KeyE: 2, KeyR: 3 };
const SKEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];
const codeHeld = new Map();
window.addEventListener('keydown', e => {
  const inEditor = e.target === srcEl;
  if (inEditor && !e.altKey) return;
  if (e.target.closest && e.target.closest('input,select')) return;
  if (!inEditor && e.target.closest && e.target.closest('button,[role=slider]') && (e.code === 'Space' || e.code === 'Enter')) return;
  if (e.ctrlKey || e.metaKey) return;
  const g = padByCode(e.code);
  if (g) { e.preventDefault(); if (!e.repeat) { codeHeld.set(e.code, g); gestureOn(g); } return; }
  if (e.code in RKEYS) { e.preventDefault(); if (!e.repeat) recToggle(RKEYS[e.code]); return; }
  if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && S.song) { e.preventDefault(); if (!e.repeat) skipPart(e.code === 'BracketRight' ? 1 : -1); return; }
  if (SKEYS.includes(e.code) && S.scenes.size) {
    e.preventDefault(); if (e.repeat) return;
    const name = [...S.scenes.keys()][SKEYS.indexOf(e.code)];
    if (name) launchScene(name, e.shiftKey ? 'bar' : 'phrase');
    return;
  }
  if (/^Digit[1-9]$/.test(e.code)) {
    e.preventDefault(); if (e.repeat) return;
    const n = trackNamesInOrder()[+e.code.slice(5) - 1];
    if (n) { toggleSet(e.shiftKey ? S.solo : S.muted, n); render(); }
    return;
  }
  if (inEditor) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.code === 'KeyT') { e.preventDefault(); tap(); }
  else if (e.code === 'Escape' || e.code === 'Enter') { e.preventDefault(); srcEl.focus(); }
});
window.addEventListener('keyup', e => { const g = codeHeld.get(e.code); if (g) { codeHeld.delete(e.code); gestureOff(g); } });
window.addEventListener('blur', () => { for (const [, g] of codeHeld) gestureOff(g); codeHeld.clear(); });

// ---------- pads (built from the fx lines) ----------
const padsEl = $('#pads');
const PAD_I18N = { filter: 'gFilter', build: 'gBuild', rep4: 'gRep4', rep16: 'gRep16', break: 'gBreak', throw: 'gThrow', wash: 'gWash', gate: 'gGate', crush: 'gCrush', kill: 'gKill', echo: 'gEcho', fill: 'gFill', freeze: 'gFreeze', rep8: 'gRep8', up: 'gUp', drop: 'gDrop' };
const PAD_CAT = { lp: 'tone', hp: 'tone', res: 'tone', kill: 'tone', crush: 'tone', repeat: 'rhythm', gate: 'rhythm', riser: 'struct', mute: 'struct', only: 'struct', fill: 'struct', scene: 'struct', impact: 'struct', swell: 'struct', down: 'struct', throw: 'space', echo: 'space', verb: 'space', freeze: 'space', set: 'mod', pitch: 'mod' };
function renderPads() {
  const list = [...S.pads.values()];
  padsEl.innerHTML = list.map(p => {
    const k = p.builtin && PAD_I18N[p.name];
    const first = p.acts.find(a => a.op !== 'in');
    const auto = S.autoNames && S.autoNames.has(p.name);
    return `<button class="pad" data-g="${esc(p.name)}" data-cat="${first ? PAD_CAT[first.op] : 'tone'}" title="${auto ? esc(t('padAuto')) + '\n' : ''}fx ${esc(p.name)} | ${esc(p.src)}"><i class="lamp"></i>${auto ? '<em class="autob">auto</em>' : ''}${p.key ? `<kbd>${esc(p.key)}</kbd>` : ''}${p.latch ? `<em class="latch">${esc(t('latch'))}</em>` : ''}<b>${esc(k ? t(k) : p.name)}</b><span>${esc(k ? t(k + 'D') : p.src)}</span></button>`;
  }).join('');
  S.dirty = true;
}
let padPtr = null;
padsEl.addEventListener('pointerdown', e => { const p = e.target.closest('.pad'); if (!p) return; e.preventDefault(); p.setPointerCapture(e.pointerId); padPtr = p.dataset.g; gestureOn(padPtr); });
const padRelease = () => { if (padPtr) { gestureOff(padPtr); padPtr = null; } };
padsEl.addEventListener('pointerup', padRelease); padsEl.addEventListener('pointercancel', padRelease); padsEl.addEventListener('lostpointercapture', padRelease);
padsEl.addEventListener('keydown', e => { const p = e.target.closest('.pad'); if (p && (e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); e.stopPropagation(); gestureOn(p.dataset.g); } });
padsEl.addEventListener('keyup', e => { const p = e.target.closest('.pad'); if (p && (e.key === ' ' || e.key === 'Enter')) { e.stopPropagation(); gestureOff(p.dataset.g); } });
// write the built-in pads into the code so they can be changed
$('#padCode').addEventListener('click', () => {
  const have = new Set([...srcEl.value.matchAll(/^\s*fx\s+(\w+)/gm)].map(m => m[1]));
  const add = DEFAULT_PAD_SRC.filter(l => !have.has(l.split(/\s+/)[1]));
  if (!add.length) { flashStatus(t('padCodeHave')); return; }
  srcEl.value = srcEl.value.replace(/\s*$/, '') + '\n\n' + t('padCodeHead') + '\n' + add.join('\n') + '\n';
  srcEl.scrollTop = srcEl.scrollHeight; render(); evaluate('bar'); loopMsg(t('padCodeDone'), 'ok', 3200);
});

// ---------- control surface tabs ----------
const TABS = ['perform', 'compose', 'loops', 'guide'];
function showTab(name) {
  for (const n of TABS) { $('#tab-' + n).setAttribute('aria-selected', n === name); $('#pane-' + n).hidden = n !== name; }
  try { localStorage.setItem('pulse-tab', name); } catch (e) { }
}
TABS.forEach(n => $('#tab-' + n).addEventListener('click', () => showTab(n)));
$('.tabs').addEventListener('keydown', e => {
  const i = TABS.findIndex(n => $('#tab-' + n).getAttribute('aria-selected') === 'true');
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
  e.preventDefault(); const n = TABS[mod(i + d, TABS.length)]; showTab(n); $('#tab-' + n).focus();
});
$('#composeBtn').addEventListener('click', () => { showTab('compose'); $('#cmpGo').focus(); });

// ---------- GPU status and benchmark ----------
function syncGpu() {
  const el = $('#gpuState'); if (!el) return;
  const st = GPU.state;
  el.textContent = st === 'ok' ? GPU.name + ' · ' + t('gpuOn') : st === 'loading' ? t('gpuLoading') : st === 'off' ? t('gpuOffShort') : t('gpuIdle');
  el.className = 'gpu-state' + (st === 'ok' ? ' ok' : '');
  el.title = GPU.err || '';
}
$('#gpuBench').addEventListener('click', async () => {
  const b = $('#gpuBench'), out = $('#gpuResult');
  b.disabled = true; out.hidden = false; out.textContent = t('gpuBenchRun');
  await new Promise(r => setTimeout(r, 30));
  try {
    const r = await gpuBench(), f = x => Math.round(x).toLocaleString();
    out.innerHTML = r.gpuMs != null
      ? t('gpuBenchRes', { p: r.partials.toLocaleString(), s: r.seconds, g: `<b>${f(r.gpuMs)} ms</b>`, c: `<b>${f(r.cpuMs)} ms</b>`, x: `<b>${(r.cpuMs / r.gpuMs).toFixed(0)}×</b>` })
      : t('gpuBenchCpu', { p: r.partials.toLocaleString(), s: r.seconds, c: `<b>${f(r.cpuMs)} ms</b>`, e: esc(r.err || 'WebGPU') });
  } catch (e) { out.textContent = String(e.message || e); }
  b.disabled = false; syncGpu();
});

// ---------- compose ----------
const STYLE_NAMES = { house: 'House', techno: 'Techno', dnb: 'DnB', lofi: 'Lo-fi', trance: 'Trance', synthwave: 'Synthwave', ambient: 'Ambient', jazz: 'Jazz' };
const cmp = { style: 'house', prev: null };
function buildChips() {
  $('#cmpStyles').innerHTML = COMPOSE_LIST.map(s => `<button class="chip" data-s="${s}" aria-pressed="${s === cmp.style}">${STYLE_NAMES[s] || s}</button>`).join('');
}
$('#cmpStyles').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; cmp.style = b.dataset.s; buildChips(); });
function composeNow() {
  const seed = Math.max(0, Math.min(999999, Math.round(+$('#cmpSeed').value || 0)));
  $('#cmpSeed').value = seed;
  cmp.prev = srcEl.value; $('#cmpUndo').disabled = false;
  srcEl.value = composeSong(cmp.style, seed, LANG); srcEl.scrollTop = 0;
  for (const n of [...S.muted]) if (!n.startsWith('loop')) S.muted.delete(n);
  S.solo.clear();
  const live = S.playing;
  evaluate(live ? 'phrase' : 'bar', { resetSong: true }); buildPresets();
  loopMsg(t(live && S.pending ? 'cmpQueued' : 'cmpDone', { s: STYLE_NAMES[cmp.style], n: seed }), 'ok', 3200);
}
$('#cmpGo').addEventListener('click', composeNow);
$('#cmpDice').addEventListener('click', () => { $('#cmpSeed').value = 1 + Math.floor(Math.random() * 9999); composeNow(); });
$('#cmpUndo').addEventListener('click', () => {
  if (cmp.prev == null) return;
  srcEl.value = cmp.prev; cmp.prev = null; $('#cmpUndo').disabled = true;
  evaluate(S.playing ? 'phrase' : 'bar', { resetSong: true }); buildPresets(); flashStatus(t('cmpUndone'));
});

// ---------- transport ----------
const playBtn = $('#play');
function syncPlayBtn() {
  playBtn.classList.toggle('on', S.playing);
  playBtn.setAttribute('aria-label', t(S.playing ? 'stop' : 'play'));
  playBtn.querySelector('span').textContent = t(S.playing ? 'stop' : 'play');
}
function togglePlay(force) {
  const want = force ?? !S.playing;
  if (want && !S.playing) { evaluate('bar'); play(); }
  else if (!want && S.playing) stop();
  syncPlayBtn(); renderLoops();
}
playBtn.addEventListener('click', () => togglePlay());
const taps = [];
function tap() {
  const tm = performance.now();
  if (taps.length && tm - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(tm); if (taps.length > 6) taps.shift();
  if (taps.length >= 3) writeBpm(Math.round(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1))));
  const tb = $('#tap'); tb.classList.remove('hit'); void tb.offsetWidth; tb.classList.add('hit');
}
function writeBpm(b) {
  b = Math.max(40, Math.min(240, b));
  const v = srcEl.value, re = /^(\s*bpm\s+)(-?[\d.]+)/m;
  srcEl.value = re.test(v) ? v.replace(re, `$1${b}`) : `bpm ${b}\n` + v;
  setBpm(b); render();
}
$('#tap').addEventListener('click', tap);
$('#auto').addEventListener('click', e => {
  autoEval = !autoEval; e.currentTarget.setAttribute('aria-pressed', autoEval);
  flashStatus(t(autoEval ? 'autoOn' : 'autoOff'));
});
$('#bpmbox').addEventListener('wheel', e => { e.preventDefault(); writeBpm(S.bpm + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });

// ---------- knobs ----------
const knobEls = [...document.querySelectorAll('.knob')];
function drawKnob(i) {
  const el = knobEls[i], v = S.knobs[i];
  el.querySelector('.arc').style.strokeDasharray = `${(94.25 * v).toFixed(2)} 200`;
  el.querySelector('.needle').setAttribute('transform', `rotate(${-135 + v * 270} 28 28)`);
  el.querySelector('.kv').textContent = Math.round(v * 100);
  el.setAttribute('aria-valuenow', Math.round(v * 100));
}
function setKnob(i, v) { S.knobs[i] = Math.max(0, Math.min(1, v)); drawKnob(i); liveKnob(i); }
knobEls.forEach((el, i) => {
  let k = null;
  el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.focus(); k = { y: e.clientY, v: S.knobs[i] }; });
  el.addEventListener('pointermove', e => { if (k) setKnob(i, k.v + (k.y - e.clientY) / 160); });
  el.addEventListener('pointerup', () => k = null);
  el.addEventListener('dblclick', () => setKnob(i, 0.5));
  el.addEventListener('wheel', e => { e.preventDefault(); setKnob(i, S.knobs[i] + (e.deltaY < 0 ? 0.03 : -0.03)); }, { passive: false });
  el.addEventListener('keydown', e => {
    const d = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key];
    if (d) { e.preventDefault(); e.stopPropagation(); setKnob(i, S.knobs[i] + d); }
  });
  drawKnob(i);
});
function updateKnobLabels() {
  const uses = [[], [], [], []];
  srcEl.value.split('\n').forEach(l => {
    const code = stripComment(l), m = HEAD_RE.exec(code);
    if (!m) return;
    const re = /([a-z]+)\s+k([1-4])\b/g; let x;
    while ((x = re.exec(code))) uses[+x[2] - 1].push(`${m[2]}·${x[1]}`);
  });
  knobEls.forEach((el, i) => { el.querySelector('.kl').textContent = uses[i].length ? uses[i].join(', ') : t('knobEmpty', { i: i + 1 }); });
}

// ---------- loop station UI ----------
const slotsEl = $('#slots');
function buildSlots() {
  slotsEl.innerHTML = LS.slots.map((s, i) => `
    <div class="slot" data-i="${i}">
      <button class="rec" title="${esc(t('recTitle'))}" aria-label="${esc(t('recTitle'))} ${s.name}"><i></i></button>
      <div class="sl-main"><div class="sl-top"><b>${s.name}</b><kbd>${'QWER'[i]}</kbd><span class="sl-state"></span></div><canvas class="wave"></canvas></div>
      <select class="bars" title="${esc(t('barsTitle'))}" aria-label="${esc(t('barsTitle'))}">${[1, 2, 4, 8].map(b => `<option value="${b}"${b === s.sel ? ' selected' : ''}>${b}</option>`).join('')}</select>
      <button class="sm mute" title="${esc(t('muteTitle'))}">M</button>
      <button class="sm undo" title="${esc(t('undoTitle'))}" aria-label="${esc(t('undoTitle'))}">↶</button>
      <button class="sm clear" title="${esc(t('clearTitle'))}" aria-label="${esc(t('clearTitle'))}">×</button>
    </div>`).join('');
  renderLoops();
}
slotsEl.addEventListener('click', e => {
  const row = e.target.closest('.slot'); if (!row) return;
  const i = +row.dataset.i, s = LS.slots[i];
  if (e.target.closest('.rec')) recToggle(i);
  else if (e.target.closest('.mute')) { toggleSet(S.muted, s.name); syncLoopVols(); render(); }
  else if (e.target.closest('.undo')) undoSlot(i);
  else if (e.target.closest('.clear')) clearSlot(i);
});
slotsEl.addEventListener('change', e => {
  const row = e.target.closest('.slot'); if (row && e.target.matches('.bars')) LS.slots[+row.dataset.i].sel = +e.target.value;
});
slotsEl.addEventListener('dragover', e => {
  const row = e.target.closest('.slot'); if (!row) return;
  e.preventDefault(); slotsEl.querySelectorAll('.slot').forEach(r => r.classList.toggle('drop', r === row));
});
slotsEl.addEventListener('dragleave', e => { if (!slotsEl.contains(e.relatedTarget)) slotsEl.querySelectorAll('.slot').forEach(r => r.classList.remove('drop')); });
slotsEl.addEventListener('drop', e => {
  const row = e.target.closest('.slot'); slotsEl.querySelectorAll('.slot').forEach(r => r.classList.remove('drop'));
  if (!row) return;
  e.preventDefault();
  const f = e.dataTransfer.files[0]; if (f) loadIntoSlot(+row.dataset.i, f);
});
$('#file').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const i = Math.max(0, LS.slots.findIndex(s => !s.bufs));
  loadIntoSlot(i, f); e.target.value = '';
});
$('#export').addEventListener('click', exportZip);
function setSource(src) {
  LS.source = src;
  $('#srcMic').setAttribute('aria-pressed', src === 'mic'); $('#srcOut').setAttribute('aria-pressed', src === 'out');
}
$('#srcMic').addEventListener('click', async () => {
  initAudio(); S.ctx.resume();
  const r = await ensureMic();
  if (r === 'ok') setSource('mic');
  else { setSource('out'); loopMsg(t(r === 'blocked' ? 'micBlocked' : 'micDenied'), 'bad', 7000); }
});
$('#srcOut').addEventListener('click', () => setSource('out'));
$('#speaker').addEventListener('change', e => { LS.speaker = e.target.checked; });
$('#handsBtn').addEventListener('click', handsToggle);
$('#calAuto').addEventListener('click', calibrateAuto);
$('#calClap').addEventListener('click', calibrateClap);
$('#latency').addEventListener('change', e => { LS.latencyMs = Math.max(-200, Math.min(200, +e.target.value || 0)); });

function slotStateText(s) {
  const tk = LS.take;
  if (tk && tk.slot === s) return S.lastC < tk.startC ? t('slotArmed') : t('slotRec');
  if (!s.bufs) return t('slotEmpty');
  const b = s.bars === 1 ? t('barsN1') : t('barsN', { n: s.bars });
  return loopUsers(s).chop ? `${b} · ${t('slotChop')}` : b;
}
function renderLoops() {
  setSource(LS.source);
  const parts = [];
  if (LS.rtt != null) parts.push(`RTT ${Math.round(LS.rtt * 1000)}ms`);
  if (LS.clap.speaker != null) parts.push(`${t('modeSpeaker')} ${Math.round(LS.clap.speaker * 1000)}ms`);
  if (LS.clap.phones != null) parts.push(`${t('modePhones')} ${Math.round(LS.clap.phones * 1000)}ms`);
  $('#calInfo').textContent = parts.length ? t('calInfo', { v: parts.join(' · ') }) : '';
  $('#calAuto').disabled = $('#calClap').disabled = !!LS.cal;
  slotsEl.querySelectorAll('.slot').forEach(row => {
    const s = LS.slots[+row.dataset.i], tk = LS.take;
    const armed = tk && tk.slot === s && S.lastC < tk.startC, rec = tk && tk.slot === s && !armed;
    row.classList.toggle('armed', !!armed); row.classList.toggle('rec-on', !!rec); row.classList.toggle('full', !!s.bufs);
    row.querySelector('.sl-state').textContent = slotStateText(s);
    row.querySelector('.mute').classList.toggle('off', S.muted.has(s.name));
    row.querySelector('.undo').disabled = !s.prev && !(tk && tk.slot === s);
    row.querySelector('.clear').disabled = !s.bufs && !(tk && tk.slot === s);
    row._dirty = true;
  });
}
function slotPeaks(s, n) {
  if (s.peaks && s.peaks.length === n) return s.peaks;
  const p = new Float32Array(n);
  if (s.bufs && s.bufs.length && s.bufs.every(Boolean)) {
    const flat = [];
    for (const b of s.bufs) { const d = b.getChannelData(0); for (let j = 0; j < d.length; j += 64) { let m = 0; for (let k = j; k < Math.min(j + 64, d.length); k += 4) m = Math.max(m, Math.abs(d[k])); flat.push(m); } }
    const per = flat.length / n;
    for (let i = 0; i < n; i++) { let m = 0; for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per); j++) m = Math.max(m, flat[j]); p[i] = Math.min(1, m); }
  }
  return (s.peaks = p);
}
function drawWaves() {
  const css = getComputedStyle(document.documentElement);
  const cLil = css.getPropertyValue('--lilac').trim(), cAmb = css.getPropertyValue('--amber').trim(), cRose = css.getPropertyValue('--rose').trim();
  const now = S.ctx ? S.ctx.currentTime : 0;
  slotsEl.querySelectorAll('.slot').forEach(row => {
    const s = LS.slots[+row.dataset.i], cv = row.querySelector('.wave');
    const w = Math.round(cv.clientWidth * devicePixelRatio), h = Math.round(cv.clientHeight * devicePixelRatio);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
    const cols = Math.max(8, Math.floor(w / (2 * devicePixelRatio)));
    const pk = slotPeaks(s, cols), cw = w / cols;
    g.fillStyle = cLil; g.globalAlpha = 0.75;
    for (let i = 0; i < cols; i++) { const a = Math.max(1, pk[i] * h * 0.9); g.fillRect(i * cw, (h - a) / 2, Math.max(1, cw - devicePixelRatio), a); }
    g.globalAlpha = 1;
    const tk = LS.take;
    if (tk && tk.slot === s && S.playing) {
      const c = transport(now), x = Math.max(0, Math.min(1, (c - tk.startC) / tk.bars));
      g.fillStyle = cRose; g.globalAlpha = 0.35; g.fillRect(0, 0, x * w, h); g.globalAlpha = 1;
    } else if (s.bufs && S.playing && audible(s.name)) {
      const c = transport(now), x = mod(c - s.startC, s.bars) / s.bars;
      g.fillStyle = cAmb; g.fillRect(x * w - devicePixelRatio, 0, 2 * devicePixelRatio, h);
    }
  });
}

// ---------- scenes & song ----------
const arrEl = $('#arr'), tlEl = $('#timeline'), scenesEl = $('#scenes'), songBtn = $('#songBtn'), songPosEl = $('#songPos');
function curScene() {
  const c = S.playing ? transport(S.ctx.currentTime) : 0;
  return sceneAt(Math.max(0, c));
}
const nextBar = () => Math.ceil(S.lastC - 1e-6);
const nextPhrase = () => Math.ceil(S.lastC / 4 - 1e-6) * 4;
function launchScene(name, quant) {
  if (!S.scenes.has(name)) return;
  const playingNow = S.playing ? (sceneNameAt(S.lastC) || {}).name || null : null;
  S.songMode = false; S.songJump = null;
  if (!S.playing) { S.liveScene = name; S.nextScene = null; render(); buildArr(); return; }
  if (playingNow) S.liveScene = playingNow;
  S.nextScene = { name, at: quant === 'bar' ? nextBar() : nextPhrase() };
  S.dirty = true; buildArr();
}
// jump to a song section; by default at the next bar so the click is felt right away
function jumpTo(i, quant = 'bar') {
  const part = S.song && S.song.parts[i]; if (!part) return;
  S.nextScene = null;
  if (!S.playing) { S.songMode = true; S.songCue = part.start; S.songStart = -part.start; S.songFrom = 0; render(); buildArr(); return; }
  if (!S.songMode) { S.liveScene = (sceneNameAt(S.lastC) || {}).name || S.liveScene; S.songMode = true; S.songFrom = Infinity; }
  const at = quant === 'phrase' ? nextPhrase() : nextBar();
  S.songJump = { at, start: at - part.start, i };
  loopMsg(t('jumpQueued', { n: part.name }), 'ok', 1800);
  S.dirty = true; buildArr();
}
function songPartIndex(c) {
  const cur = sceneNameAt(c);
  return cur && cur.part ? S.song.parts.indexOf(cur.part) : -1;
}
function skipPart(dir) {
  if (!S.song) return;
  const base = S.songJump ? S.songJump.i : songPartIndex(S.playing ? S.lastC : 0);
  jumpTo(mod((base < 0 ? (dir > 0 ? -1 : 0) : base) + dir, S.song.parts.length));
}
songBtn.addEventListener('click', () => {
  if (S.songMode) {
    S.liveScene = (sceneNameAt(S.playing ? S.lastC : 0) || {}).name || S.liveScene;
    S.songMode = false; S.songJump = null;
  } else {
    S.songMode = true; S.nextScene = null; S.songJump = null;
    if (S.playing) { S.songStart = S.songFrom = nextPhrase(); loopMsg(t('songQueued'), 'ok', 1800); }
    else { S.songCue = 0; S.songStart = 0; S.songFrom = 0; }
  }
  buildArr(); render();
});
$('#prevPart').addEventListener('click', () => skipPart(-1));
$('#nextPart').addEventListener('click', () => skipPart(1));
function buildArr() {
  const has = S.scenes.size > 0;
  arrEl.hidden = !has;
  if (!has) return;
  const hasSong = !!S.song;
  for (const el of [songBtn, tlEl, $('#prevPart'), $('#nextPart'), songPosEl]) el.hidden = !hasSong;
  songBtn.setAttribute('aria-pressed', S.songMode && hasSong);
  if (hasSong) {
    tlEl.querySelector('.tl-parts').innerHTML = S.song.parts.map((p, i) =>
      `<button class="part" data-i="${i}" style="flex-grow:${p.bars}" title="${esc(t('partTitle', { n: p.name, b: p.bars }))}"><span class="fill"></span><span class="pl">${esc(p.name)}<small>${p.bars}</small></span></button>`).join('');
  }
  scenesEl.innerHTML = [...S.scenes.values()].map((s, i) => `<button class="scn" data-n="${esc(s.name)}" title="${esc(t('sceneTitle'))}">${i < 8 ? `<kbd>${'ASDFGHJK'[i]}</kbd>` : ''}${esc(s.name)}${[...s.fx].map(f => `<em>${f}</em>`).join('')}</button>`).join('');
  S.dirty = true;
}
tlEl.addEventListener('click', e => { const b = e.target.closest('.part'); if (b && S.song) jumpTo(+b.dataset.i, e.shiftKey ? 'phrase' : 'bar'); });
scenesEl.addEventListener('click', e => { const b = e.target.closest('.scn'); if (b) launchScene(b.dataset.n, e.shiftKey ? 'bar' : 'phrase'); });
let shownScene = '', shownPart = -2;
function drawArr(now) {
  if (arrEl.hidden) return;
  const c = S.playing ? Math.max(0, transport(now)) : 0;
  const cur = sceneNameAt(c), name = cur ? cur.name : '';
  const queued = S.nextScene ? S.nextScene.name : '';
  scenesEl.querySelectorAll('.scn').forEach(b => { b.classList.toggle('on', b.dataset.n === name); b.classList.toggle('queued', b.dataset.n === queued); });
  if (S.song) {
    const inSong = !!(S.songMode && cur && cur.part);
    const pi = inSong ? S.song.parts.indexOf(cur.part) : -1;
    const head = tlEl.querySelector('.tl-head');
    head.hidden = !inSong;
    if (inSong) head.style.left = `${(cur.pos / S.song.total) * 100}%`;
    const jumpI = S.songJump ? S.songJump.i : -1;
    tlEl.querySelectorAll('.part').forEach((b, i) => {
      b.classList.toggle('on', i === pi); b.classList.toggle('queued', i === jumpI);
      b.firstChild.style.width = i === pi ? `${Math.min(100, (cur.pos - cur.part.start) / cur.part.bars * 100)}%` : '0';
    });
    songBtn.classList.toggle('queued', S.songMode && S.playing && c < S.songFrom && !S.songJump);
    songPosEl.textContent = inSong
      ? `${cur.part.name} ${Math.floor(cur.pos - cur.part.start) + 1}/${cur.part.bars} · ${Math.floor(cur.pos) + 1}/${S.song.total}`
      : (S.songMode ? '' : t('liveMode'));
    if (pi !== shownPart) {
      shownPart = pi;
      document.querySelectorAll('.sp.on').forEach(el => el.classList.remove('on'));
      const tok = document.getElementById('sp' + pi); if (tok) tok.classList.add('on');
    }
  }
  if (name !== shownScene) { shownScene = name; render(); }
}

const queueEl = $('#queue');
// ---------- armed: what waits for the next bar, and the moment it lands ----------
// Everything armed blinks on the music's own beat: the root carries .tick for the first half of each beat (each
// eighth in the last beat, to say "now"). The chip counts what is left: bars while more than one, then beats.
const editorEl = document.querySelector('.editor'), qWhat = queueEl.querySelector('.qwhat'), qWhen = queueEl.querySelector('.qwhen'), qSeg = queueEl.querySelector('.qseg'), qSegs = [...qSeg.children];
const ARM = { tick: false, prev: null, goAt: null, goT: 0, shown: '' };
function armList(c) {
  const out = [];
  if (S.pending) out.push({ at: S.pending.applyAt, what: t('armCode'), code: true });
  if (S.nextScene) out.push({ at: S.nextScene.at, what: S.nextScene.name });
  if (S.songJump) out.push({ at: S.songJump.at, what: (S.song && S.song.parts[S.songJump.i] || {}).name || t('armSong') });
  else if (S.song && S.songMode && c < S.songFrom && isFinite(S.songFrom)) out.push({ at: S.songFrom, what: t('armSong') });
  return out.sort((a, b) => a.at - b.at);
}
function flashGo(el) { if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return; el.classList.remove('go-flash'); void el.offsetWidth; el.classList.add('go-flash'); }
function drawArm(c, now) {
  const list = c < 0 ? [] : armList(c), a = list[0];
  // it landed: the scheduler takes it a moment early, so the flash waits for the bar itself
  if (ARM.prev && !a && c >= 0 && timeOf(ARM.prev.at) - now < 0.4) ARM.goAt = ARM.prev;
  ARM.prev = a ? { at: a.at, code: list.some(x => x.code) } : null;
  if (ARM.goAt && c >= ARM.goAt.at - 1e-4) {
    const g = ARM.goAt; ARM.goAt = null; ARM.goT = now;
    queueEl.hidden = false; queueEl.classList.add('go'); queueEl.classList.remove('last');
    qWhat.textContent = ''; qWhen.textContent = t('armGo'); qSeg.classList.remove('bars'); qSegs.forEach(i => i.classList.add('on'));
    if (g.code) flashGo(editorEl);
    flashGo(scenesEl.querySelector('.scn.on')); flashGo(tlEl.querySelector('.part.on'));
  }
  const going = queueEl.classList.contains('go') && now - ARM.goT < 0.55;
  if (!going) queueEl.classList.remove('go');
  editorEl.classList.toggle('armed', !!(a && list.some(x => x.code)));
  let tick = false;
  if (a) {
    const left = a.at - c, beats = left * 4, last = left <= 0.25 + 1e-6;
    const ph = mod(c * 4, 1);
    tick = last ? mod(ph * 2, 1) < 0.5 : ph < 0.5;
    if (!going) {
      queueEl.hidden = false;
      queueEl.classList.toggle('last', last);
      const key = a.what + '|' + (left > 1 + 1e-6 ? 'b' + Math.ceil(left - 1e-6) : 'q' + Math.ceil(beats - 1e-6));
      if (key !== ARM.shown) {
        ARM.shown = key;
        qWhat.textContent = a.what;
        const bars = left > 1 + 1e-6, n = bars ? Math.ceil(left - 1e-6) : Math.max(1, Math.ceil(beats - 1e-6));
        qWhen.textContent = bars ? t('armIn', { n }) : n === 4 ? t('armNext') : t('armBeat', { n });
        qSeg.classList.toggle('bars', bars);
        qSegs.forEach((el, i) => el.classList.toggle('on', i < Math.min(4, n)));
      }
    }
  } else if (!going) { queueEl.hidden = true; queueEl.classList.remove('last'); ARM.shown = ''; }
  if (tick !== ARM.tick) { ARM.tick = tick; document.documentElement.classList.toggle('tick', tick); }
}

// ---------- the feel of a press ----------
// Keys get .press on pointer down (and keep it a moment, so a quick tap still shows), and the skin draws something at
// the finger: a ring, a square, or a burst of sparks. Pads draw theirs whenever they light, from a hand, a key or code.
const fxLayer = document.createElement('div'); fxLayer.id = 'fxLayer'; fxLayer.setAttribute('aria-hidden', 'true'); document.body.appendChild(fxLayer);
const KEYSEL = '.btn, .chip, .calbtn, .songbtn, .scn, .skip, .snd, .sndx, .part, .play, .tabs button, .seg button, .skins button, .loopio button, .loopio label, .sm, .slot .rec, .knob, .tap, .vizbar button';
function tapFx(el, x, y) {
  if (fxLayer.childElementCount > 24 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect();
  if (x === undefined) { x = r.left + r.width / 2; y = r.top + r.height / 2; }
  const cs = getComputedStyle(el), c = cs.getPropertyValue('--kc').trim() || (el.classList.contains('play') ? cs.backgroundColor : getComputedStyle(document.documentElement).getPropertyValue('--k-orange').trim());
  const fx = document.createElement('span'); fx.className = 'tfx';
  fx.style.cssText = `--x:${x}px;--y:${y}px;--c:${c}`;
  const n = 9, big = el.classList.contains('pad') ? 46 : 30;
  fx.innerHTML = Array.from({ length: n }, (_, i) => `<i style="--a:${Math.round(i * 360 / n + Math.random() * 24)}deg;--d:${Math.round(big * (0.7 + Math.random() * 0.5))}px"></i>`).join('');
  fxLayer.appendChild(fx);
  setTimeout(() => fx.remove(), 650);
}
document.addEventListener('pointerdown', e => {
  const el = e.target.closest(KEYSEL);
  if (!el || el.disabled || e.button > 0) return;
  el.classList.add('press'); el.dataset.pressAt = performance.now();
  tapFx(el, e.clientX, e.clientY);
  const up = () => {
    removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true);
    setTimeout(() => el.classList.remove('press'), Math.max(0, 90 - (performance.now() - el.dataset.pressAt)));
  };
  addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
}, true);

skinInit();
pwaInit();

// ---------- animation loop ----------
const posEl = $('#pos'), pipsEl = [...document.querySelectorAll('.pip')];
const recbar = $('#recbar'), recText = $('#rectext'), recCount = $('#reccount'), beatEls = [...recbar.querySelectorAll('.beats i')];
const scope = $('#scope'), sctx = scope.getContext('2d');
let scopeBuf = null, lastTakeState = '';
function frame() {
  requestAnimationFrame(frame);
  const now = S.ctx ? S.ctx.currentTime : 0;
  if (S.playing) {
    const c = Math.max(0, transport(now));
    posEl.textContent = `${Math.floor(c) + 1}.${Math.floor((c % 1) * 4) + 1}`;
    const ph = Math.floor(c) % 4;
    pipsEl.forEach((p, i) => p.classList.toggle('on', i === ph));
    drawArm(c, now);
    if (S.vis.length) {
      const keep = [];
      for (const v of S.vis) {
        if (v.time <= now + 0.01) {
          const el = v.id && document.getElementById(v.id);
          if (el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
          const led = document.getElementById('led' + v.line);
          sceneHit(v.line);
          if (led) { led.classList.remove('hit'); void led.offsetWidth; led.classList.add('hit'); }
        } else keep.push(v);
      }
      S.vis = keep;
    }
  } else drawArm(-1, now);
  // recording banner: a visual metronome for speaker mode
  const tk = LS.take, cal = LS.cal;
  const st = cal ? 'cal' : tk && S.playing ? (transport(now) < tk.startC ? 'count' : 'rec') : '';
  if (cal) {
    recbar.hidden = false; document.body.classList.add('recording');
    const k = Math.floor((now - cal.t0) / cal.beat);
    beatEls.forEach((b, i) => b.classList.toggle('on', k >= 0 && k < cal.count + cal.n && i === mod(k, 4)));
    if (cal.kind === 'auto') { recCount.textContent = '…'; recText.textContent = t('calRunning'); }
    else if (k < cal.count) { recCount.textContent = k < 0 ? '' : String(cal.count - k); recText.textContent = t('calReady'); }
    else { recCount.textContent = '●'; recText.textContent = t('calClapRun', { k: Math.min(cal.n, k - cal.count + 1) }); }
  } else if (tk && S.playing) {
    const c = transport(now);
    recbar.hidden = false;
    document.body.classList.add('recording');
    const beat = Math.floor(mod(c, 1) * 4);
    beatEls.forEach((b, i) => b.classList.toggle('on', i === beat));
    if (c < tk.startC) {
      recCount.textContent = Math.max(1, Math.ceil((tk.startC - c) * 4 - 1e-6));
      recText.textContent = t('bannerCount', { name: tk.slot.name });
    } else {
      recCount.textContent = '●';
      const bar = Math.min(tk.bars, Math.floor(c - tk.startC) + 1);
      recText.textContent = t('bannerRec', { name: tk.slot.name, bar, bars: tk.bars }) + ' · ' + (tk.silent ? t('bannerMuted') : tk.src === 'out' ? t('bannerOut') : '');
    }
  } else if (VX.take && S.playing) {
    // voice take: count-in beats, then the bar being sung
    const vt = VX.take, c = transport(now), beat = Math.floor(mod(c, 1) * 4);
    recbar.hidden = false; document.body.classList.add('recording');
    beatEls.forEach((b, i) => b.classList.toggle('on', i === beat));
    if (c < vt.startC) { recCount.textContent = Math.max(1, Math.ceil((vt.startC - c) * 4 - 1e-6)); recText.textContent = t('vxCount', { m: t(vt.mode === 'beat' ? 'vxBeat' : 'vxHum') }); }
    else { recCount.textContent = '●'; recText.textContent = t('vxRecBanner', { bar: Math.min(vt.bars, Math.floor(c - vt.startC) + 1), bars: vt.bars, m: t(vt.mode === 'beat' ? 'vxBeat' : 'vxHum') }); }
  } else if (!recbar.hidden) { recbar.hidden = true; document.body.classList.remove('recording'); }
  vxTick(now);
  if (st !== lastTakeState) { lastTakeState = st; renderLoops(); }
  drawWaves();
  drawArr(now);
  if (window.VZ) drawViz(now);
  if (S.dirty) {
    S.dirty = false;
    $('#bpm').textContent = Math.round(S.bpm);
    { const on = WK.dsp === 'wasm'; $('#dspTag').classList.toggle('on', on); $('#build').title = on ? 'Synth voices run in Rust compiled to WebAssembly' : 'build'; }
    $('#keyo').textContent = S.keySrc;
    renderLoops(); syncGpu();
    document.querySelectorAll('.pad').forEach(p => {
      const on = G.held.has(p.dataset.g) || G.auto.has(p.dataset.g);
      if (on && !p.classList.contains('on')) tapFx(p);
      p.classList.toggle('on', on);
    });
  }
  // scope
  const w = scope.clientWidth * devicePixelRatio, h = scope.clientHeight * devicePixelRatio;
  if (scope.width !== w || scope.height !== h) { scope.width = w; scope.height = h; }
  sctx.clearRect(0, 0, w, h);
  sctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--amber').trim();
  sctx.lineWidth = 1.5 * devicePixelRatio;
  sctx.beginPath();
  if (A.an && S.playing) {
    scopeBuf = scopeBuf || new Uint8Array(A.an.fftSize);
    A.an.getByteTimeDomainData(scopeBuf);
    let start = 0; for (let i = 1; i < scopeBuf.length / 2; i++) if (scopeBuf[i - 1] < 128 && scopeBuf[i] >= 128) { start = i; break; }
    const n = 400;
    for (let i = 0; i < n; i++) { const y = (scopeBuf[start + i] / 255) * h; i ? sctx.lineTo(i / n * w, y) : sctx.moveTo(0, y); }
  } else { sctx.moveTo(0, h / 2); sctx.lineTo(w, h / 2); }
  sctx.stroke();
}

// ---------- boot ----------
let saved = null;
try { saved = localStorage.getItem('pulse-src'); } catch (e) { }
srcEl.value = saved && saved.trim() ? saved : DEMO[LANG];
setInterval(() => { try { localStorage.setItem('pulse-src', srcEl.value); } catch (e) { } }, 3000);
const presetEl = $('#preset');
function buildPresets() {
  const cur = PRESETS.find(p => srcEl.value === presetText(p, LANG));
  presetEl.innerHTML = `<option value="">${esc(t('presetPick'))}</option>` + PRESETS.map(p => `<option value="${p.id}"${cur === p ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
}
presetEl.addEventListener('change', () => {
  const p = PRESETS.find(x => x.id === presetEl.value); if (!p) return;
  srcEl.value = presetText(p, LANG);
  srcEl.scrollTop = 0;
  for (const n of [...S.muted]) if (!n.startsWith('loop')) S.muted.delete(n);
  S.solo.clear();
  const live = S.playing;
  evaluate(live ? 'phrase' : 'bar', { resetSong: true });
  loopMsg(t(live && S.pending ? 'presetQueued' : 'presetLoaded', { name: p.name }), 'ok', 2600);
  presetEl.blur();
});
applyI18n();
buildChips();
try { const tb = localStorage.getItem('pulse-tab'); if (TABS.includes(tb)) showTab(tb); } catch (e) { }
buildSlots();
buildPresets();
buildArr();
syncHandsUI();
evaluate('bar');
renderPads();
pvInit();
sndInit();
buildGuide();
renderGestureCards();
(document.fonts ? document.fonts.ready : Promise.resolve()).then(measure);
measure();
requestAnimationFrame(frame);

// ---------- the guide: sections as cards, and a large view ----------
// Each heading and what follows it becomes a card that opens and closes. "Open large" moves the same content into a
// wide dialog in columns (moved, not copied, so its buttons keep working), and back when it closes.
function buildGuide() {
  const pane = $('#pane-guide'); if (!pane || $('#guideBody')) return;
  const body = document.createElement('div'); body.id = 'guideBody'; body.className = 'help';
  for (const el of [...pane.children]) if (!el.classList.contains('gtools') && el.id !== 'guideDlg') body.appendChild(el);
  pane.appendChild(body);
  let card = null, k = 0;
  for (const el of [...body.children]) {
    if (el.classList.contains('gpubox')) {
      // the GPU box carries its own heading: it becomes a card of its own
      const h = el.querySelector('h3'), d = document.createElement('details'); d.className = 'gsec';
      const sm = document.createElement('summary'); sm.append(...h.childNodes); h.remove();
      el.replaceWith(d); d.append(sm, el); card = null; continue;
    }
    if (el.tagName === 'H3') {
      card = document.createElement('details'); card.className = 'gsec'; if (k++ < 2) card.open = true;
      const sm = document.createElement('summary'); sm.innerHTML = `<span data-i18n="${el.dataset.i18n || ''}">${el.innerHTML}</span>`;
      card.appendChild(sm); el.replaceWith(card);
    } else if (card) card.appendChild(el);
  }
  const dlg = $('#guideDlg');
  $('#guideBig').addEventListener('click', () => { dlg.querySelector('.gd-body').appendChild(body); for (const d of body.querySelectorAll('details.gsec')) d.dataset.was = d.open, d.open = true; dlg.showModal(); });
  $('#guideClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { pane.appendChild(body); for (const d of body.querySelectorAll('details.gsec')) d.open = d.dataset.was === 'true'; });
}
