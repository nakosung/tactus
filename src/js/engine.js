// ===================== Tactus pattern engine (pure, no audio) =====================
const EPS = 1e-9;
const mod = (a, n) => ((a % n) + n) % n;
class PErr extends Error { constructor(msg, col) { super(msg); this.col = col; } }
function hash01(x) { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }

const pat = q => ({ q });
const silence = pat(() => []);

function atom(v, loc) {
  return pat((b, e) => {
    const out = [];
    for (let n = Math.ceil(b - EPS); n < e - EPS; n++) out.push({ s: n, d: 1, v, loc });
    return out;
  });
}

function seq(items) {
  const W = items.reduce((a, i) => a + i.w, 0);
  if (!W) return silence;
  let off = 0;
  const slots = items.map(i => { const s = { p: i.p, o: off / W, w: i.w / W }; off += i.w; return s; });
  return pat((b, e) => {
    const out = [];
    for (let n = Math.floor(b); n < e; n++) {
      for (const sl of slots) {
        const ss = n + sl.o, se = ss + sl.w;
        const qb = Math.max(b, ss), qe = Math.min(e, se);
        if (qe <= qb) continue;
        const ib = n + (qb - ss) / sl.w, ie = n + (qe - ss) / sl.w;
        for (const ev of sl.p.q(ib, ie)) out.push({ ...ev, s: ss + (ev.s - n) * sl.w, d: ev.d * sl.w });
      }
    }
    return out;
  });
}

function alt(ps) {
  const k = ps.length;
  if (!k) return silence;
  return pat((b, e) => {
    const out = [];
    for (let n = Math.floor(b); n < e; n++) {
      const qb = Math.max(b, n), qe = Math.min(e, n + 1);
      if (qe <= qb) continue;
      const i = mod(n, k), m = Math.floor(n / k);
      for (const ev of ps[i].q(qb - n + m, qe - n + m)) out.push({ ...ev, s: ev.s + n - m });
    }
    return out;
  });
}

function stack(ps) {
  if (ps.length === 1) return ps[0];
  return pat((b, e) => ps.flatMap(p => p.q(b, e)));
}

function fast(p, k) {
  if (!(k > 0)) return silence;
  if (k === 1) return p;
  return pat((b, e) => p.q(b * k, e * k).map(ev => ({ ...ev, s: ev.s / k, d: ev.d / k })));
}

function degrade(p, prob, seed) {
  return pat((b, e) => p.q(b, e).filter(ev => hash01(ev.s * 13.37 + seed * 0.731) >= prob));
}

function euclid(p, k, n, rot = 0) {
  k = Math.round(k); n = Math.round(n);
  if (n <= 0) return silence;
  const items = [];
  for (let i = 0; i < n; i++) {
    const j = mod(i + rot, n);
    const on = Math.floor(j * k / n) !== Math.floor((j - 1) * k / n);
    items.push({ p: on ? p : silence, w: 1 });
  }
  return seq(items);
}

// ply: split each event into k equal hits (ratchets)
function ply(p, k) {
  k = Math.max(1, Math.round(k));
  if (k === 1) return p;
  return pat((b, e) => p.q(b, e).flatMap(ev => Array.from({ length: k }, (_, i) => ({ ...ev, s: ev.s + i * ev.d / k, d: ev.d / k }))));
}
// reverse each bar
function rev(p) {
  return pat((b, e) => {
    const out = [];
    for (let c = Math.floor(b); c < e; c++) {
      const qb = Math.max(b, c), qe = Math.min(e, c + 1);
      for (const ev of p.q(c, c + 1)) { const s = 2 * c + 1 - ev.s - ev.d; if (s >= qb - EPS && s < qe - EPS) out.push({ ...ev, s }); }
    }
    return out;
  });
}
const mapEv = (p, f) => pat((b, e) => p.q(b, e).map(f));
// polymeter: each layer walks its own items at `steps` per bar, so lengths drift against the bar
function polymeter(layers, steps) {
  return stack(layers.filter(l => l.length).map(items => {
    const k = items.length;
    return pat((b, e) => {
      const out = [];
      for (let j = Math.floor(b * steps + EPS); j < e * steps - EPS; j++) {
        const ss = j / steps, qb = Math.max(b, ss), qe = Math.min(e, (j + 1) / steps);
        if (qe <= qb) continue;
        const m = Math.floor(j / k), it = items[mod(j, k)].p;
        for (const ev of it.q(m + (qb - ss) * steps, m + (qe - ss) * steps)) out.push({ ...ev, s: ss + (ev.s - m) / steps, d: ev.d / steps });
      }
      return out;
    });
  }));
}
// every n bars, on the last bar of each n-bar group, play a transformed version
function everyWrap(p, n, fn) {
  const tp = fn(p);
  return pat((b, e) => {
    const out = [];
    for (let c = Math.floor(b); c < e; c++) {
      const qb = Math.max(b, c), qe = Math.min(e, c + 1);
      if (qe <= qb) continue;
      for (const ev of (mod(c, n) === n - 1 ? tp : p).q(qb, qe)) out.push(ev);
    }
    return out;
  });
}

// ---------- tokenizer ----------
const NUM_RE = /^-?(\d+\.?\d*|\.\d+)[#b]*(\^\d*)?'*/;
const WORD_RE = /^[a-zA-Z][a-zA-Z0-9#]*(\^\d*)?'*/;
function tokenize(src, base) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if ('[]<>{},*/!?@_():%'.includes(ch)) { toks.push({ t: ch, c0: base + i, c1: base + i + 1 }); i++; continue; }
    if ((ch === '.' || ch === '~') && !/[0-9]/.test(src[i + 1] || '')) { toks.push({ t: 'rest', c0: base + i, c1: base + i + 1 }); i++; continue; }
    if (ch === '-' && !/[0-9.]/.test(src[i + 1] || '')) { toks.push({ t: 'rest', c0: base + i, c1: base + i + 1 }); i++; continue; }
    const rest = src.slice(i);
    const m = NUM_RE.exec(rest) || WORD_RE.exec(rest);
    if (m) { toks.push({ t: 'atom', v: m[0], c0: base + i, c1: base + i + m[0].length }); i += m[0].length; continue; }
    throw new PErr(t('badSym', { c: ch }), base + i);
  }
  return toks;
}

