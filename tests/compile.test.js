// Every example song compiles without errors in both languages, and a few broken lines are caught.
// Run: node tests/compile.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const store = {};
const ctx = vm.createContext({ console, Math, JSON, Date, Map, Set, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } }, navigator: { language: 'ko-KR' }, location: { search: '' } });
for (const f of ['i18n', 'engine', 'gen', 'presets']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f + '.js'), 'utf8').replace("if (typeof module !== 'undefined') module.exports", 'if (false) module.exports');
  vm.runInContext(src, ctx, { filename: f + '.js' });
}
const run = code => vm.runInContext(code, ctx);
let n = 0;
for (const lang of ['ko', 'en']) {
  const bad = JSON.parse(run(`JSON.stringify(PRESETS.map(p => { const r = compile(presetText(p, '${lang}')); return [p.id, [...r.errors].map(([l, e]) => (l + 1) + ': ' + e.msg)]; }).filter(x => x[1].length))`));
  assert.deepStrictEqual(bad, [], `presets with errors (${lang}): ${JSON.stringify(bad)}`);
  n += run('PRESETS.length');
}
const broken = ['bus 3x | chorus .5', 'master warm | chorus 1', 'kick x | fb .5', 'viz nothing', 'space kitchen', 'kick x | gain',
  'auto nothing x', 'auto echo', 'auto st x | wobble', 'kick x\nauto kick x',
  'lead c4 | off', 'lead $Z', 'let A = $A\nlead $A', 'lead c4 | struct 3', 'lead c4 | chunk 4 wobble', 'let = c4', 'lead c4 | cut rand(1)'];
for (const line of ['auto echo <. . . x>', 'auto st . . . [x x] | repeat 16', 'kick x\nauto cut . x | mute kick', 'fx wob | lp 300\nauto wob x _ . .'])
  assert.strictEqual(run(`compile(${JSON.stringify(line)}).errors.size`), 0, 'should compile: ' + line);
for (const line of broken) assert.ok(run(`compile(${JSON.stringify(line)}).errors.size`) > 0, 'should be an error: ' + line);
// phrases and transformations: what each one plays in the first bars
const evs = (code, name, bars = 1) => JSON.parse(run(`(() => { const r = compile(${JSON.stringify(code)}); if (r.errors.size) return JSON.stringify([...r.errors].map(e => e[1].msg)); const d = r.tracks.get(${JSON.stringify(name)}); const out = []; for (let c = 0; c < ${bars}; c++) for (const e of cycleEvents(d, c)) out.push([e.v + (e.tr ? '+' + e.tr : ''), +e.s.toFixed(4), e.pan ?? null, e.amp ?? null]); return JSON.stringify(out.sort((a, b) => a[1] - b[1] || (a[0] > b[0] ? 1 : -1))); })()`));
const vs = x => x.map(e => e[0] + '@' + e[1]).join(' ');
const cases = [
  ['let A = c4 e4\nlead <$A g4>', 'lead', 2, 'c4@0 e4@0.5 g4@1'],
  ['lead c4 | off 1/8 +7', 'lead', 1, 'c4@0 c4+7@0.125'],
  ['lead c4 . . . | echo 3 1/8 .5', 'lead', 1, 'c4@0 c4@0.125 c4@0.25'],
  ['lead c4 e4 | struct x.x.', 'lead', 1, 'c4@0 e4@0.5'],
  ['lead c4 d4 e4 f4 | mask x..x', 'lead', 1, 'c4@0 f4@0.75'],
  ['lead c4 d4 e4 f4 | iter 4', 'lead', 2, 'c4@0 d4@0.25 e4@0.5 f4@0.75 d4@1 e4@1.25 f4@1.5 c4@1.75'],
  ['lead c4 d4 | palindrome', 'lead', 2, 'c4@0 d4@0.5 d4@1 c4@1.5'],
  ['lead c4 d4 e4 f4 | chunk 4 +1', 'lead', 2, 'c4+1@0 d4@0.25 e4@0.5 f4@0.75 c4@1 d4+1@1.25 e4@1.5 f4@1.75'],
];
for (const [code, name, bars, want] of cases) assert.strictEqual(vs(evs(code, name, bars)), want, code);
{ const j = evs('lead c4 d4 | jux rev', 'lead'); assert.deepStrictEqual(j.map(e => e[2]).sort(), [-0.7, -0.7, 0.7, 0.7], 'jux pans'); }
{ const e = evs('lead c4 . . . | echo 3 1/8 .5', 'lead'); assert.deepStrictEqual(e.map(x => x[3]), [null, 0.5, 0.25], 'echo levels'); }
{ const a = vs(evs('lead [c4 d4 e4 f4]*2 | sometimes .5 +7', 'lead')), b = vs(evs('lead [c4 d4 e4 f4]*2 | sometimes .5 +7', 'lead')); assert.strictEqual(a, b, 'sometimes repeats the same way'); assert.ok(/\+7/.test(a) && /4@/.test(a.replace(/\+7@/g, '')), 'sometimes changes some notes: ' + a); }
for (const w of ['scramble 4', 'shuffle 4']) assert.strictEqual(evs('lead c4 d4 e4 f4 | ' + w, 'lead').length, 4, w);
{ const k = c => run(`compile(${JSON.stringify(c)}).tracks.get('lead').patKey`); assert.notStrictEqual(k('let A = c4\nlead $A'), k('let A = d4\nlead $A'), 'a changed phrase changes the track'); }
// Pattern time follows the song start: a written-out piece loaded at bar 12 plays its first bar there.
const first = run(`(() => { const d = compile('rh <c4 d4 e4>').tracks.get('rh'); const at = c => cycleEvents(d, c).map(e => e.v + '@' + e.s).join(' ');
  const a = at(0); setPatOrigin(() => 12); const b = at(12); setPatOrigin(() => 0); return JSON.stringify([a, b]); })()`);
assert.deepStrictEqual(JSON.parse(first), ['c4@0', 'c4@12'], 'pattern origin: ' + first);
console.log(`ok: ${n} preset compiles, ${broken.length} broken lines caught, pattern time follows the song start`);
