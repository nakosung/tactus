// ===================== Sharing a song =====================
// Two ways to send what you made. A link carries the whole code, compressed, after the # (so it never reaches a
// server): whoever opens it hears the same song. A recording is the sound itself, a few bars or the whole song,
// recorded from the master output as it plays. On phones both go through the system share sheet, which is how they
// reach KakaoTalk, Messages and the rest; elsewhere the link is copied and the recording saved as a file.

const SHARE_SITE = 'https://nakosung.github.io/tactus/play/';
const SH = { rec: null, file: null, url: '', timer: 0 };

// ---------- the link ----------
const b64url = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
// "1." is deflate; "0." is plain text, for a browser without CompressionStream
async function shareEncode(text) {
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'function') { try { return '1.' + b64url(await pipe(raw, new CompressionStream('deflate-raw'))); } catch (e) { } }
  return '0.' + b64url(raw);
}
async function shareDecode(s) {
  const [v, body] = [s.slice(0, 1), s.slice(2)], bytes = unb64url(body);
  return new TextDecoder().decode(v === '1' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes);
}
// the site's own address when we are on it; the public one when opened from a file or an embed
function shareBase() { return /^https?:$/.test(location.protocol) && /\/play\/$/.test(location.pathname) ? location.origin + location.pathname : SHARE_SITE; }
async function shareLink() { return shareBase() + '#s=' + await shareEncode(srcEl.value); }
// what the song is called in the message: the example's name, or its first comment, or "my song"
function shareName() {
  const p = PRESETS.find(x => srcEl.value === presetText(x, LANG));
  if (p) return p.name;
  const c = /^\s*\/\/\s*(.+)$/m.exec(srcEl.value);
  return c ? c[1].replace(/\s+[—–-]\s.*$/, '').slice(0, 48) : t('shareMine');
}

// ---------- opening a shared link ----------
async function shareOpenFromHash() {
  const m = /^#s=([01]\.[A-Za-z0-9_-]+)/.exec(location.hash); if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);   // a reload keeps what you do next, not the link
  let code;
  try { code = await shareDecode(m[1]); } catch (e) { loopMsg(t('shareBad'), 'bad', 5000); return; }
  if (!code.trim() || code === srcEl.value) return;
  // the code that was here is kept, and one press brings it back
  const before = srcEl.value;
  try { localStorage.setItem('pulse-src-prev', before); } catch (e) { }
  srcEl.value = code; srcEl.scrollTop = 0;
  try { localStorage.setItem('pulse-src', code); } catch (e) { }
  evaluate(S.playing ? 'phrase' : 'bar', { resetSong: true }); buildPresets();
  shareToast(t('shareOpened'), t('shareUndo'), () => { srcEl.value = before; evaluate(S.playing ? 'phrase' : 'bar', { resetSong: true }); buildPresets(); });
}
function shareToast(msg, act, fn) {
  let el = document.getElementById('shareToast');
  if (!el) { el = document.createElement('div'); el.id = 'shareToast'; el.className = 'pwa-tip share-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>${act ? `<button type="button">${esc(act)}</button>` : ''}`;
  el.hidden = false;
  const b = el.querySelector('button'); if (b) b.onclick = () => { el.hidden = true; fn(); };
  clearTimeout(SH.toastT); SH.toastT = setTimeout(() => { el.hidden = true; }, 12000);
}

// ---------- sending ----------
async function shareSend(data) {
  if (navigator.share && (!data.files || (navigator.canShare && navigator.canShare(data)))) {
    try { await navigator.share(data); return true; } catch (e) { if (e && e.name === 'AbortError') return true; }
  }
  return false;
}
async function shareCopy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { }
  const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { }
  ta.remove(); return ok;
}

