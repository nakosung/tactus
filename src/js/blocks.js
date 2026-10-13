// ===================== Block view =====================
// The same song as cards, for people who would rather tap than type (and children first of all). The code stays the
// one source of truth: every card is drawn from a line of code, and every tap rewrites only the part of that line it
// touched (the pattern, or one value after |), so comments, spacing and everything the cards do not show survive.
//   drums      a row of 16 steps to tap or paint
//   melodies   a lane per note of the song's scale, 16 steps wide; tap to place a note, drag right to hold it
//   stickers   one slider per sound setting after | (loudness, echo, cave, underwater, crunch)
// A pattern the grid cannot hold as written (<> turns, chords, ~generators, $phrases, finer than 16ths) is shown as
// its code, with a way to jump to that line. Rules written after | (every, sometimes, fast...) stay as they are;
// the grid shows the pattern before them, so writing it back never applies a rule twice.

// var, not const: evaluate() in ui.js asks for a redraw, and the first evaluate runs before this file does
var BK = { view: 'code', busy: false, lines: [], drag: null, flashLine: -1, step: -1, timer: 0, raf: 0 };
const BK_STEPS = 16;
const BK_STICKERS = [
  { k: 'gain', min: 0, max: 1.2, step: 0.01, def: 0.8 },
  { k: 'delay', min: 0, max: 1, step: 0.01, def: 0.3 },
  { k: 'verb', min: 0, max: 1, step: 0.01, def: 0.3 },
  { k: 'cut', min: 100, max: 12000, step: 1, def: 2000, log: true },
  { k: 'shape', min: 0, max: 1, step: 0.01, def: 0.3 },
];
// what can be added from the palette, with the pattern it starts with
const BK_PALETTE = [
  ['kick', 'x x x x'], ['snare', '. x . x'], ['clap', '. x . x'], ['hat', '. x . x . x . x'], ['ohat', '. . . x . . . x'], ['rim', '. . . . . . x . . . x . . . . .'],
  ['bass', '0 . 0 4 . 0 3 .'], ['piano', '0 2 4 7 4 2 0 _'], ['pluck', '4 . 2 . 0 . 2 .'], ['bell', '7 . 4 . 2 . 0 .'], ['marimba', '0 4 7 4 0 4 7 9'], ['flute', '4 _ 2 _ 0 _ _ _'], ['pad', '0 _ _ _ 4 _ _ _'], ['acid', '0 0 7 0 3 0 10 0'],
];
const BK_ICON = inst => isHit(inst) ? '🥁' : /bass|acid|upright/.test(inst) ? '🎸' : /piano|epiano|harpsi/.test(inst) ? '🎹' : /sax/.test(inst) ? '🎷' : /bowed|string/.test(inst) ? '🎻' : /bell|vibes|marimba|kalimba|plate/.test(inst) ? '🔔' : /flute|choir/.test(inst) ? '🎵' : /harp|pluck|zither|dantranh/.test(inst) ? '🪕' : '🎛️';
const bkName = inst => { const k = 'bi_' + inst, v = t(k); return v === k ? inst : v; };

