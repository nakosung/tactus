// ===================== Small screens: one module at a time =====================
// On a phone the desktop layout stacked into one long column: the code started below the fold and the pads were a
// thousand pixels further down. Here a phone gets a thin top bar (play, the display, ⋯ for everything else) that stays
// put, and a tab bar that shows one module at a time at full height: code, blocks, pads, the song, recording, sounds,
// guide. Held sideways, the code or blocks share the screen with the pads, which is the live-playing layout.
// On a desktop, ⤢ makes the code or the side panel fill the window (Esc to come back).

const MOB = { on: false, land: false, tab: 'code', more: false, max: '' };
const MOB_TABS = ['code', 'blocks', 'perform', 'song', 'record', 'sounds', 'guide'];
const MOB_MQ = matchMedia('(max-width: 760px), (max-height: 520px) and (pointer: coarse)');
const MOB_LAND = matchMedia('(orientation: landscape)');

function mobBuild() {
  const app = document.querySelector('.app'); if (!app || document.getElementById('mtabs')) return;
  const nav = document.createElement('nav'); nav.className = 'mtabs'; nav.id = 'mtabs'; nav.setAttribute('role', 'tablist');
  const lbl = { code: 'viewCode', blocks: 'viewBlocks', perform: 'tabPerform', song: 'mtSong', record: 'tabRecord', sounds: 'tabSounds', guide: 'tabGuide' };
  nav.innerHTML = MOB_TABS.map(n => `<button role="tab" data-mt="${n}" data-i18n="${lbl[n]}" aria-selected="false">${esc(t(lbl[n]))}</button>`).join('');
  app.appendChild(nav);
  nav.addEventListener('click', e => { const b = e.target.closest('[data-mt]'); if (b) mobTab(b.dataset.mt); });
  // ⋯ in the top bar opens a sheet with what is not needed while playing: compose and share (things done to the
  // piece), live update, skin and language (settings), GitHub and install. The song's name, the scope and the display
  // stay in the bar: they say what is playing and that it is.
  const sheet = document.createElement('div'); sheet.className = 'msheet'; sheet.id = 'msheet'; sheet.hidden = true;
  sheet.innerHTML = '<div class="msg" data-g="piece"></div><div class="msg" data-g="set"></div><div class="msg" data-g="more"></div>';
  document.querySelector('.top').after(sheet);
  const more = document.createElement('button'); more.className = 'btn ghost mmore'; more.id = 'mmore';
  more.setAttribute('aria-expanded', 'false'); more.setAttribute('data-i18n-aria', 'mMore'); more.setAttribute('aria-label', t('mMore')); more.textContent = '⋯';
  document.querySelector('.top .lcd').after(more);
  more.addEventListener('click', () => mobMore(!MOB.more));
  // a song with no scenes has nothing to show in the song tab: say so
  const empty = document.createElement('p'); empty.className = 'note mempty'; empty.id = 'mNoSong'; empty.dataset.i18n = 'mNoSong'; empty.textContent = t('mNoSong');
  document.getElementById('arr').after(empty);
  // ⤢ for the desktop: on the view bar (the code side) and on the side panel's tabs
  const mk = (where, which) => { const b = document.createElement('button'); b.className = 'mmax'; b.dataset.max = which; b.setAttribute('aria-pressed', 'false'); b.title = t('maxOn'); b.setAttribute('aria-label', t('maxOn')); b.textContent = '⤢'; where.appendChild(b); b.addEventListener('click', () => mobMax(MOB.max === which ? '' : which)); };
  mk(document.getElementById('viewbar'), 'work'); mk(document.querySelector('.rack .tabs'), 'rack');
  // on a phone the visualization menu is one button until it is tapped
  document.querySelector('.editor .code').addEventListener('click', e => {
    const vb = e.target.closest('#vizbar'); if (!vb || !MOB.on) return;
    if (!vb.classList.contains('open')) { e.stopPropagation(); e.preventDefault(); vb.classList.add('open'); return; }
    setTimeout(() => vb.classList.remove('open'), 0);
  }, true);
  sheet.addEventListener('click', e => { if (e.target.closest('#shareBtn, #srcLink, .installBtn')) mobMore(false); });
  document.addEventListener('pointerdown', e => {
    if (MOB.more && !e.target.closest('#mmore, #msheet, .cmppop, .sharedlg')) mobMore(false);
    const vb = document.getElementById('vizbar'); if (vb.classList.contains('open') && !e.target.closest('#vizbar')) vb.classList.remove('open');
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && MOB.max && !e.defaultPrevented) mobMax(''); });
  new ResizeObserver(mobSize).observe(document.querySelector('.top'));
}
function mobMore(on) {
  MOB.more = on; document.body.classList.toggle('mmore-on', on);
  const b = document.getElementById('mmore'); if (b) b.setAttribute('aria-expanded', on);
  const sh = document.getElementById('msheet'); if (sh) sh.hidden = !(on && MOB.on);
}
// the top bar's extras move into the sheet on a phone and back to their places on a desktop (moving keeps their handlers)
const MOB_SHEET = [['piece', '.top .cmpwrap'], ['piece', '#shareBtn'], ['set', '#auto'], ['set', '#skins'], ['set', '#lang'], ['more', '#srcLink'], ['more', '.top .installBtn']];
function mobSheet(on) {
  const sh = document.getElementById('msheet'); if (!sh) return;
  for (const [g, sel] of MOB_SHEET) {
    const el = MOB.moved && MOB.moved.get(sel) ? MOB.moved.get(sel).el : document.querySelector(sel); if (!el) continue;
    MOB.moved = MOB.moved || new Map();
    if (on && !MOB.moved.has(sel)) { const mark = document.createComment(sel); el.before(mark); MOB.moved.set(sel, { el, mark }); sh.querySelector(`[data-g="${g}"]`).appendChild(el); }
    if (!on && MOB.moved.has(sel)) { const m = MOB.moved.get(sel); m.mark.replaceWith(m.el); MOB.moved.delete(sel); }
  }
}
// the room left for the module: the window less the top bar and the tab bar
function mobSize() {
  const top = document.querySelector('.top'), nav = document.getElementById('mtabs'), root = document.documentElement.style;
  root.setProperty('--mtop', (MOB.on ? top.offsetHeight : 0) + 'px');
  root.setProperty('--mtab', (MOB.on && !MOB.land ? nav.offsetHeight : 0) + 'px');
  if (MOB.on && (MOB.tab === 'code' || MOB.split)) requestAnimationFrame(() => { measure(); render(); });
}
function mobTab(n, save = true) {
  if (!MOB_TABS.includes(n)) n = 'code';
  MOB.tab = n; document.body.dataset.mt = n;
  document.querySelectorAll('#mtabs [data-mt]').forEach(b => b.setAttribute('aria-selected', b.dataset.mt === n));
  // held sideways, code and blocks keep the pads beside them
  MOB.split = MOB.land && (n === 'code' || n === 'blocks');
  document.body.classList.toggle('msplit', MOB.split);
  if (n === 'code' || n === 'blocks') { bkView(n, false); if (MOB.split) showTab('perform'); }
  else if (TABS.includes(n)) showTab(n);
  if (save) try { localStorage.setItem('tactus-mtab', n); } catch (e) { }
  window.scrollTo(0, 0); mobSize();
}
function mobApply() {
  const on = MOB_MQ.matches, land = on && MOB_LAND.matches;
  const was = MOB.on; MOB.on = on; MOB.land = land;
  document.body.classList.toggle('mob', on); document.body.classList.toggle('mland', land);
  mobSheet(on);
  if (on) {
    if (MOB.max) mobMax('');
    let n = MOB.tab; if (!was) try { n = localStorage.getItem('tactus-mtab') || 'code'; } catch (e) { }
    mobTab(n, false);
  } else {
    delete document.body.dataset.mt; document.body.classList.remove('msplit'); mobMore(false);
    // back to the view and tab the desktop had
    if (was) { let v = 'code', tb = 'perform'; try { v = localStorage.getItem('tactus-view') || 'code'; tb = localStorage.getItem('pulse-tab') || 'perform'; } catch (e) { } bkView(v, false); showTab(TABS.includes(tb) ? tb : 'perform'); }
  }
  mobSize();
  if (BK.view !== 'code') bkSoon();
}
function mobMax(which) {
  MOB.max = which; document.body.dataset.max = which || '';
  if (!which) delete document.body.dataset.max;
  document.querySelectorAll('.mmax').forEach(b => { const on = b.dataset.max === which; b.setAttribute('aria-pressed', on); b.textContent = on ? '⤡' : '⤢'; b.title = t(on ? 'maxOff' : 'maxOn'); b.setAttribute('aria-label', b.title); });
  requestAnimationFrame(() => { measure(); render(); if (BK.view !== 'code') bkSoon(); });
}
mobBuild();
MOB_MQ.addEventListener('change', mobApply); MOB_LAND.addEventListener('change', mobApply);
mobApply();
