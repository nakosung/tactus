// ===================== Skins, shared by the welcome page and the instrument =====================
// The choice is kept in localStorage ('tactus-skin'). Both pages live on the same site, so they read the same value:
// a skin picked on one page is there on the other, and an open tab follows a change made in another tab.
// A tiny inline script in each page's head sets the skin before the first paint; this file wires up the picker.

const SKINS = ['studio', 'field', 'pop'];
const SKIN_KEY = 'tactus-skin';
function skinNow() { return document.documentElement.dataset.skin || 'studio'; }
// the browser's title bar (and an installed app's window) takes the skin's body colour
function skinThemeColor() {
  const m = document.querySelector('meta[name="theme-color"]'); if (!m) return;
  const c = getComputedStyle(document.documentElement).getPropertyValue('--body').trim();
  if (c) m.setAttribute('content', c);
}
function skinLabels() {
  document.querySelectorAll('.skins [data-skin]').forEach(b => {
    const k = 'skin' + b.dataset.skin[0].toUpperCase() + b.dataset.skin.slice(1), name = t(k);
    b.title = name; b.setAttribute('aria-label', name);
    const s = b.querySelector('span'); if (s) s.textContent = name;
  });
  document.querySelectorAll('.skins').forEach(g => g.setAttribute('aria-label', t('skin')));
}
function setSkin(k, save = true) {
  if (!SKINS.includes(k)) k = 'studio';
  document.documentElement.dataset.skin = k;
  document.querySelectorAll('.skins [data-skin]').forEach(b => { b.setAttribute('aria-checked', b.dataset.skin === k); b.tabIndex = b.dataset.skin === k ? 0 : -1; });
  if (save) try { localStorage.setItem(SKIN_KEY, k); } catch (e) { }
  skinThemeColor();
  if (typeof S !== 'undefined' && S) S.dirty = true;   // the instrument's canvases read the colours on their next draw
  if (typeof onSkinChange === 'function') onSkinChange(k);
}
function skinInit() {
  for (const g of document.querySelectorAll('.skins')) {
    g.addEventListener('click', e => { const b = e.target.closest('[data-skin]'); if (b) setSkin(b.dataset.skin); });
    g.addEventListener('keydown', e => {
      if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
      const d = /Right|Down/.test(e.key) ? 1 : -1, k = SKINS[(SKINS.indexOf(skinNow()) + d + SKINS.length) % SKINS.length];
      setSkin(k); g.querySelector(`[data-skin="${k}"]`).focus(); e.preventDefault();
    });
  }
  // another tab (the other page, or this one) changed the skin or the language
  addEventListener('storage', e => {
    if (e.key === SKIN_KEY && e.newValue) setSkin(e.newValue, false);
    if (e.key === 'pulse-lang' && e.newValue && typeof onSharedLang === 'function') onSharedLang(e.newValue);
  });
  skinLabels(); setSkin(skinNow(), false);
}
