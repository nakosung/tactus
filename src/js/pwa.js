// ===================== Installing Tactus as an app =====================
// The site pages link a manifest and register the service worker; the single-file build has neither and skips this.
// Browsers that offer installing (Chrome, Edge, Android) fire beforeinstallprompt: then the install buttons appear.
// Safari on iPhone and iPad has no prompt, so the button explains Share > Add to Home Screen instead.

const PWA = { prompt: null, tipEl: null };
const pwaStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pwaIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function pwaTip(msg) {
  if (!PWA.tipEl) { PWA.tipEl = document.createElement('div'); PWA.tipEl.className = 'pwa-tip'; PWA.tipEl.setAttribute('role', 'status'); document.body.appendChild(PWA.tipEl); }
  PWA.tipEl.textContent = msg; PWA.tipEl.hidden = false;
  clearTimeout(PWA.tipT); PWA.tipT = setTimeout(() => { PWA.tipEl.hidden = true; }, 6000);
}
function pwaShow(on) { document.querySelectorAll('.installBtn').forEach(b => { b.hidden = !on; }); }
function pwaInit() {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register(new URL('sw.js', link.href).href, { scope: new URL('./', link.href).href }).catch(() => { });
  if (pwaStandalone()) return;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); PWA.prompt = e; pwaShow(true); });
  addEventListener('appinstalled', () => { PWA.prompt = null; pwaShow(false); pwaTip(t('installDone')); });
  if (pwaIos()) pwaShow(true);
  document.querySelectorAll('.installBtn').forEach(b => b.addEventListener('click', async () => {
    // a prompt can be shown once; if it is dismissed, the browser's own menu still installs
    if (PWA.prompt) { const p = PWA.prompt; PWA.prompt = null; p.prompt(); const r = await p.userChoice.catch(() => null); if (r && r.outcome === 'accepted') pwaShow(false); }
    else pwaTip(t(pwaIos() ? 'installIos' : 'installMenu'));
  }));
}
