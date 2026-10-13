// ===================== The person's own sounds =====================
// Drop audio files on the page (or pick them in the guide) and each becomes a sound you can write in code, kept in
// this browser (IndexedDB) for next time. A file whose name carries a note (pad_c3.wav, Bass A1.mp3) plays as a
// pitched instrument from that note; any other plays as a hit. Code can also bring a recording from the web:
//   sample kick2 https://…/kick.wav      sample pad1 c4 github:user/repo/main/pad.wav      sample mykick c2 (a dropped file, re-pitched)

const SND = { db: null, bufs: new Map(), loading: new Map(), failed: new Map() };
const SND_EXT = /\.(wav|wave|mp3|ogg|oga|flac|m4a|aac|aif|aiff|webm|opus)$/i;

// ---------- storage ----------
function sndDb() {
  if (SND.db) return SND.db;
  SND.db = new Promise((ok, bad) => {
    try {
      const rq = indexedDB.open('tactus-sounds', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('sounds', { keyPath: 'name' });
      rq.onsuccess = () => ok(rq.result); rq.onerror = () => bad(rq.error);
    } catch (e) { bad(e); }
  });
  return SND.db;
}
async function sndStore(mode, fn) {
  const db = await sndDb();
  return new Promise((ok, bad) => { const tx = db.transaction('sounds', mode), r = fn(tx.objectStore('sounds')); tx.oncomplete = () => ok(r && r.result); tx.onerror = () => bad(tx.error); });
}

// ---------- decoding and registering ----------
// decoding needs no running audio, so saved sounds are ready before the first press of play
const sndDecoder = () => new OfflineAudioContext(2, 2, 44100);
function sndRegister(name, buf, mode, root) {
  SND.bufs.set(name, buf);
  KIT.bufs[name] = { p: mode === 'pitched', list: [{ buf, off: onsetOf(buf), midi: root, layer: 1 }], rr: 0 };
  SAMPLE_PITCHED.delete(name); SAMPLE_HITS.delete(name);
  (mode === 'pitched' ? SAMPLE_PITCHED : SAMPLE_HITS).add(name);
  if (mode === 'pitched' && !INST[name]) INST[name] = { lvl: 0.7, oct: 4, cut: 20000, res: 0.5, env: 0, atk: 0.003, dec: 1, sus: 1, rel: 0.4, slope: 12 };
}
// a code line may play a dropped file another way (sample mykick c2): follow the code
function sndApplyCode(samples) {
  // dropped files the code no longer mentions go back to how they were added
  for (const [name, u] of USER_SOUNDS) if (!samples.has(name) && SND.bufs.has(name)) sndRegister(name, SND.bufs.get(name), u.mode, u.root);
  for (const [name, sd] of samples) {
    const buf = SND.bufs.get(sd.url || name);
    if (buf) sndRegister(name, buf, sd.mode, sd.root);
    else if (sd.url) sndFetch(name, sd);
  }
}
async function sndFetch(name, sd) {
  if (SND.loading.has(sd.url) || SND.failed.has(sd.url)) return;
  const job = (async () => {
    try {
      const res = await fetch(sd.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await sndDecoder().decodeAudioData(await res.arrayBuffer());
      SND.bufs.set(sd.url, buf); sndRegister(name, buf, sd.mode, sd.root);
      sndRender();
    } catch (e) {
      SND.failed.set(sd.url, String(e.message || e));
      loopMsg(t('sampleLoadFail', { n: name, e: e.message || e }), 'bad', 5000);
    } finally { SND.loading.delete(sd.url); }
  })();
  SND.loading.set(sd.url, job);
}
// a file name -> a sound name: letters and digits, never a keyword, never taken
function sndName(file, taken) {
  let n = file.replace(SND_EXT, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!n || /^\d/.test(n)) n = 's' + n;
  const res = RESERVED();
  if (res.has(n)) n = 'my' + n;
  let k = n, i = 2;
  while (taken.has(k) || res.has(k)) k = n + i++;
  return k;
}
// a note in the file name (pad_c3, Bass A#1, lead-eb4) makes it pitched from that note
function sndRoot(file) {
  const m = /(?:^|[^a-z])([a-g])(#|s|b)?(-?\d)(?=[^a-z0-9]|$)/i.exec(file.replace(SND_EXT, ''));
  if (!m) return null;
  return atomNotes(m[1].toLowerCase() + (m[2] === 's' ? '#' : m[2] || '') + m[3], 0, 'major', 4, 0)[0];
}
async function sndAddFiles(files) {
  const added = [], bad = [];
  const taken = new Set(USER_SOUNDS.keys());
  for (const f of files) {
    if (!SND_EXT.test(f.name) && !(f.type || '').startsWith('audio/')) { bad.push(f.name); continue; }
    try {
      const bytes = await f.arrayBuffer();
      const buf = await sndDecoder().decodeAudioData(bytes.slice(0));
      const name = sndName(f.name, taken), root = sndRoot(f.name), mode = root === null ? 'hit' : 'pitched';
      taken.add(name);
      USER_SOUNDS.set(name, { mode, root: root ?? 60 });
      sndRegister(name, buf, mode, root ?? 60);
      await sndStore('readwrite', st => st.put({ name, mode, root: root ?? 60, file: f.name, bytes })).catch(() => { });
      added.push(name);
    } catch (e) { bad.push(f.name); }
  }
  if (added.length) loopMsg(t('soundsAdded', { n: added.length, list: added.join(' ') }), 'ok', 5000);
  if (bad.length) loopMsg(t('soundsBad', { list: bad.join(', ') }), 'bad', 5000);
  sndRender(); evaluate('bar');
}
async function sndRemove(name) {
  USER_SOUNDS.delete(name); SND.bufs.delete(name);
  await sndStore('readwrite', st => st.delete(name)).catch(() => { });
  sndRender(); evaluate('bar');
}
async function sndLoadSaved() {
  let rows = [];
  try { rows = await sndStore('readonly', st => st.getAll()) || []; } catch (e) { return; }
  for (const r of rows) {
    try {
      const buf = await sndDecoder().decodeAudioData(r.bytes.slice(0));
      USER_SOUNDS.set(r.name, { mode: r.mode, root: r.root });
      sndRegister(r.name, buf, r.mode, r.root);
    } catch (e) { }
  }
  if (rows.length) { sndRender(); evaluate('bar'); }
}

// ---------- the "my sounds" group in the sound list, and dropping files on the page ----------
function sndRender() {
  const box = document.getElementById('mySounds'); if (!box) return;
  const names = [...USER_SOUNDS.keys()];
  box.innerHTML = names.map(n => { const u = USER_SOUNDS.get(n); return `<span class="mysnd"><button class="snd" data-inst="${esc(n)}" title="${esc(u.mode === 'pitched' ? t('sndPitched', { n: noteName(u.root) + (Math.floor(u.root / 12) - 1) }) : t('sndHit'))}">${esc(n)}</button><button class="sndx" data-rm="${esc(n)}" title="${esc(t('sndRemove'))}" aria-label="${esc(t('sndRemove'))} ${esc(n)}">×</button></span>`; }).join('')
    + `<label class="sndadd">${esc(t('sndAdd'))}<input type="file" accept="audio/*" multiple hidden></label>`;
}
function sndInit() {
  const grp = document.getElementById('sounds');
  if (grp) {
    const div = document.createElement('div'); div.className = 'sgrp';
    div.innerHTML = `<h4 data-i18n="sndMine">${esc(t('sndMine'))}</h4><div id="mySounds"></div><p class="sndhint" data-i18n="sndDrop">${esc(t('sndDrop'))}</p>`;
    grp.prepend(div);
    div.addEventListener('click', e => { const x = e.target.closest('[data-rm]'); if (x) { e.stopPropagation(); sndRemove(x.dataset.rm); } });
    div.addEventListener('change', e => { if (e.target.type === 'file' && e.target.files.length) { sndAddFiles([...e.target.files]); e.target.value = ''; } });
  }
  sndRender();
  // the whole page takes dropped audio files (and folders of them)
  const zone = document.createElement('div'); zone.id = 'dropzone'; zone.hidden = true; zone.innerHTML = `<b>${esc(t('sndDropBig'))}</b>`; document.body.appendChild(zone);
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files');
  addEventListener('dragenter', e => { if (!hasFiles(e)) return; depth++; zone.querySelector('b').textContent = t('sndDropBig'); zone.hidden = false; });
  addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; zone.hidden = true; } });
  addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; zone.hidden = true;
    const files = [], walk = async en => {
      if (!en) return;
      if (en.isFile) { files.push(await new Promise(ok => en.file(ok, () => ok(null)))); return; }
      if (en.isDirectory) { const rd = en.createReader(); let batch; do { batch = await new Promise(ok => rd.readEntries(ok, () => ok([]))); for (const x of batch) await walk(x); } while (batch.length); }
    };
    const items = [...(e.dataTransfer.items || [])];
    if (items.length && items[0].webkitGetAsEntry) for (const it of items) await walk(it.webkitGetAsEntry());
    else files.push(...e.dataTransfer.files);
    sndAddFiles(files.filter(Boolean));
  });
  sndLoadSaved();
}
