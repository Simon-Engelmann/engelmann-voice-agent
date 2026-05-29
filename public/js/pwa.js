// PWA: service-worker registration, standalone detection, and a polite,
// non-nagging install hint (real Android prompt; iOS "Add to Home Screen"
// instructions, since iOS has no programmatic install).
import { isIOS, isMobile, isStandalone } from './capabilities.js';
import { infoSheet, toast } from './ui.js';

const DISMISS_KEY = 'ek_install_dismissed_at';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // don't nag for 7 days after dismiss

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch (e) {
    // Non-fatal: the app works without the SW (just no offline shell).
    console.warn('SW registration failed', e);
    return null;
  }
}

function recentlyDismissed() {
  const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return ts && Date.now() - ts < COOLDOWN_MS;
}

function dismiss() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
}

let bannerCss = false;
function injectBannerCss() {
  if (bannerCss) return;
  bannerCss = true;
  const css = `
  .ek-install{position:fixed;left:50%;transform:translateX(-50%) translateY(140%);bottom:calc(env(safe-area-inset-bottom) + 46px);z-index:60;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 24px);padding:9px 10px 9px 14px;border-radius:16px;background:rgba(255,255,255,.92);border:1px solid rgba(0,0,0,.08);box-shadow:0 14px 40px rgba(0,0,0,.16);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);font-size:13.5px;color:#1d1d1f;transition:transform .4s cubic-bezier(.2,.8,.2,1)}
  .ek-install.show{transform:translateX(-50%) translateY(0)}
  .ek-install img{width:34px;height:34px;border-radius:9px;flex:0 0 auto}
  .ek-install .t{line-height:1.25}
  .ek-install .t b{display:block;font-size:14px}
  .ek-install button{appearance:none;border:0;cursor:pointer;font-family:inherit;min-height:36px;border-radius:11px;font-weight:600;font-size:13.5px;padding:0 12px}
  .ek-install .go{background:#0A84FF;color:#fff}
  .ek-install .x{background:transparent;color:#8a8a8e;min-width:30px;padding:0 6px;font-size:18px}
  @media(prefers-color-scheme:dark){.ek-install{background:rgba(28,28,30,.92);color:#f5f5f7;border-color:rgba(255,255,255,.12)}}
  @media(prefers-reduced-motion:reduce){.ek-install{transition:none}}`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

function showBanner({ onInstall }) {
  injectBannerCss();
  const bar = document.createElement('div');
  bar.className = 'ek-install';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', 'App installieren');
  bar.innerHTML = `<img src="/icons/icon-180.png" alt=""><div class="t"><b>App installieren</b><span>Zum Home-Bildschirm für die volle Erfahrung.</span></div><button class="go" type="button">Installieren</button><button class="x" type="button" aria-label="Schließen">×</button>`;
  const close = () => { bar.classList.remove('show'); setTimeout(() => bar.remove(), 420); };
  bar.querySelector('.go').addEventListener('click', async () => { close(); await onInstall(); });
  bar.querySelector('.x').addEventListener('click', () => { dismiss(); close(); });
  document.body.appendChild(bar);
  requestAnimationFrame(() => bar.classList.add('show'));
  // Auto-hide after a while so it never lingers.
  setTimeout(() => { if (document.body.contains(bar)) close(); }, 14000);
}

function iosInstructions() {
  return infoSheet({
    icon: '📲',
    title: 'Zum Home-Bildschirm',
    body: 'In Safari so installierst du die App:',
    steps: [
      'Tippe unten auf das Teilen-Symbol',
      '„Zum Home-Bildschirm“ wählen',
      'Oben rechts auf „Hinzufügen“',
    ],
    okLabel: 'Alles klar',
  });
}

// Sets up install handling. Returns a manual trigger you can wire to a button.
export function initInstallPrompt() {
  if (isStandalone()) return { trigger: () => {} }; // already installed

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!recentlyDismissed()) {
      showBanner({
        onInstall: async () => {
          try {
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            if (choice.outcome !== 'accepted') dismiss();
          } catch { dismiss(); }
          deferredPrompt = null;
        },
      });
    }
  });

  window.addEventListener('appinstalled', () => { toast('App installiert', { icon: '✅' }); dismiss(); });

  // iOS / iPadOS: no beforeinstallprompt – show instructions banner instead.
  if (isIOS && isMobile && !recentlyDismissed()) {
    setTimeout(() => { if (!isStandalone()) showBanner({ onInstall: iosInstructions }); }, 2500);
  }

  return {
    // Manual trigger (e.g. from a menu): real prompt on Android, instructions on iOS.
    trigger: async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice.catch(() => {});
        deferredPrompt = null;
      } else if (isIOS) {
        await iosInstructions();
      } else {
        await infoSheet({ icon: 'ℹ️', title: 'Installation', body: 'Über das Browser-Menü „Zum Startbildschirm hinzufügen“.' });
      }
    },
  };
}