// ---------- recording the sound ----------
function shareMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  // m4a plays almost everywhere (KakaoTalk and iPhones included); webm/opus is the fallback
  for (const m of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
function shareRecStart(bars) {
  const mime = shareMime(); if (mime === null) { shareSay(t('shareNoRec'), 'bad'); return; }
  initAudio(); S.ctx.resume();
  const whole = bars === 'song';
  if (whole) jumpTo(0, 'bar');
  if (!S.playing) togglePlay(true);
  const ctx = S.ctx, now = ctx.currentTime, c = transport(now);
  // from the next bar (bar 0 when the music has just started), for n bars, plus a second for the reverb to ring out
  const c0 = c < 0.02 ? 0 : Math.ceil(c - 1e-6), n = whole ? S.song.total : bars;
  const dest = ctx.createMediaStreamDestination(); A.out.connect(dest);
  const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 160000 } : undefined), chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    try { A.out.disconnect(dest); } catch (e) { }
    clearInterval(SH.timer);
    if (SH.rec && SH.rec.cancelled) { SH.rec = null; shareRender(); return; }
    const type = rec.mimeType || mime || 'audio/webm', ext = /mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
    const name = `tactus-${shareName().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'song'}.${ext}`;
    SH.file = new File(chunks, name, { type: type.split(';')[0] });
    SH.secs = SH.rec.secs; SH.rec = null; shareRender();
  };
  const tStart = timeOf(c0), tEnd = timeOf(c0 + n) + 1.0;
  SH.file = null;
  SH.rec = { rec, c0, n, secs: tEnd - tStart, startT: setTimeout(() => rec.state === 'inactive' && rec.start(250), Math.max(0, (tStart - now - 0.03) * 1000)), endT: setTimeout(() => rec.state !== 'inactive' && rec.stop(), (tEnd - now) * 1000) };
  SH.timer = setInterval(shareRender, 150);
  shareRender();
}
function shareRecStop(cancel) {
  const r = SH.rec; if (!r) return;
  clearTimeout(r.startT); clearTimeout(r.endT);
  r.cancelled = !!cancel;
  if (r.rec.state !== 'inactive') r.rec.stop(); else { SH.rec = null; clearInterval(SH.timer); shareRender(); }
}

// ---------- the dialog ----------
const shareDlg = document.getElementById('shareDlg');
function shareSay(msg, cls = '') { const el = shareDlg.querySelector('.sh-msg'); el.textContent = msg; el.className = 'sh-msg ' + cls; }
function shareRender() {
  const r = SH.rec, recBox = shareDlg.querySelector('.sh-rec');
  recBox.querySelectorAll('[data-bars]').forEach(b => { b.disabled = !!r; b.hidden = b.dataset.bars === 'song' && !S.song; });
  shareDlg.querySelector('.sh-stop').hidden = !r;
  const st = shareDlg.querySelector('.sh-state'), out = shareDlg.querySelector('.sh-out');
  if (r) {
    const c = S.playing ? transport(S.ctx.currentTime) : 0, k = c - r.c0;
    st.textContent = k < 0 ? t('shareWaiting') : t('shareRecording', { a: Math.min(r.n, Math.floor(k) + 1), b: r.n });
    st.classList.toggle('on', k >= 0);
    if (!S.playing) shareRecStop(false);
  } else { st.textContent = ''; st.classList.remove('on'); }
  out.hidden = !SH.file;
  if (SH.file) out.querySelector('span').textContent = t('shareReady', { s: Math.round(SH.secs), kb: Math.round(SH.file.size / 1024).toLocaleString() });
}
function shareOpen() {
  shareSay(''); shareRender();
  shareDlg.querySelector('.sh-send').hidden = !navigator.share;
  shareDlg.showModal();
}
function shareInit() {
  if (!shareDlg) return;
  document.getElementById('shareBtn').addEventListener('click', shareOpen);
  shareDlg.querySelector('.sh-close').addEventListener('click', () => shareDlg.close());
  shareDlg.addEventListener('click', e => { if (e.target === shareDlg) shareDlg.close(); });
  shareDlg.querySelector('.sh-send').addEventListener('click', async () => {
    const url = await shareLink();
    if (!await shareSend({ title: 'Tactus', text: t('shareText', { n: shareName() }), url })) { await shareCopy(url); shareSay(t('shareCopied'), 'ok'); }
  });
  shareDlg.querySelector('.sh-copy').addEventListener('click', async () => {
    const url = await shareLink();
    shareSay(await shareCopy(url) ? t('shareCopied') + ` (${url.length.toLocaleString()}${t('shareChars')})` : url, 'ok');
  });
  shareDlg.querySelector('.sh-rec').addEventListener('click', e => { const b = e.target.closest('[data-bars]'); if (b) shareRecStart(b.dataset.bars === 'song' ? 'song' : +b.dataset.bars); });
  shareDlg.querySelector('.sh-stop').addEventListener('click', () => shareRecStop(false));
  shareDlg.querySelector('.sh-fsend').addEventListener('click', async () => {
    if (!SH.file) return;
    if (!await shareSend({ files: [SH.file], title: 'Tactus', text: t('shareText', { n: shareName() }) })) shareSave();
  });
  shareDlg.querySelector('.sh-save').addEventListener('click', shareSave);
  shareOpenFromHash();
  addEventListener('hashchange', shareOpenFromHash);
}
function shareSave() {
  if (!SH.file) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(SH.file); a.download = SH.file.name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  shareSay(t('shareSaved', { n: SH.file.name }), 'ok');
}
shareInit();