// ---------- mini-notation parser ----------
function parseMini(src, base = 0) {
  const toks = tokenize(src, base);
  let p = 0;
  const endCol = base + src.length;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isNum = t => t && t.t === 'atom' && !isNaN(+t.v);
  function num(after) {
    const tk = next();
    if (!isNum(tk)) throw new PErr(t('needNum', { a: after }), tk ? tk.c0 : endCol);
    return +tk.v;
  }
  function body(close) {
    const layers = [];
    let items = [];
    for (;;) {
      const tk = peek();
      if (!tk) { if (close) throw new PErr(t('close', { c: close }), endCol); break; }
      if (tk.t === close) { next(); break; }
      if (tk.t === ']' || tk.t === '>' || tk.t === ')' || tk.t === '}') throw new PErr(t('unmatched', { c: tk.t }), tk.c0);
      if (tk.t === ',') { next(); layers.push(items); items = []; continue; }
      if (tk.t === '_') { next(); if (items.length) items[items.length - 1].w += 1; continue; }
      items.push(...term());
    }
    layers.push(items);
    return layers;
  }
  function term() {
    const tk = next();
    let pt;
    if (tk.t === 'atom') pt = atom(tk.v, { c0: tk.c0, c1: tk.c1 });
    else if (tk.t === 'rest') pt = silence;
    else if (tk.t === '[') pt = stack(body(']').map(seq));
    else if (tk.t === '<') pt = stack(body('>').map(items => alt(items.map(i => i.p))));
    else if (tk.t === '{') {
      const layers = body('}');
      let steps = (layers[0] || []).length || 1;
      const pc = peek();
      if (pc && pc.t === '%') { next(); steps = Math.max(1, Math.round(num('%'))); }
      pt = polymeter(layers, steps);
    }
    else throw new PErr(t('cantHere', { c: tk.t }), tk.c0);
    let w = 1, rep = 1;
    for (;;) {
      const m = peek();
      if (!m) break;
      if (m.t === '*') { next(); pt = fast(pt, num('*')); }
      else if (m.t === '/') { next(); pt = fast(pt, 1 / num('/')); }
      else if (m.t === '@') { next(); w = num('@'); }
      else if (m.t === ':') { next(); pt = ply(pt, num(':')); }
      else if (m.t === '!') {
        next();
        const n2 = peek();
        if (isNum(n2) && n2.c0 === m.c1) { next(); rep = Math.max(1, Math.round(+n2.v)); } else rep += 1;
      }
      else if (m.t === '?') {
        next();
        const n2 = peek();
        let prob = 0.5;
        if (isNum(n2) && n2.c0 === m.c1) { next(); prob = +n2.v; }
        pt = degrade(pt, prob, m.c0 + 1);
      }
      else if (m.t === '(' && m.c0 === tk.c1) {
        next();
        const k = num('('); const c = next();
        if (!c || c.t !== ',') throw new PErr(t('euclid'), c ? c.c0 : endCol);
        const n = num(',');
        let rot = 0;
        let c2 = next();
        if (c2 && c2.t === ',') { rot = num(','); c2 = next(); }
        if (!c2 || c2.t !== ')') throw new PErr(t('close', { c: ')' }), c2 ? c2.c0 : endCol);
        pt = euclid(pt, k, n, rot);
      }
      else break;
    }
    const out = [];
    for (let r = 0; r < rep; r++) out.push({ p: pt, w });
    return out;
  }
  const layers = body(null);
  return stack(layers.map(seq));
}

