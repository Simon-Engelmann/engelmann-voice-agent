// Lightweight Apple-near UI primitives: bottom sheets, confirm/info dialogs,
// toasts. Self-injects its CSS once. Accessible (role/aria, focus trap, Esc),
// safe-area aware, light/dark via prefers-color-scheme, honours reduced motion.

let injected = false;
function injectCss() {
  if (injected) return;
  injected = true;
  const css = `
  .ek-scrim{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.32);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);opacity:0;transition:opacity .25s ease;display:flex;align-items:flex-end;justify-content:center}
  .ek-scrim.show{opacity:1}
  @media(min-width:760px){.ek-scrim{align-items:center}}
  .ek-sheet{width:100%;max-width:480px;margin:0 10px max(10px,env(safe-area-inset-bottom));background:var(--ek-bg,#fff);color:var(--ek-fg,#1d1d1f);border-radius:22px;box-shadow:0 24px 70px rgba(0,0,0,.28);transform:translateY(18px);opacity:0;transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .28s ease;overflow:hidden;border:1px solid rgba(255,255,255,.12)}
  .ek-scrim.show .ek-sheet{transform:translateY(0);opacity:1}
  .ek-pad{padding:20px 20px 8px}
  .ek-ic{width:54px;height:54px;border-radius:16px;display:grid;place-items:center;font-size:26px;margin:2px auto 12px;background:linear-gradient(180deg,#0A84FF,#5E5CE6);color:#fff;box-shadow:0 8px 20px rgba(10,132,255,.35)}
  .ek-title{font-size:19px;font-weight:700;text-align:center;margin:0 0 6px}
  .ek-body{font-size:14.5px;line-height:1.45;color:var(--ek-muted,#6e6e73);text-align:center;margin:0 0 8px;white-space:pre-line}
  .ek-steps{list-style:none;margin:12px 0 4px;padding:0;display:flex;flex-direction:column;gap:8px}
  .ek-steps li{display:flex;align-items:center;gap:10px;font-size:14.5px;background:var(--ek-soft,#f2f2f7);border-radius:12px;padding:10px 12px}
  .ek-steps .n{flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:#0A84FF;color:#fff;font-size:13px;font-weight:700;display:grid;place-items:center}
  .ek-actions{display:flex;flex-direction:column;gap:8px;padding:12px}
  .ek-btn{appearance:none;border:0;width:100%;min-height:48px;border-radius:14px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit}
  .ek-btn:focus-visible{outline:3px solid rgba(10,132,255,.5);outline-offset:2px}
  .ek-btn.primary{background:#0A84FF;color:#fff}
  .ek-btn.primary:active{background:#0a76e0}
  .ek-btn.ghost{background:var(--ek-soft,#f2f2f7);color:var(--ek-fg,#1d1d1f)}
  .ek-toast-wrap{position:fixed;left:0;right:0;top:max(12px,env(safe-area-inset-top));z-index:1100;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
  .ek-toast{pointer-events:auto;max-width:calc(100vw - 28px);background:var(--ek-bg,rgba(255,255,255,.96));color:var(--ek-fg,#1d1d1f);border:1px solid var(--ek-line,rgba(0,0,0,.08));box-shadow:0 12px 34px rgba(0,0,0,.16);border-radius:14px;padding:11px 15px;font-size:14px;display:flex;align-items:center;gap:9px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);transform:translateY(-12px);opacity:0;transition:transform .26s ease,opacity .26s ease}
  .ek-toast.show{transform:translateY(0);opacity:1}
  @media(prefers-color-scheme:dark){.ek-sheet{--ek-bg:#1c1c1e;--ek-fg:#f5f5f7;--ek-muted:#a1a1a6;--ek-soft:#2c2c2e}.ek-toast{--ek-bg:rgba(28,28,30,.96);--ek-fg:#f5f5f7;--ek-line:rgba(255,255,255,.12)}}
  @media(prefers-reduced-motion:reduce){.ek-scrim,.ek-sheet,.ek-toast{transition:none}}
  `;
  const el = document.createElement('style');
  el.id = 'ek-ui-css';
  el.textContent = css;
  document.head.appendChild(el);
}

function trapFocus(container) {
  const sel = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  function onKey(e) {
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(sel)].filter((n) => !n.disabled && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  container.addEventListener('keydown', onKey);
}

// Generic sheet. opts: { icon, title, body, steps:[..], actions:[{label,value,kind}] }
// Returns a Promise resolving to the chosen action value (or null on dismiss).
export function sheet(opts = {}) {
  injectCss();
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const scrim = document.createElement('div');
    scrim.className = 'ek-scrim';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    if (opts.title) scrim.setAttribute('aria-label', opts.title);

    const stepsHtml = Array.isArray(opts.steps) && opts.steps.length
      ? `<ul class="ek-steps">${opts.steps.map((s, i) => `<li><span class="n">${i + 1}</span><span>${s}</span></li>`).join('')}</ul>`
      : '';
    const actions = opts.actions && opts.actions.length ? opts.actions : [{ label: 'OK', value: true, kind: 'primary' }];

    scrim.innerHTML = `<div class="ek-sheet" tabindex="-1">
      <div class="ek-pad">
        ${opts.icon ? `<div class="ek-ic" aria-hidden="true">${opts.icon}</div>` : ''}
        ${opts.title ? `<h2 class="ek-title">${opts.title}</h2>` : ''}
        ${opts.body ? `<p class="ek-body">${opts.body}</p>` : ''}
        ${stepsHtml}
      </div>
      <div class="ek-actions"></div>
    </div>`;

    const actionsWrap = scrim.querySelector('.ek-actions');
    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      scrim.classList.remove('show');
      setTimeout(() => {
        scrim.remove();
        if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch {}
      }, 220);
      resolve(value);
    };

    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.className = `ek-btn ${a.kind || 'ghost'}`;
      btn.textContent = a.label;
      btn.addEventListener('click', () => close(a.value));
      actionsWrap.appendChild(btn);
    });

    scrim.addEventListener('click', (e) => { if (e.target === scrim && opts.dismissible !== false) close(null); });
    scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape' && opts.dismissible !== false) close(null); });

    document.body.appendChild(scrim);
    trapFocus(scrim);
    requestAnimationFrame(() => {
      scrim.classList.add('show');
      const focusBtn = actionsWrap.querySelector('.primary') || actionsWrap.querySelector('button');
      if (focusBtn) focusBtn.focus();
    });
  });
}

export async function confirmSheet({ title, body, icon = '✨', confirmLabel = 'Erlauben', cancelLabel = 'Nicht jetzt' }) {
  const v = await sheet({
    icon, title, body, dismissible: true,
    actions: [
      { label: confirmLabel, value: true, kind: 'primary' },
      { label: cancelLabel, value: false, kind: 'ghost' },
    ],
  });
  return v === true;
}

export function infoSheet({ title, body, icon = 'ℹ️', steps, okLabel = 'Verstanden' }) {
  return sheet({ icon, title, body, steps, actions: [{ label: okLabel, value: true, kind: 'primary' }] });
}

let toastWrap = null;
export function toast(message, { duration = 2600, icon = '' } = {}) {
  injectCss();
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'ek-toast-wrap';
    toastWrap.setAttribute('role', 'status');
    toastWrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastWrap);
  }
  const el = document.createElement('div');
  el.className = 'ek-toast';
  el.innerHTML = `${icon ? `<span aria-hidden="true">${icon}</span>` : ''}<span>${message}</span>`;
  toastWrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, duration);
  return el;
}
