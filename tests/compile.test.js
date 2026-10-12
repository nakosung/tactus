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
  'auto nothing x', 'auto echo', 'auto st x | wobble', 'kick x\nauto kick x'];
for (const line of ['auto echo <. . . x>', 'auto st . . . [x x] | repeat 16', 'kick x\nauto cut . x | mute kick', 'fx wob | lp 300\nauto wob x _ . .'])
  assert.strictEqual(run(`compile(${JSON.stringify(line)}).errors.size`), 0, 'should compile: ' + line);
for (const line of broken) assert.ok(run(`compile(${JSON.stringify(line)}).errors.size`) > 0, 'should be an error: ' + line);
// Pattern time follows the song start: a written-out piece loaded at bar 12 plays its first bar there.
const first = run(`(() => { const d = compile('rh <c4 d4 e4>').tracks.get('rh'); const at = c => cycleEvents(d, c).map(e => e.v + '@' + e.s).join(' ');
  const a = at(0); setPatOrigin(() => 12); const b = at(12); setPatOrigin(() => 0); return JSON.stringify([a, b]); })()`);
assert.deepStrictEqual(JSON.parse(first), ['c4@0', 'c4@12'], 'pattern origin: ' + first);
console.log(`ok: ${n} preset compiles, ${broken.length} broken lines caught, pattern time follows the song start`);