// ---------- music theory ----------
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], pent: [0, 2, 4, 7, 9],
  minpent: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  melodic: [0, 2, 3, 5, 7, 9, 11], wholetone: [0, 2, 4, 6, 8, 10], dim: [0, 2, 3, 5, 6, 8, 9, 11],
  spanish: [0, 1, 4, 5, 7, 8, 10], double: [0, 1, 4, 5, 7, 8, 11], hungarian: [0, 2, 3, 6, 7, 8, 11],
  lydiandom: [0, 2, 4, 6, 7, 9, 10], hirajoshi: [0, 2, 3, 7, 8], insen: [0, 1, 5, 7, 10], iwato: [0, 1, 5, 6, 10],
};
const SCALE_ALIAS = { maj: 'major', min: 'minor', aeolian: 'minor', ionian: 'major', mixo: 'mixolydian', harm: 'harmonic', harmonicminor: 'harmonic', melodicminor: 'melodic', chrom: 'chromatic', majpent: 'pent', pentatonic: 'pent', whole: 'wholetone', octatonic: 'dim', phrygiandom: 'spanish', byzantine: 'double', arabic: 'double', pyeongjo: 'pent', gyemyeonjo: 'minpent' };
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function accidental(s) { let a = 0; for (const ch of s) a += ch === '#' ? 1 : ch === 'b' ? -1 : 0; return a; }
function parseRoot(s) {
  const m = /^([a-gA-G])([#b]*)$/.exec(s);
  if (!m) return null;
  return mod(PC[m[1].toLowerCase()] + accidental(m[2]), 12);
}
// degree (scale step, may be negative) -> semitones from root
function degreeSemis(deg, scale) {
  const sc = SCALES[scale] || SCALES.minor;
  return sc[mod(deg, sc.length)] + 12 * Math.floor(deg / sc.length);
}
// chord symbols: uppercase root + quality (Cmaj7, Am9, F#m7b5, G7sus4). tones = semitones, scale = chord-scale
const CHORDS = {
  '': [[0, 4, 7], 'major'], maj: [[0, 4, 7], 'major'], m: [[0, 3, 7], 'minor'], min: [[0, 3, 7], 'minor'],
  dim: [[0, 3, 6], 'dim'], aug: [[0, 4, 8], 'wholetone'], 5: [[0, 7], 'minor'],
  sus2: [[0, 2, 7], 'major'], sus4: [[0, 5, 7], 'mixolydian'], sus: [[0, 5, 7], 'mixolydian'],
  6: [[0, 4, 7, 9], 'major'], m6: [[0, 3, 7, 9], 'dorian'], add9: [[0, 4, 7, 14], 'major'], madd9: [[0, 3, 7, 14], 'minor'],
  7: [[0, 4, 7, 10], 'mixolydian'], maj7: [[0, 4, 7, 11], 'major'], M7: [[0, 4, 7, 11], 'major'],
  m7: [[0, 3, 7, 10], 'dorian'], mM7: [[0, 3, 7, 11], 'melodic'], mmaj7: [[0, 3, 7, 11], 'melodic'],
  m7b5: [[0, 3, 6, 10], 'locrian'], dim7: [[0, 3, 6, 9], 'dim'], '7sus4': [[0, 5, 7, 10], 'mixolydian'],
  '7b9': [[0, 4, 7, 10, 13], 'spanish'], '7#9': [[0, 4, 7, 10, 15], 'spanish'], '7#5': [[0, 4, 8, 10], 'wholetone'],
  9: [[0, 4, 7, 10, 14], 'mixolydian'], maj9: [[0, 4, 7, 11, 14], 'major'], m9: [[0, 3, 7, 10, 14], 'dorian'],
  11: [[0, 4, 7, 10, 14, 17], 'mixolydian'], m11: [[0, 3, 7, 10, 14, 17], 'dorian'],
  13: [[0, 4, 7, 10, 14, 21], 'mixolydian'], maj13: [[0, 4, 7, 11, 14, 21], 'lydian'],
};
const CHORD_RE = /^([A-G])(#|b)?(.*)$/;
function parseChord(s) {
  const m = CHORD_RE.exec(s);
  if (!m || !(m[3] in CHORDS)) return null;
  const [tones, scale] = CHORDS[m[3]];
  return { root: mod(PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0), 12), tones, scale: SCALES[scale], name: s };
}
// prog value at time s: a degree offset (number) or a chord (object)
function progValue(raw) {
  if (raw == null) return 0;
  if (/^-?\d/.test(raw)) return Math.round(parseFloat(raw)) || 0;
  return parseChord(raw) || 0;
}
// atom string -> list of midi notes (null if not a note)
function accentOf(raw) { const m = /'+$/.exec(raw); return m ? Math.pow(1.35, m[0].length) : 1; }
function atomNotes(raw, root, scale, oct, prog, tr = 0, inv = false) {
  raw = raw.replace(/'+$/, '');
  const base = 12 * (oct + 1);
  const ch = parseChord(raw);
  if (ch) return ch.tones.map(i => base + ch.root + i);
  let m = /^([a-gA-G])([#b]*)(-?\d)?$/.exec(raw);
  if (m) return [12 * ((m[3] !== undefined ? +m[3] : oct) + 1) + PC[m[1].toLowerCase()] + accidental(m[2])];
  m = /^(-?\d+)([#b]*)(\^(\d*))?$/.exec(raw);
  if (!m) return null;
  let r = root, sc = SCALES[scale] || SCALES.minor, off = 0, tones = null;
  if (prog && typeof prog === 'object') { r = prog.root; sc = prog.scale; tones = prog.tones; } else off = prog || 0;
  const d = (inv ? -m[1] : +m[1]) + off + tr, acc = accidental(m[2]);
  const deg = x => sc[mod(x, sc.length)] + 12 * Math.floor(x / sc.length);
  if (m[3] !== undefined && tones && +m[1] === 0 && !tr) return tones.map(i => base + r + i + acc);
  const degs = [d];
  if (m[3] !== undefined) { degs.push(d + 2, d + 4); if (m[4] === '7') degs.push(d + 6); if (m[4] === '9') degs.push(d + 6, d + 8); }
  return degs.map(x => base + r + deg(x) + acc);
}

// ---------- instruments & params ----------
const DRUMS = ['kick', 'snare', 'clap', 'hat', 'ohat', 'rim', 'tom', 'ride', 'crash', 'shaker',
  'asnare', 'ahat', 'aohat', 'atom', 'afloor', 'aride', 'acrash', 'handclap', 'conga', 'bongo', 'cajon', 'cajonslap', 'tamb', 'shake', 'claves', 'cowbell', 'woodblock', 'triangle', 'agogo', 'framedrum', 'darbuka', 'gong',
  // Korean percussion: janggu low and high heads, buk and its shell, jing, kkwaenggwari open and muted
  'kung', 'deok', 'buk', 'buktak', 'jing', 'kkwaeng', 'kkwaengm'];
const LOOPS = ['loop1', 'loop2', 'loop3', 'loop4'];
const SYNTHS = ['sine', 'tri', 'saw', 'square', 'supersaw', 'pad', 'bass', 'acid', 'pluck', 'bell', 'flute', 'bowed', 'epiano', 'zither', 'piano', 'vibes', 'harp', 'sax', 'dantranh', 'harpsi', 'marimba', 'kalimba', 'swarm', 'choir', 'plate', 'membrane', 'nsax', 'upright'];
const NAME_INST = [
  ['kung', 'kung'], ['deok', 'deok'], ['janggu', 'kung'], ['buktak', 'buktak'], ['buk', 'buk'], ['kkwaengm', 'kkwaengm'], ['kkwaeng', 'kkwaeng'], ['kkwang', 'kkwaeng'],
  ['kick', 'kick'], ['bd', 'kick'], ['snare', 'snare'], ['sd', 'snare'], ['clap', 'clap'], ['cp', 'clap'],
  ['ohat', 'ohat'], ['open', 'ohat'], ['oh', 'ohat'], ['hat', 'hat'], ['hh', 'hat'], ['rim', 'rim'], ['tom', 'tom'],
  ['bass', 'bass'], ['sub', 'sine'], ['acid', 'acid'], ['lead', 'supersaw'], ['pad', 'pad'], ['chord', 'pad'],
  ['arp', 'pluck'], ['pluck', 'pluck'], ['stab', 'pluck'], ['bell', 'bell'],
  ['ride', 'ride'], ['crash', 'crash'], ['cym', 'crash'], ['shaker', 'shaker'], ['shk', 'shaker'],
  ['gayageum', 'zither'], ['zither', 'zither'], ['koto', 'zither'], ['guitar', 'zither'],
  ['upright', 'upright'], ['dbass', 'upright'], ['contrabass', 'upright'], ['grand', 'piano'], ['vibe', 'vibes'], ['harpsi', 'harpsi'], ['cembalo', 'harpsi'], ['harp', 'harp'], ['sax', 'sax'], ['marimba', 'marimba'], ['kalimba', 'kalimba'], ['dantranh', 'dantranh'], ['jing', 'jing'],
  ['swarm', 'swarm'], ['choir', 'choir'], ['plate', 'plate'], ['membrane', 'membrane'], ['timp', 'membrane'], ['nsax', 'nsax'], ['daegeum', 'flute'], ['flute', 'flute'], ['haegeum', 'bowed'], ['string', 'bowed'], ['keys', 'epiano'], ['rhodes', 'epiano'], ['piano', 'piano'],
];
const PARAMS = ['gain', 'pan', 'oct', 'cut', 'res', 'env', 'atk', 'dec', 'sus', 'rel', 'len', 'delay', 'verb', 'duck', 'shape', 'detune', 'tune', 'slices', 'hpf', 'low', 'high', 'drive', 'width', 'vib', 'slide', 'acc', 'bright', 'wave', 'vel', 'nudge', 'human', 'swing', 'sgrid', 'comp', 'rate', 'tr', 'range', 'seed', 'dens', 'evolve', 'bars',
  // channel strip: more EQ, insert effects, compressor detail
  'lpf', 'mid', 'midf', 'chorus', 'phaser', 'dist', 'crush', 'thr', 'ratio', 'catk', 'crel',
  // only on 'bus delay', 'bus verb' and 'master' lines
  'time', 'fb', 'pre', 'limit'];
const RETURN_ONLY = ['time', 'fb', 'pre', 'limit'];
// names of the code's own buses: each also works as a send parameter on track lines (set while compiling)
let BUS_NAMES = new Set();
const EXP_PARAMS = new Set(['cut', 'hpf', 'lpf', 'midf']);
const GLOBALS = new Set(['bpm', 'key', 'scale', 'swing', 'prog', 'scene', 'song', 'master', 'seed', 'fx', 'space', 'viz', 'shader', 'bus']);
// generator parameters shape the notes, so they are part of the pattern rather than the sound
const GEN_PARAMS = ['seed', 'dens', 'evolve', 'bars'];
let GEN_SEED = 0;
// ---------- performance pads ----------
// fx NAME [KEY] [latch] | action args ...     every built-in pad is written in this same language
const PAD_OPS = { lp: 'v', hp: 'v', res: 'n', repeat: 'n', mute: 'list', only: 'list', throw: 'n?', echo: '', verb: 'n?', gate: 'g', crush: 'n', kill: 'list', pitch: 'n', riser: 'n?', set: 'set', scene: 'w', fill: '', impact: '', swell: '', down: '', freeze: '', in: 'n' };
const PAD_KEYS = 'ZXCVBNMLPOIUY,./;';
const PAD_GROUPS = ['drums', 'bass', 'synths', 'melody', 'loops', 'all'];
const DEFAULT_PAD_SRC = [
  'fx filter Z | lp 320 res 7',
  'fx build  X | riser',
  'fx rep4   C | repeat 4',
  'fx rep16  V | repeat 16',
  'fx break  B | mute drums bass',
  'fx throw  N | throw .7',
  'fx wash   M | hp 200>2400 verb .8 in 2',
  'fx gate   , | gate 16',
  'fx crush  . | crush 5 lp 7000',
  'fx kill   / | kill low',
  'fx echo   ; | echo',
  'fx fill   L | fill',
  'fx freeze P | freeze only drums',
  'fx rep8   O | repeat 8',
  'fx up     U | pitch 12',
  'fx drop   I | impact',
];
const SCENE_FX = ['riser', 'filter', 'fill', 'pause', 'swell', 'down', 'impact'];
const VOICINGS = ['root', 'close', 'open', 'drop2', 'spread'];
const ARPS = ['up', 'down', 'updown', 'random'];
const MASTERS = ['default', 'loud', 'warm', 'open'];
// reverb spaces: modal (GPU-rendered room modes) when WebGPU is there, an algorithmic tail otherwise
const SPACES_LIST = ['hall', 'room', 'chamber', 'cathedral', 'plate'];
// backdrops the viz line can name, besides the code's own shader lines
const VIZ_BUILTIN = ['roll', 'grid', 'spiral', 'fft', 'terrain', 'contour', 'dots', 'demo', 'sono', 'off'];
const TRANSFORMS = ['rev', 'fast', 'slow', 'ply', 'skip', 'inv'];

function instForName(name) {
  const n = name.toLowerCase();
  if (DRUMS.includes(n) || SYNTHS.includes(n) || LOOPS.includes(n)) return n;
  for (const [pre, inst] of NAME_INST) if (n.startsWith(pre)) return inst;
  return 'tri';
}

const NUM = '-?(?:\\d+\\.?\\d*|\\.\\d+)';
const RE_NUM = new RegExp(`^${NUM}$`);
const RE_LFO = new RegExp(`^(${NUM})([~>])(${NUM})(?:/(${NUM}))?$`);
const RE_KNOB = new RegExp(`^k([1-4])(?:\\((${NUM}),(${NUM})\\))?$`);

function splitChunks(src, base) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    const start = i;
    let depth = 0;
    while (i < src.length && (depth > 0 || !/\s/.test(src[i]))) {
      const ch = src[i];
      if ('[<('.includes(ch)) depth++;
      else if (']>)'.includes(ch)) depth--;
      i++;
    }
    out.push({ s: src.slice(start, i), c0: base + start });
  }
  return out;
}

function parseValue(ch) {
  const s = ch.s;
  if (RE_NUM.test(s)) return { k: 'num', v: +s };
  let m = RE_LFO.exec(s);
  if (m) return { k: m[2] === '~' ? 'lfo' : 'ramp', a: +m[1], b: +m[3], per: m[4] ? Math.max(+m[4], 0.01) : 4 };
  m = RE_KNOB.exec(s);
  if (m) return { k: 'knob', i: +m[1] - 1, a: m[2] !== undefined ? +m[2] : 0, b: m[3] !== undefined ? +m[3] : 1 };
  if (s[0] === '<' || s[0] === '[') return { k: 'pat', p: parseMini(s, ch.c0) };
  return null;
}

// what each mix line takes: a bus is a channel strip without notes; the returns and the master have their own knobs
const STRIP_PARAMS = ['gain', 'pan', 'hpf', 'lpf', 'low', 'mid', 'midf', 'high', 'chorus', 'phaser', 'dist', 'crush', 'comp', 'thr', 'ratio', 'catk', 'crel', 'duck'];
const BUS_PARAMS = [...STRIP_PARAMS, 'delay', 'verb'];
const VERB_PARAMS = ['gain', 'pre', 'hpf', 'lpf', 'duck'];
const DELAY_PARAMS = ['gain', 'time', 'fb', 'hpf', 'lpf', 'duck'];
const MASTER_PARAMS = ['thr', 'ratio', 'catk', 'crel', 'low', 'mid', 'midf', 'high', 'width', 'drive', 'limit', 'gain'];
function mixParams(src, base, allowed) {
  const chunks = splitChunks(src, base), params = {};
  for (let i = 0; i < chunks.length; i++) {
    const w = chunks[i].s;
    if (!allowed.includes(w)) throw new PErr(t('mixParam', { w, list: allowed.join(' ') }), chunks[i].c0);
    const c = chunks[++i];
    if (!c) throw new PErr(t('needVal', { w }), chunks[i - 1].c0);
    const v = parseValue(c);
    if (!v) throw new PErr(t('badVal', { v: c.s, w }), c.c0);
    params[w] = v;
  }
  return params;
}
function parseParams(src, base) {
  const chunks = splitChunks(src, base);
  const params = {};
  let inst = null, fixed = false, speed = 1, voicing = null, arp = null;
  const every = [];
  for (let i = 0; i < chunks.length; i++) {
    const w = chunks[i].s;
    if (DRUMS.includes(w) || SYNTHS.includes(w) || LOOPS.includes(w)) { inst = w; continue; }
    if (w === 'fixed') { fixed = true; continue; }
    if (VOICINGS.includes(w)) { voicing = w; continue; }
    if (ARPS.includes(w)) { arp = w; continue; }
    if (w === 'every') {
      // every N <rev|inv|skip|fast K|slow K|ply K|+K|-K>
      const nC = chunks[++i], tC = chunks[++i];
      if (!nC || !/^\d+$/.test(nC.s) || +nC.s < 1) throw new PErr(t('everyFmt'), nC ? nC.c0 : chunks[i - 1].c0);
      if (!tC) throw new PErr(t('everyFmt'), nC.c0);
      const n = +nC.s, tw = tC.s;
      let fn;
      if (tw === 'rev') fn = rev;
      else if (tw === 'inv') fn = p => mapEv(p, ev => ({ ...ev, inv: !ev.inv }));
      else if (tw === 'skip') fn = () => silence;
      else if (tw === 'fast' || tw === 'slow' || tw === 'ply') {
        const kC = chunks[++i];
        if (!kC || !RE_NUM.test(kC.s) || +kC.s <= 0) throw new PErr(t('posNum', { w: tw }), kC ? kC.c0 : tC.c0);
        const k = +kC.s;
        fn = tw === 'fast' ? p => fast(p, k) : tw === 'slow' ? p => fast(p, 1 / k) : p => ply(p, k);
      } else if (/^[+-]\d+$/.test(tw)) { const k = +tw; fn = p => mapEv(p, ev => ({ ...ev, tr: (ev.tr || 0) + k })); }
      else throw new PErr(t('everyFmt'), tC.c0);
      every.push({ n, fn, src: chunks.slice(i - (['fast', 'slow', 'ply'].includes(tw) ? 3 : 2), i + 1).map(c => c.s).join(' ') });
      continue;
    }
    if (w === 'fast' || w === 'slow') {
      const c = chunks[++i];
      if (!c || !RE_NUM.test(c.s) || +c.s <= 0) throw new PErr(t('posNum', { w }), c ? c.c0 : chunks[i - 1].c0);
      speed *= w === 'fast' ? +c.s : 1 / +c.s;
      continue;
    }
    if (PARAMS.includes(w) || BUS_NAMES.has(w)) {
      const c = chunks[++i];
      if (!c) throw new PErr(t('needVal', { w }), chunks[i - 1].c0);
      const v = parseValue(c);
      if (!v) throw new PErr(t('badVal', { v: c.s, w }), c.c0);
      params[w] = v;
      continue;
    }
    throw new PErr(t('unknownParam', { w }), chunks[i].c0);
  }
  return { params, inst, fixed, speed, voicing, arp, every };
}

function stripComment(text) {
  const i = text.indexOf('//');
  return i >= 0 ? text.slice(0, i) : text;
}

const HEAD_RE = /^(\s*)([a-zA-Z][\w]*):?/;
function parseLine(text) {
  const code = stripComment(text);
  if (!code.trim()) return null;
  const m = HEAD_RE.exec(code);
  if (!m) throw new PErr(t('lineStart'), code.search(/\S/));
  const name = m[2];
  const restBase = m[0].length;
  const rest = code.slice(restBase);
  // master warm   ·   master loud | thr -20 ratio 3 low 1 high 1.5 width 1.2 limit -1
  if (name === 'master') {
    const bar = rest.indexOf('|'), v = (bar >= 0 ? rest.slice(0, bar) : rest).trim();
    if (v && !MASTERS.includes(v)) throw new PErr(t('masterFmt', { list: MASTERS.join(' ') }), restBase);
    if (!v && bar < 0) throw new PErr(t('masterFmt', { list: MASTERS.join(' ') }), restBase);
    const params = bar >= 0 ? mixParams(rest.slice(bar + 1), restBase + bar + 1, MASTER_PARAMS) : {};
    return { type: 'master', v: v || 'default', params };
  }
  // bus wash | chorus .5 verb .6 hpf 300   →   tracks send to it with "wash .4"
  // bus verb | ... and bus delay | ... set up the built-in returns
  if (name === 'bus') {
    const bar = rest.indexOf('|'), nm = (bar >= 0 ? rest.slice(0, bar) : rest).trim();
    if (!/^[a-zA-Z]\w*$/.test(nm)) throw new PErr(t('busFmt'), restBase);
    const allowed = nm === 'verb' ? VERB_PARAMS : nm === 'delay' ? DELAY_PARAMS : BUS_PARAMS;
    if (nm !== 'verb' && nm !== 'delay' && (PARAMS.includes(nm) || GLOBALS.has(nm))) throw new PErr(t('busName', { n: nm }), restBase);
    const params = bar >= 0 ? mixParams(rest.slice(bar + 1), restBase + bar + 1, allowed) : {};
    return { type: 'bus', name: nm, params };
  }
  if (name === 'space') {
    const v = rest.trim();
    if (!SPACES_LIST.includes(v)) throw new PErr(t('spaceFmt', { list: SPACES_LIST.join(' ') }), restBase);
    return { type: 'space', v };
  }
  // viz terrain   ·   viz <terrain dots sono>/4   (one backdrop per 4 bars)
  if (name === 'viz') {
    let v = rest.trim(), per = 1;
    const m2 = /\/\s*(\d+)\s*$/.exec(v);
    if (m2) { per = Math.max(1, +m2[1]); v = v.slice(0, m2.index).trim(); }
    v = v.replace(/^<|>$/g, '').trim();
    const list = v.split(/\s+/).filter(Boolean);
    if (!list.length) throw new PErr(t('vizFmt'), restBase);
    return { type: 'viz', list, per, col: restBase };
  }
  // shader glow  sin(length(q) * 20. - t * 4.) * bass      (a WGSL expression, run for every pixel)
  if (name === 'shader') {
    const m2 = /^\s*([a-zA-Z]\w*)\s+(.+)$/.exec(rest);
    if (!m2) throw new PErr(t('shaderFmt'), restBase);
    if (VIZ_BUILTIN.includes(m2[1])) throw new PErr(t('shaderName', { n: m2[1] }), restBase);
    return { type: 'shader', name: m2[1], expr: m2[2].trim() };
  }
  if (name === 'bpm' || name === 'swing') {
    const v = rest.trim();
    if (!RE_NUM.test(v)) throw new PErr(t('needNum', { a: name }), restBase);
    return { type: name, v: +v };
  }
  if (name === 'key') {
    const parts = rest.trim().split(/\s+/);
    const root = parseRoot(parts[0] || '');
    if (root === null) throw new PErr(t('keyFmt'), restBase);
    let scale = (parts[1] || 'minor').toLowerCase();
    scale = SCALE_ALIAS[scale] || scale;
    if (!SCALES[scale]) throw new PErr(t('noScale', { s: parts[1], list: Object.keys(SCALES).join(' ') }), restBase);
    return { type: 'key', root, scale, src: rest.trim() };
  }
  if (name === 'seed') {
    const v = rest.trim();
    if (!/^-?\d+$/.test(v)) throw new PErr(t('needNum', { a: name }), restBase);
    return { type: 'seed', v: +v };
  }
  if (name === 'prog') {
    const gm = /^\s*~gen(?:\s+(\d+))?\s*$/.exec(rest);
    if (gm) {
      // a chord progression written by the functional-harmony generator
      const n = Math.max(2, Math.min(16, +(gm[1] || 4)));
      const txt = '<' + genProg(GEN_SEED, n).join(' ') + '>';
      const c0 = restBase + rest.indexOf('gen');
      return { type: 'prog', pat: mapEv(parseMini(txt, 0), ev => ({ ...ev, loc: { c0, c1: c0 + 3 } })), src: rest.trim() + '#' + GEN_SEED, gen: txt };
    }
    return { type: 'prog', pat: parseMini(rest, restBase), src: rest.trim() };
  }
  if (name === 'fx') return { type: 'pad', pad: parsePad(rest, restBase) };
  if (name === 'scale') {
    let sc = rest.trim().toLowerCase(); sc = SCALE_ALIAS[sc] || sc;
    if (!SCALES[sc]) throw new PErr(t('noScale', { s: rest.trim(), list: Object.keys(SCALES).join(' ') }), restBase);
    return { type: 'scale', scale: sc };
  }
  if (name === 'scene') {
    const bar = rest.indexOf('|');
    const ch = splitChunks(bar >= 0 ? rest.slice(0, bar) : rest, restBase);
    if (!ch.length || !/^[a-zA-Z]\w*$/.test(ch[0].s)) throw new PErr(t('sceneName'), restBase);
    const sc = { name: ch[0].s, all: false, inc: new Set(), exc: new Set(), fx: new Set(), refs: [], auto: [] };
    // automation for this section: track.param value   (a>b ramps across the whole section)
    if (bar >= 0) {
      const ac = splitChunks(rest.slice(bar + 1), restBase + bar + 1);
      for (let k = 0; k < ac.length; k += 2) {
        const am = /^([a-zA-Z]\w*)\.([a-z]+)$/.exec(ac[k].s);
        if (!am || !PARAMS.includes(am[2])) throw new PErr(t('autoFmt'), ac[k].c0);
        const vc = ac[k + 1];
        if (!vc) throw new PErr(t('needVal', { w: ac[k].s }), ac[k].c0);
        const rm = new RegExp(`^(${NUM})>(${NUM})$`).exec(vc.s);
        const v = rm ? { k: 'sec', a: +rm[1], b: +rm[2] } : parseValue(vc);
        if (!v) throw new PErr(t('badVal', { v: vc.s, w: ac[k].s }), vc.c0);
        sc.auto.push({ track: am[1], param: am[2], v, c0: ac[k].c0 });
        sc.refs.push({ s: am[1], c0: ac[k].c0 });
      }
    }
    for (const c of ch.slice(1)) {
      if (c.s === 'all') sc.all = true;
      else if (SCENE_FX.includes(c.s)) sc.fx.add(c.s);
      else if (/^-[a-zA-Z]\w*$/.test(c.s)) { sc.exc.add(c.s.slice(1)); sc.refs.push(c); }
      else if (/^[a-zA-Z]\w*$/.test(c.s)) { sc.inc.add(c.s); sc.refs.push(c); }
      else throw new PErr(t('badVal', { v: c.s, w: 'scene' }), c.c0);
    }
    return { type: 'scene', scene: sc };
  }
  if (name === 'song') {
    const ch = splitChunks(rest, restBase), parts = [];
    let at = 0;
    for (const c of ch) {
      const m = /^([a-zA-Z]\w*):(\d+)$/.exec(c.s);
      if (!m || +m[2] < 1) throw new PErr(t('songFmt'), c.c0);
      parts.push({ name: m[1], bars: +m[2], start: at, c0: c.c0 }); at += +m[2];
    }
    if (!parts.length) throw new PErr(t('songFmt'), restBase);
    return { type: 'song', parts, total: at };
  }
  const bar = rest.indexOf('|');
  const patSrc = bar >= 0 ? rest.slice(0, bar) : rest;
  const parSrc = bar >= 0 ? rest.slice(bar + 1) : '';
  const pr = parseParams(parSrc, restBase + bar + 1);
  for (const k of RETURN_ONLY) if (pr.params[k]) throw new PErr(t('returnOnly', { w: k }), restBase + bar + 1 + parSrc.indexOf(k));
  for (const k of GEN_PARAMS) if (pr.params[k] && pr.params[k].k !== 'num') throw new PErr(t('needNum', { a: k }), restBase + bar + 1);
  let spec = null;
  try { spec = genSpec(patSrc, name, pr.inst || instForName(name), pr.params, GEN_SEED); } catch (e) { if (e instanceof PErr) e.col = restBase + patSrc.search(/\S/); throw e; }
  let p;
  if (spec) { const w = restBase + patSrc.indexOf('~') + 1; p = genPattern(spec, { c0: w, c1: w + spec.kind.length }); }
  else p = parseMini(patSrc, restBase);
  if (pr.speed !== 1) p = fast(p, pr.speed);
  for (const ev of pr.every) p = everyWrap(p, ev.n, ev.fn);
  const inst = pr.inst || instForName(name);
  return {
    type: 'track', name, pat: p, params: pr.params, inst, fixed: pr.fixed, opts: { voicing: pr.voicing, arp: pr.arp }, gen: spec,
    kind: DRUMS.includes(inst) ? 'drum' : LOOPS.includes(inst) ? 'loop' : 'synth',
    chop: patSrc.trim() !== '',
    patKey: inst + '|' + patSrc.replace(/\s+/g, ' ').trim() + '|' + pr.speed + '|' + pr.every.map(x => x.src).join(',') + (spec ? `|g${spec.seed},${spec.dens},${spec.bars},${spec.evolve},${spec.range}` : ''),
  };
}

function parsePad(rest, restBase) {
  const bar = rest.indexOf('|');
  const head = splitChunks(bar >= 0 ? rest.slice(0, bar) : rest, restBase);
  if (!head.length || !/^[a-zA-Z]\w*$/.test(head[0].s)) throw new PErr(t('padFmt'), restBase);
  const pad = { name: head[0].s, key: null, latch: false, off: false, acts: [], src: bar >= 0 ? rest.slice(bar + 1).trim() : '', refs: [] };
  for (const c of head.slice(1)) {
    if (c.s === 'latch') pad.latch = true;
    else if (c.s === 'off') pad.off = true;
    else if (c.s.length === 1 && PAD_KEYS.includes(c.s.toUpperCase())) pad.key = c.s.toUpperCase();
    else throw new PErr(t('padKey', { k: c.s, list: PAD_KEYS.split('').join(' ') }), c.c0);
  }
  if (pad.off) return pad;
  if (bar < 0) throw new PErr(t('padFmt'), restBase);
  const ac = splitChunks(rest.slice(bar + 1), restBase + bar + 1);
  if (!ac.length) throw new PErr(t('padFmt'), restBase + bar + 1);
  const numOf = c => (c && RE_NUM.test(c.s) ? +c.s : null);
  const rampOf = c => { if (!c) return null; const m = new RegExp(`^(${NUM})>(${NUM})$`).exec(c.s); return m ? { a: +m[1], b: +m[2] } : RE_NUM.test(c.s) ? { v: +c.s } : null; };
  for (let i = 0; i < ac.length; i++) {
    const op = ac[i].s, kind = PAD_OPS[op], c0 = ac[i].c0;
    if (kind === undefined) throw new PErr(t('padOp', { w: op, list: Object.keys(PAD_OPS).join(' ') }), c0);
    const a = { op };
    if (kind === 'v') { a.v = rampOf(ac[++i]); if (!a.v) throw new PErr(t('needVal', { w: op }), c0); }
    else if (kind === 'n') { a.n = numOf(ac[++i]); if (a.n === null) throw new PErr(t('needNum', { a: op }), c0); }
    else if (kind === 'n?') { if (numOf(ac[i + 1]) !== null) a.n = numOf(ac[++i]); }
    else if (kind === 'g') { const c = ac[++i]; if (c && /^[x.]+$/.test(c.s)) a.g = c.s.split('').map(ch => ch === 'x'); else if (numOf(c) > 0) { const n = Math.min(64, Math.round(numOf(c))); a.g = Array.from({ length: n }, (_, k) => k % 2 === 0); } else throw new PErr(t('needVal', { w: op }), c0); }
    else if (kind === 'w') { const c = ac[++i]; if (!c || !/^[a-zA-Z]\w*$/.test(c.s)) throw new PErr(t('needVal', { w: op }), c0); a.w = c.s; }
    else if (kind === 'set') {
      const tc = ac[++i], m = tc && /^([a-zA-Z*]\w*|\*)\.([a-z]+)$/.exec(tc.s);
      if (!m || !PARAMS.includes(m[2])) throw new PErr(t('autoFmt'), tc ? tc.c0 : c0);
      a.track = m[1]; a.param = m[2]; a.v = rampOf(ac[++i]);
      if (!a.v) throw new PErr(t('needVal', { w: tc.s }), tc.c0);
      if (a.track !== '*' && !PAD_GROUPS.includes(a.track)) pad.refs.push({ s: a.track, c0: tc.c0 });
    } else if (kind === 'list') {
      a.list = [];
      while (ac[i + 1] && PAD_OPS[ac[i + 1].s] === undefined) {
        const c = ac[++i];
        if (op === 'kill' && !['low', 'mid', 'high'].includes(c.s)) throw new PErr(t('killFmt'), c.c0);
        if (op !== 'kill' && !PAD_GROUPS.includes(c.s)) pad.refs.push(c);
        a.list.push(c.s);
      }
      if (!a.list.length) throw new PErr(t('needVal', { w: op }), c0);
    }
    pad.acts.push(a);
  }
  return pad;
}
const DEFAULT_PADS = DEFAULT_PAD_SRC.map(l => { const r = parseLine(l); r.pad.builtin = true; return r.pad; });

function compile(text) {
  { const sm = /^\s*seed\s+(-?\d+)\s*(?:\/\/.*)?$/m.exec(text); GEN_SEED = sm ? +sm[1] : 0; }
  const lines = text.split('\n');
  const out = { pads: new Map(), seed: GEN_SEED, master: null, bpm: null, key: null, scale: null, swing: null, prog: null, progSrc: '', scenes: new Map(), song: null, arrSrc: '', tracks: new Map(), order: [], errors: new Map(), lineNames: new Map(), space: null, viz: null, shaders: new Map(), buses: new Map(), masterParams: {} };
  // bus names first, so track lines anywhere in the code can send to them
  BUS_NAMES = new Set();
  for (const ln of lines) { const m = /^\s*bus\s+([a-zA-Z]\w*)/.exec(stripComment(ln)); if (m && m[1] !== 'verb' && m[1] !== 'delay' && !PARAMS.includes(m[1])) BUS_NAMES.add(m[1]); }
  const sceneLines = [];
  lines.forEach((ln, i) => {
    const hm = HEAD_RE.exec(stripComment(ln));
    const guess = hm && !GLOBALS.has(hm[2]) ? hm[2] : null;
    if (guess) out.lineNames.set(i, guess);
    try {
      const r = parseLine(ln);
      if (!r) return;
      if (r.type === 'bpm') out.bpm = r.v;
      else if (r.type === 'master') { out.master = r.v; out.masterParams = r.params; }
      else if (r.type === 'bus') { if (out.buses.has(r.name)) throw new PErr(t('dup', { n: r.name }), 0); r.line = i; out.buses.set(r.name, r); }
      else if (r.type === 'space') out.space = r.v;
      else if (r.type === 'viz') { r.line = i; out.viz = r; }
      else if (r.type === 'shader') { if (out.shaders.has(r.name)) throw new PErr(t('dup', { n: r.name }), 0); r.line = i; out.shaders.set(r.name, r); }
      else if (r.type === 'seed') out.seed = r.v;
      else if (r.type === 'pad') { r.pad.line = i; if (out.pads.has(r.pad.name)) throw new PErr(t('dup', { n: r.pad.name }), 0); out.pads.set(r.pad.name, r.pad); }
      else if (r.type === 'swing') out.swing = r.v;
      else if (r.type === 'key') out.key = r;
      else if (r.type === 'prog') { out.prog = r.pat; out.progSrc = r.src; out.progGen = r.gen || null; }
      else if (r.type === 'scale') out.scale = r.scale;
      else if (r.type === 'scene') { r.scene.line = i; out.scenes.set(r.scene.name, r.scene); sceneLines.push(r.scene); out.arrSrc += ln.trim() + '\n'; }
      else if (r.type === 'song') { out.song = r; r.line = i; out.arrSrc += ln.trim() + '\n'; }
      else {
        if (out.tracks.has(r.name)) throw new PErr(t('dup', { n: r.name }), 0);
        r.line = i;
        r.cache = new Map();
        out.tracks.set(r.name, r);
        out.order.push(r.name);
      }
    } catch (err) {
      if (!(err instanceof PErr)) throw err;
      out.errors.set(i, { msg: err.message, col: err.col, name: guess });
    }
  });
  // cross-checks once every line is known
  const known = n => out.tracks.has(n) || LOOPS.includes(n);
  for (const sc of sceneLines) {
    const bad = sc.refs.find(c => !known(c.s.replace(/^-/, '')));
    if (bad && !out.errors.has(sc.line)) out.errors.set(sc.line, { msg: t('noTrack', { n: bad.s.replace(/^-/, '') }), col: bad.c0, keep: true });
  }
  // pads: the code's own pads override built-ins by name, and take their keys away from them
  const user = out.pads, pads = new Map(), taken = new Set([...user.values()].map(p => p.key).filter(Boolean));
  for (const d of DEFAULT_PADS) { if (user.has(d.name)) continue; pads.set(d.name, taken.has(d.key) ? { ...d, key: null } : d); }
  for (const [n, p] of user) {
    if (p.off) { pads.delete(n); continue; }
    if (!p.key && DEFAULT_PADS.find(d => d.name === n)) p.key = DEFAULT_PADS.find(d => d.name === n).key;
    const bad = p.refs.find(c => !known(c.s));
    if (bad && !out.errors.has(p.line)) out.errors.set(p.line, { msg: t('noTrack', { n: bad.s }), col: bad.c0, keep: true });
    pads.set(n, p);
  }
  out.pads = pads;
  if (out.viz) {
    const bad = out.viz.list.find(n => !VIZ_BUILTIN.includes(n) && !out.shaders.has(n));
    if (bad) { out.errors.set(out.viz.line, { msg: t('vizUnknown', { n: bad, list: VIZ_BUILTIN.join(' ') }), col: out.viz.col }); out.viz = null; }
  }
  if (out.song) {
    const bad = out.song.parts.find(p => !out.scenes.has(p.name));
    if (bad) { out.errors.set(out.song.line, { msg: t('noScene', { n: bad.name }), col: bad.c0 }); out.song = null; }
  }
  return out;
}

// events for one whole cycle, cached per track definition
function cycleEvents(def, n) {
  let ev = def.cache.get(n);
  if (!ev) {
    ev = def.pat.q(n, n + 1).filter(e => e.s >= n - EPS && e.s < n + 1 - EPS);
    def.cache.set(n, ev);
    if (def.cache.size > 64) def.cache.delete(def.cache.keys().next().value);
  }
  return ev;
}
function eventsIn(def, a, b) {
  const out = [];
  for (let n = Math.floor(a); n < b; n++)
    for (const e of cycleEvents(def, n)) if (e.s >= a - EPS && e.s < b - EPS) out.push(e);
  return out;
}
// value of a (mini) pattern at time s, numeric
function patValueAt(p, s) {
  const n = Math.floor(s + EPS);
  let v = null;
  for (const e of p.q(n, n + 1)) if (e.s <= s + EPS && s < e.s + e.d - EPS) v = e.v;
  return v === null ? null : parseFloat(v);
}

if (typeof module !== 'undefined') module.exports = { ply, rev, polymeter, accentOf, parseChord, progValue, parseMini, parseLine, compile, eventsIn, atomNotes, patValueAt, PErr, tokenize, SCALES };