// ---------- reading a line ----------
// split a line into the parts a card can change: name, pattern, params after |, comment
function bkSplit(text) {
  const ci = commentAt(text), code = ci >= 0 ? text.slice(0, ci) : text, comment = ci >= 0 ? text.slice(ci) : '';
  const m = HEAD_RE.exec(code); if (!m) return null;
  const rest = code.slice(m[0].length), bar = rest.indexOf('|');
  return { head: m[0], name: m[2], pat: bar >= 0 ? rest.slice(0, bar) : rest, params: bar >= 0 ? rest.slice(bar + 1) : null, comment };
}
function bkJoin(p) {
  let s = p.head + p.pat;
  if (p.params != null) s += '|' + p.params;
  if (p.comment) s += (/\s$/.test(s) ? '' : ' ') + p.comment;
  return s;
}
// the pattern as 16 steps, if it is the same every bar and sits on the grid; null when it is not
function bkGrid(patSrc, kind) {
  const src = patSrc.trim();
  if (!src || /[~$]/.test(src)) return null;
  let pat; try { pat = parseMini(src, 0); } catch (e) { return null; }
  const bars = [], bar = c => pat.q(c, c + 1).filter(e => e.v !== '~' && e.s >= c - 1e-9 && e.s < c + 1 - 1e-9), first = bar(0);
  for (let c = 0; c < 4; c++) bars.push(bar(c).map(e => `${e.v}@${((e.s - c) * BK_STEPS).toFixed(3)}+${(e.d * BK_STEPS).toFixed(3)}`).join(' '));
  if (bars.some(b => b !== bars[0])) return null;
  const tok = Array(BK_STEPS).fill('.');
  for (const e of first) {
    const k = e.s * BK_STEPS, len = e.d * BK_STEPS;
    if (Math.abs(k - Math.round(k)) > 1e-6 || k < 0 || k >= BK_STEPS) return null;
    const i = Math.round(k);
    if (tok[i] !== '.') return null;   // two at once: a chord
    if (kind === 'drum') { if (!/^[xX]$/.test(e.v)) return null; tok[i] = e.v; }
    else {
      if (!/^(-?\d+|[a-g][#b]?\d)$/.test(e.v)) return null;
      if (Math.abs(len - Math.round(len)) > 1e-6) return null;
      tok[i] = e.v;
      for (let j = 1; j < Math.round(len) && i + j < BK_STEPS; j++) tok[i + j] = '_';
    }
  }
  return tok;
}
// a value after | as a plain number, or null if it is something else (a knob, a sweep, a pattern)
function bkParam(params, k) {
  if (params == null) return undefined;
  const m = new RegExp(`(^|\\s)${k}\\s+(\\S+)`).exec(params);
  if (!m) return undefined;
  return /^-?(\d+\.?\d*|\.\d+)$/.test(m[2]) ? +m[2] : null;
}
function bkSetParam(params, k, v) {
  const s = v >= 100 ? String(Math.round(v)) : String(+v.toFixed(2)).replace(/^0\./, '.').replace(/^-0\./, '-.');
  if (params == null) return ` ${k} ${s}`;
  const re = new RegExp(`(^|\\s)(${k}\\s+)(\\S+)`);
  return re.test(params) ? params.replace(re, (m, a, b) => a + b + s) : params.replace(/\s*$/, '') + ` ${k} ${s}`;
}

// ---------- writing back ----------
function bkWrite(i, fn, opts = {}) {
  const lines = srcEl.value.split('\n'), p = bkSplit(lines[i] || ''); if (!p) return;
  const before = lines[i];
  fn(p);
  lines[i] = bkJoin(p);
  if (lines[i] === before) return;
  srcEl.value = lines.join('\n');
  BK.flashLine = i;
  bkApply(opts.live);
}
// apply the code: evaluate at the next bar (as typing would), redraw the code, and the cards unless a drag is on
function bkApply(live) {
  try { localStorage.setItem('pulse-src', srcEl.value); } catch (e) { }
  render(); evaluate('bar'); buildPresets();
  if (BK.flashLine >= 0) { const el = hlEl.children[BK.flashLine]; if (el) { el.classList.remove('bk-flash'); void el.offsetWidth; el.classList.add('bk-flash'); } BK.flashLine = -1; }
  if (!live) bkSoon();
}
// one redraw per frame, whoever asks (evaluate asks after every change of code)
function bkSoon() {
  if (!BK || BK.view === 'code' || BK.raf) return;
  BK.raf = requestAnimationFrame(() => { BK.raf = 0; if (!BK.busy) bkRender(); });
}
function bkPattern(tok, kind) {
  const s = vxBar(tok, kind !== 'drum');
  return s === '.' ? '.' : s;
}

// ---------- the board ----------
const boardEl = document.getElementById('board');
function bkScaleRows(tokens, mode, oct) {
  // rows: the notes of the song's scale that the melody uses, with room above and below
  const sc = (SCALES[S.scale] || SCALES.major), n = sc.length;
  if (mode === 'deg') {
    const ds = tokens.filter(v => /^-?\d+$/.test(v)).map(Number);
    let lo = ds.length ? Math.min(...ds) - 1 : -1, hi = ds.length ? Math.max(...ds) + 2 : n + 1;
    if (hi - lo < n + 1) { const add = n + 1 - (hi - lo); lo -= Math.floor(add / 2); hi += Math.ceil(add / 2); }
    hi = Math.min(hi, lo + 15);
    return Array.from({ length: hi - lo + 1 }, (_, j) => hi - j).map(d => ({ v: String(d), midi: S.root + 12 * (oct + 1) + sc[mod(d, n)] + 12 * Math.floor(d / n) }));
  }
  const ms = tokens.filter(v => /^[a-g]/.test(v)).map(v => atomNotes(v, 0, 'major', 4, 0)[0]);
  const lo = (ms.length ? Math.min(...ms) : 57) - 2, hi = (ms.length ? Math.max(...ms) : 69) + 3, rows = [], flat = vxFlatKey(S.root, S.scale);
  for (let m = hi; m >= lo; m--) if (sc.includes(mod(m - S.root, 12)) || ms.includes(m)) rows.push({ v: vxNoteName(m, flat), midi: m });
  return rows.slice(0, 16);
}
// note names as the key spells them (G# in A major, Ab in F minor)
const bkLabel = midi => { const s = vxNoteName(midi, vxFlatKey(S.root, S.scale)); return s[0].toUpperCase() + s.slice(1); };
function bkRender() {
  if (!boardEl || BK.view === 'code') return;
  const text = srcEl.value, r = compile(text), lines = text.split('\n'), cards = [];
  let other = 0;
  BK.lines = [];
  lines.forEach((ln, i) => {
    const name = r.lineNames.get(i), def = name && r.tracks.get(name);
    const err = r.errors.get(i);
    if (!def || def.line !== i) { if (stripComment(ln).trim() && !/^\s*(bpm|key|scale|swing)\b/.test(ln)) other++; return; }
    const p = bkSplit(ln), kind = def.kind, tok = kind === 'loop' ? null : bkGrid(p.pat, kind);
    const ci = r.order.indexOf(name), col = TRACK_COLORS[(ci < 0 ? 0 : ci) % TRACK_COLORS.length];
    BK.lines.push({ i, name, inst: def.inst, kind, tok });
    let body;
    if (!tok) body = `<div class="bk-chip"><code>${esc(p.pat.trim() || '—')}</code><button class="bk-link" data-act="goto">${esc(t('bkInCode'))}</button></div><p class="bk-why">${esc(t('bkComplex'))}</p>`;
    else if (kind === 'drum') body = `<div class="bk-steps" data-role="drum">${tok.map((v, k) => `<button class="bk-cell${v !== '.' ? ' on' : ''}${v === 'X' ? ' acc' : ''}" data-k="${k}" aria-label="${k + 1}" aria-pressed="${v !== '.'}"></button>`).join('')}</div>`;
    else {
      // the octave the track really plays in, so the lane's note names are true
      const oct = Math.round(bkParam(p.params, 'oct') ?? (INST[def.inst] && INST[def.inst].oct) ?? 4);
      const mode = tok.some(v => /^[a-g]/.test(v)) ? 'name' : 'deg', rows = bkScaleRows(tok, mode, oct);
      const own = []; let cur = null;
      tok.forEach((v, k) => { if (v === '_' && cur) own[k] = cur; else if (v !== '.' && v !== '_') { cur = v; own[k] = v; } else { cur = null; own[k] = null; } });
      body = `<div class="bk-lane" data-role="mel" data-mode="${mode}">` + rows.map(row => `<div class="bk-row" data-v="${esc(row.v)}"><span class="bk-note">${bkLabel(row.midi)}</span>${tok.map((v, k) => {
        const hit = own[k] === row.v, start = hit && tok[k] !== '_';
        return `<button class="bk-cell${hit ? ' on' : ''}${start ? ' start' : ''}" data-k="${k}" aria-label="${bkLabel(row.midi)} ${k + 1}" aria-pressed="${hit}"></button>`;
      }).join('')}</div>`).join('') + `</div>`;
    }
    const stickers = BK_STICKERS.map(s => ({ ...s, v: bkParam(p.params, s.k) })).filter(s => s.v !== undefined);
    const st = stickers.map(s => s.v === null
      ? `<span class="bk-stk code" title="${esc(t('bkStickerCode'))}"><b>${esc(t('bks_' + s.k))}</b><code>${esc(s.k)}</code></span>`
      : `<label class="bk-stk"><b>${esc(t('bks_' + s.k))}</b><input type="range" data-k="${s.k}" min="${s.log ? Math.log(s.min) : s.min}" max="${s.log ? Math.log(s.max) : s.max}" step="${s.log ? 0.01 : s.step}" value="${s.log ? Math.log(Math.max(s.min, s.v)) : s.v}"><code>${esc(s.k)} ${s.v}</code></label>`).join('');
    const missing = BK_STICKERS.filter(s => !stickers.some(x => x.k === s.k));
    const m = S.muted.has(name), so = S.solo.has(name);
    cards.push(`<article class="bk-card${err ? ' bad' : ''}${m ? ' muted' : ''}" data-i="${i}" style="--tc:${col}">
      <header><span class="bk-ico" aria-hidden="true">${BK_ICON(def.inst)}</span><span class="bk-nm"><b>${esc(name)}</b><small>${esc(bkName(def.inst))}</small></span>
        <button class="bk-tg${m ? ' on' : ''}" data-act="mute" aria-pressed="${m}" title="${esc(t('bkMute'))}">M</button><button class="bk-tg${so ? ' on' : ''}" data-act="solo" aria-pressed="${so}" title="${esc(t('bkSolo'))}">S</button><button class="bk-x" data-act="del" title="${esc(t('bkDel'))}" aria-label="${esc(t('bkDel'))} ${esc(name)}">×</button></header>
      ${err ? `<p class="bk-err">${esc(err.msg)}</p>` : ''}${body}
      <div class="bk-stks">${st}${missing.length ? `<span class="bk-addstk"><select data-act="stk" aria-label="${esc(t('bkAddSticker'))}"><option value="">${esc(t('bkAddSticker'))}</option>${missing.map(s => `<option value="${s.k}">${esc(t('bks_' + s.k))}</option>`).join('')}</select></span>` : ''}</div>
    </article>`);
  });
  // the song's tempo and mood
  const sc = S.scale, roots = NOTE_NAMES.map((n, k) => `<option value="${k}"${k === S.root ? ' selected' : ''}>${n}</option>`).join('');
  const moods = ['major', 'minor', ...(['major', 'minor'].includes(sc) ? [] : [sc])].map(s => `<button class="bk-mood" data-scale="${s}" aria-pressed="${s === sc}">${esc(t('bkm_' + s) === 'bkm_' + s ? s : t('bkm_' + s))}</button>`).join('');
  boardEl.innerHTML = `<div class="bk-top">
      <label class="bk-tempo"><span aria-hidden="true">🐢</span><input type="range" id="bkBpm" min="60" max="180" step="1" value="${Math.round(S.bpm)}" aria-label="${esc(t('bkTempo'))}"><span aria-hidden="true">🐇</span><b>${Math.round(S.bpm)}</b></label>
      <span class="bk-key"><select id="bkRoot" aria-label="${esc(t('bkRoot'))}">${roots}</select><span class="seg">${moods}</span></span>
    </div>
    <div class="bk-cards">${cards.join('') || `<p class="bk-empty">${esc(t('bkEmpty'))}</p>`}</div>
    <div class="bk-pal"><b>${esc(t('bkAdd'))}</b>${BK_PALETTE.map(([n]) => `<button class="bk-add" data-add="${n}"><span aria-hidden="true">${BK_ICON(n)}</span>${esc(bkName(n))}</button>`).join('')}</div>
    ${other ? `<p class="bk-other">${esc(t('bkOther', { n: other }))}</p>` : ''}`;
  BK.step = -1;
}

// ---------- taps ----------
function bkLine(el) { const c = el.closest('.bk-card'); return c ? BK.lines.find(l => l.i === +c.dataset.i) : null; }
function bkSetDrum(L, k, on) {
  const tok = L.tok.slice(); tok[k] = on ? (tok[k] === 'X' ? 'X' : 'x') : '.';
  L.tok = tok;
  bkWrite(L.i, p => { p.pat = bkFit(p.pat, bkPattern(tok, 'drum'), p.params != null); }, { live: true });
}
// keep the spacing of an aligned column: the new pattern takes the old one's width when it fits
function bkFit(old, pat, more) {
  const lead = /^\s*/.exec(old)[0], width = old.length;
  const s = (lead || ' ') + pat;
  if (!more) return s;   // nothing after the pattern: no padding to keep
  return s.length + 1 <= width ? s.padEnd(width) : s + ' ';
}
function bkSetNote(L, k, v, len) {
  const tok = L.tok.slice();
  // what was at k: a note starting there, or the hold of an earlier note (which now stops before k)
  if (tok[k] !== '.' && tok[k] !== '_') { tok[k] = '.'; for (let j = k + 1; j < BK_STEPS && tok[j] === '_'; j++) tok[j] = '.'; }
  else if (tok[k] === '_') tok[k] = '.';
  if (v != null) {
    tok[k] = v;
    for (let j = 1; j < len && k + j < BK_STEPS; j++) { const w = tok[k + j]; tok[k + j] = '_'; if (w !== '.' && w !== '_') for (let q = k + j + 1; q < BK_STEPS && tok[q] === '_'; q++) tok[q] = '.'; }
    // the step after the new note: if an old hold ran on, it now has no note under it
    for (let q = k + Math.max(1, len); q < BK_STEPS && tok[q] === '_'; q++) tok[q] = '.';
  }
  L.tok = tok;
  bkWrite(L.i, p => { p.pat = bkFit(p.pat, bkPattern(tok, 'mel'), p.params != null); }, { live: true });
}
function bkPaintMel(card, L) {
  // redraw one lane from L.tok without rebuilding the board (a drag is on)
  const own = []; let cur = null;
  L.tok.forEach((v, k) => { if (v === '_' && cur) own[k] = cur; else if (v !== '.' && v !== '_') { cur = v; own[k] = v; } else { cur = null; own[k] = null; } });
  card.querySelectorAll('.bk-row').forEach(row => row.querySelectorAll('.bk-cell').forEach(c => { const k = +c.dataset.k, hit = own[k] === row.dataset.v; c.classList.toggle('on', hit); c.classList.toggle('start', hit && L.tok[k] !== '_'); c.setAttribute('aria-pressed', hit); }));
}
function bkInit() {
  if (!boardEl) return;
  boardEl.addEventListener('pointerdown', e => {
    const cell = e.target.closest('.bk-cell'); if (!cell || e.button > 0) return;
    const L = bkLine(cell); if (!L || !L.tok) return;
    e.preventDefault(); BK.busy = true;
    const k = +cell.dataset.k;
    if (L.kind === 'drum') {
      const on = !cell.classList.contains('on');
      BK.drag = { L, kind: 'drum', on, done: new Set([k]) };
      cell.classList.toggle('on', on); cell.setAttribute('aria-pressed', on);
      bkSetDrum(L, k, on);
    } else {
      const row = cell.closest('.bk-row'), v = row.dataset.v, starts = L.tok[k] === v;
      if (starts) { bkSetNote(L, k, null); BK.drag = null; }
      else { bkSetNote(L, k, v, 1); BK.drag = { L, kind: 'mel', k, v, len: 1 }; }
      bkPaintMel(cell.closest('.bk-card'), L);
    }
    boardEl.setPointerCapture && boardEl.setPointerCapture(e.pointerId);
  });
  boardEl.addEventListener('pointermove', e => {
    const d = BK.drag; if (!d) return;
    const el = document.elementFromPoint(e.clientX, e.clientY), cell = el && el.closest && el.closest('.bk-cell');
    if (!cell || bkLine(cell) !== d.L) return;
    const k = +cell.dataset.k;
    if (d.kind === 'drum') {
      if (d.done.has(k)) return; d.done.add(k);
      cell.classList.toggle('on', d.on); cell.setAttribute('aria-pressed', d.on);
      bkSetDrum(d.L, k, d.on);
    } else if (k >= d.k && k - d.k + 1 !== d.len) {
      d.len = k - d.k + 1; bkSetNote(d.L, d.k, d.v, d.len); bkPaintMel(cell.closest('.bk-card'), d.L);
    }
  });
  const end = () => { if (!BK.busy) return; BK.drag = null; BK.busy = false; bkRender(); };
  boardEl.addEventListener('pointerup', end); boardEl.addEventListener('pointercancel', end);
  boardEl.addEventListener('input', e => {
    const s = e.target;
    if (s.id === 'bkBpm') { s.parentElement.querySelector('b').textContent = s.value; BK.busy = true; return; }
    if (s.type !== 'range') return;
    const L = bkLine(s), spec = BK_STICKERS.find(x => x.k === s.dataset.k); if (!L || !spec) return;
    const v = spec.log ? Math.exp(+s.value) : +s.value;
    s.nextElementSibling.textContent = `${spec.k} ${v >= 100 ? Math.round(v) : +v.toFixed(2)}`;
    BK.busy = true; bkWrite(L.i, p => { p.params = bkSetParam(p.params, spec.k, v); }, { live: true });
  });
  boardEl.addEventListener('change', e => {
    const s = e.target;
    if (s.id === 'bkBpm') { BK.busy = false; writeBpm(+s.value); evaluate('bar'); bkRender(); return; }
    if (s.id === 'bkRoot') { bkKey(+s.value, S.scale); return; }
    if (s.dataset.act === 'stk' && s.value) { const L = bkLine(s), spec = BK_STICKERS.find(x => x.k === s.value); if (L && spec) bkWrite(L.i, p => { p.params = bkSetParam(p.params, spec.k, spec.def); }); return; }
    if (s.type === 'range') { BK.busy = false; bkRender(); }
  });
  boardEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.add) { bkAdd(b.dataset.add); return; }
    if (b.dataset.scale) { bkKey(S.root, b.dataset.scale); return; }
    const L = bkLine(b); if (!L) return;
    if (b.dataset.act === 'mute') { toggleSet(S.muted, L.name); syncLoopVols(); render(); bkRender(); }
    else if (b.dataset.act === 'solo') { toggleSet(S.solo, L.name); syncLoopVols(); render(); bkRender(); }
    else if (b.dataset.act === 'del') bkDelete(L);
    else if (b.dataset.act === 'goto') bkGoto(L.i);
  });
  document.querySelectorAll('#viewbar [data-view]').forEach(b => b.addEventListener('click', () => bkView(b.dataset.view)));
  srcEl.addEventListener('input', () => { clearTimeout(BK.timer); BK.timer = setTimeout(() => { if (!BK.busy) bkRender(); }, 300); });
  let v = 'code'; try { v = localStorage.getItem('tactus-view') || 'code'; } catch (e) { }
  bkView(v, false);
}
function bkKey(root, scale) {
  const name = `${NOTE_NAMES[root]} ${scale}`, v = srcEl.value, re = /^(\s*key\s+)([^\n/]*?)(\s*(\/\/.*)?)$/m;
  srcEl.value = re.test(v) ? v.replace(re, (m, a, b, c) => a + name + c) : (/^\s*bpm\b.*$/m.test(v) ? v.replace(/^(\s*bpm\b.*)$/m, `$1\nkey ${name}`) : `key ${name}\n` + v);
  bkApply();
}
// a new line goes after the last track, before scenes and the song; scenes that list their tracks get it too
function codeAddTrack(name, line) {
  let lines = srcEl.value.split('\n');
  let at = lines.length; for (let j = lines.length - 1; j >= 0; j--) if (/^\s*(scene|song)\b/.test(lines[j])) at = j; else if (lines[j].trim() && !/^\s*\/\//.test(lines[j])) break;
  while (at > 0 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, line);
  lines = lines.map(l => {
    const m = /^(\s*scene\s+\S+\s+)([^|]*?)(\s*\|.*)?$/.exec(l);
    if (!m || /\ball\b/.test(m[2]) || new RegExp(`\\b${name}\\b`).test(m[2])) return l;
    return m[1] + m[2] + ' ' + name + (m[3] || '');
  });
  srcEl.value = lines.join('\n');
  return at;
}
function bkAdd(inst) {
  const [, pat] = BK_PALETTE.find(p => p[0] === inst);
  const taken = new Set(srcEl.value.split('\n').map(l => (HEAD_RE.exec(l) || [])[2]).filter(Boolean));
  let name = inst, n = 2; while (taken.has(name)) name = inst + n++;
  BK.flashLine = codeAddTrack(name, `${name.padEnd(6)} ${pat}${name !== inst ? ' | ' + inst : ''}`);
  bkApply();
  const card = boardEl.querySelector(`.bk-card[data-i="${BK.flashLine >= 0 ? BK.flashLine : ''}"]`) || boardEl.querySelector('.bk-card:last-of-type');
  if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function bkDelete(L) {
  const orig = srcEl.value, lines = orig.split('\n');
  lines.splice(L.i, 1);
  // scenes that named it would point at nothing
  srcEl.value = lines.map(l => { const m = /^(\s*scene\s+\S+\s+)([^|]*?)(\s*\|.*)?$/.exec(l); return m ? m[1] + m[2].split(/\s+/).filter(w => w !== L.name && w !== '-' + L.name).join(' ') + (m[3] || '') : l; }).join('\n');
  bkApply();
  shareToast(t('bkDeleted', { n: L.name }), t('bkUndo'), () => { srcEl.value = orig; bkApply(); });
}
function bkGoto(i) {
  bkView('split');
  const lines = srcEl.value.split('\n'), pos = lines.slice(0, i).reduce((a, l) => a + l.length + 1, 0);
  srcEl.focus(); srcEl.setSelectionRange(pos, pos + lines[i].length);
  srcEl.scrollTop = Math.max(0, i * lineH - srcEl.clientHeight / 3);
}
function bkView(v, save = true) {
  if (!['code', 'blocks', 'split'].includes(v)) v = 'code';
  BK.view = v;
  const views = document.getElementById('views');
  views.dataset.view = v;
  document.querySelector('.editor').hidden = v === 'blocks';
  boardEl.hidden = v === 'code';
  document.querySelectorAll('#viewbar [data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v));
  if (save) try { localStorage.setItem('tactus-view', v); } catch (e) { }
  if (v !== 'blocks') requestAnimationFrame(() => { measure(); render(); });
  bkRender();
}
// the playhead: the step being played lights up its column in every grid
function bkTick(c) {
  if (BK.view === 'code' || !boardEl) return;
  const k = c < 0 ? -1 : Math.floor(mod(c, 1) * BK_STEPS);
  if (k === BK.step) return;
  boardEl.querySelectorAll('.bk-cell.ph').forEach(x => x.classList.remove('ph'));
  if (k >= 0) boardEl.querySelectorAll(`.bk-cell[data-k="${k}"]`).forEach(x => x.classList.add('ph'));
  BK.step = k;
}
bkInit();
