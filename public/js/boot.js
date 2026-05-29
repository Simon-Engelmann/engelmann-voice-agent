// Orchestrates the native-app behaviours on top of the existing LiveKit voice
// app (exposed as window.LKApp by index.html). Everything degrades gracefully.
import { summary, isIOS, isStandalone, caps } from './capabilities.js';
import { micPermission, requestMicrophone, explainState } from './permissions.js';
import { registerServiceWorker, initInstallPrompt } from './pwa.js';
import { getLocationContext, toAgentPayload } from './location.js';
import { sheet, confirmSheet, infoSheet, toast } from './ui.js';
import { capturePhoto, captureVideo, pickDocuments, readClipboard, shareContent, analyzeMedia, humanSize } from './media.js';

const log = (message, data) => {
  try {
    fetch('/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'pwa', level: 'info', message, data: data || null }),
    }).catch(() => {});
  } catch {}
};

function waitForLKApp(timeout = 8000) {
  return new Promise((resolve) => {
    if (window.LKApp) return resolve(window.LKApp);
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (window.LKApp || Date.now() - t0 > timeout) { clearInterval(iv); resolve(window.LKApp || null); }
    }, 80);
  });
}

// ---- Location: fetched before the session so the greeting can use it --------
async function primeLocation() {
  try {
    const ctx = await getLocationContext();
    log('location context', { available: ctx.available, reason: ctx.reason, place: ctx.place ? ctx.place.label : null });
    const payload = toAgentPayload(ctx);
    if (payload) {
      window.__startContext = Object.assign({}, window.__startContext, { location: payload });
    }
    return ctx;
  } catch (e) {
    log('location error', { message: String(e && e.message) });
    return { available: false, reason: 'error' };
  }
}

// ---- Voice auto-start with honest iOS gesture handling ----------------------
async function initVoice() {
  const app = await waitForLKApp();
  if (!app) { toast('Voice-Agent konnte nicht geladen werden', { icon: '⚠️' }); return; }
  if (app.isStarted && app.isStarted()) return;

  const state = await micPermission(); // 'granted' | 'denied' | 'prompt' | 'unsupported'
  log('mic permission', { state });

  if (state === 'granted') {
    // Permission persists -> start automatically. (Audio playback may still need
    // a tap on iOS; the app surfaces a tap-to-listen fallback if so.)
    try { await app.start(); } catch (e) { log('auto start failed', { message: String(e && e.message) }); showActivateScreen(app, state); }
    return;
  }

  if (state === 'denied') {
    await infoSheet({
      icon: '🎤',
      title: 'Mikrofon ist blockiert',
      body: explainState('microphone', 'denied'),
      steps: isIOS
        ? ['Einstellungen → Safari → Mikrofon', 'Für diese Seite „Erlauben“', 'App neu laden']
        : ['Auf das Schloss-Symbol in der Adressleiste', 'Mikrofon erlauben', 'Seite neu laden'],
      okLabel: 'OK',
    });
    return;
  }

  // 'prompt' or 'unsupported' (typical on iOS Safari) -> need a user gesture.
  showActivateScreen(app, state);
}

function showActivateScreen(app, state) {
  sheet({
    icon: '🎙️',
    title: 'Voice-Agent aktivieren',
    body: 'Tippe, um das Gespräch zu starten. Dein Mikrofon wird nur während des Gesprächs genutzt – keine heimliche Aufnahme.',
    dismissible: true,
    actions: [{ label: 'Voice-Agent aktivieren', value: 'go', kind: 'primary' }, { label: 'Später', value: null, kind: 'ghost' }],
  }).then(async (v) => {
    if (v !== 'go') return;
    // Acquire mic inside the user gesture (required by iOS), then start.
    try {
      const stream = await requestMicrophone();
      stream.getTracks().forEach((t) => t.stop()); // LiveKit re-acquires with permission now granted
      await app.start();
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      await infoSheet({
        icon: '🎤',
        title: denied ? 'Mikrofon nicht erlaubt' : 'Start fehlgeschlagen',
        body: denied ? explainState('microphone', 'denied') : String(e && e.message || e),
        okLabel: 'OK',
      });
    }
  });
}

// ---- Capabilities tray (user-initiated actions) -----------------------------
function injectTrayCss() {
  const css = `
  .ek-fab{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:calc(env(safe-area-inset-bottom) + 14px);z-index:55;width:54px;height:54px;border-radius:50%;border:0;cursor:pointer;background:linear-gradient(180deg,#0A84FF,#5E5CE6);color:#fff;font-size:24px;box-shadow:0 12px 30px rgba(10,132,255,.4);display:grid;place-items:center}
  .ek-fab:focus-visible{outline:3px solid rgba(10,132,255,.5);outline-offset:3px}
  .ek-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:4px 12px 12px}
  .ek-cap{appearance:none;border:1px solid var(--ek-line,rgba(0,0,0,.08));background:var(--ek-soft,#f2f2f7);color:inherit;border-radius:16px;min-height:84px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;padding:8px}
  .ek-cap .e{font-size:24px}
  .ek-cap:focus-visible{outline:3px solid rgba(10,132,255,.5);outline-offset:2px}
  @media(prefers-color-scheme:dark){.ek-cap{--ek-soft:#2c2c2e;--ek-line:rgba(255,255,255,.12)}}`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

function trayActions() {
  const a = [
    { id: 'photo', emoji: '📷', label: 'Foto' },
    { id: 'video', emoji: '🎬', label: 'Video' },
    { id: 'file', emoji: '📄', label: 'Datei/PDF' },
    { id: 'paste', emoji: '📋', label: 'Einfügen' },
    { id: 'share', emoji: '📤', label: 'Teilen' },
    { id: 'mute', emoji: '🔇', label: 'Stumm' },
  ];
  if (!isStandalone()) a.push({ id: 'install', emoji: '📲', label: 'Installieren' });
  return a;
}

function openTray(installer) {
  const scrim = document.createElement('div');
  scrim.className = 'ek-scrim show';
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-label', 'Funktionen');
  const grid = trayActions().map((x) => `<button class="ek-cap" data-id="${x.id}"><span class="e" aria-hidden="true">${x.emoji}</span><span>${x.label}</span></button>`).join('');
  scrim.innerHTML = `<div class="ek-sheet"><div class="ek-pad"><h2 class="ek-title">Was möchtest du tun?</h2></div><div class="ek-grid">${grid}</div><div class="ek-actions"><button class="ek-btn ghost" data-id="close">Schließen</button></div></div>`;
  const close = () => { scrim.classList.remove('show'); setTimeout(() => scrim.remove(), 220); };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  scrim.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.id;
    if (id === 'close') return close();
    close();
    await runCapability(id, installer);
  }));
  document.body.appendChild(scrim);
}

let muted = false;
async function runCapability(id, installer) {
  try {
    if (id === 'photo') {
      const ok = await confirmSheet({ icon: '📷', title: 'Foto aufnehmen?', body: 'Die Kamera öffnet sich. Du bestätigst das Bild vor dem Senden.', confirmLabel: 'Kamera öffnen' });
      if (!ok) return;
      const photo = await capturePhoto();
      if (photo) await offerAnalysis({ kind: 'image', dataUrl: photo.dataUrl, name: photo.name, mime: 'image/jpeg', size: photo.size });
    } else if (id === 'video') {
      const v = await captureVideo();
      if (v) { toast(`Video bereit: ${v.name} (${humanSize(v.size)})`, { icon: '🎬' }); shareOrKeep(v.file); }
    } else if (id === 'file') {
      const docs = await pickDocuments({ multiple: true });
      if (!docs.length) return;
      const first = docs[0];
      if ((first.type || '').includes('pdf') || /\.pdf$/i.test(first.name)) {
        const b = await fileToDataUrl(first.file);
        await offerAnalysis({ kind: 'pdf', dataUrl: b, name: first.name, mime: 'application/pdf', size: first.size });
      } else if ((first.type || '').startsWith('image/')) {
        const b = await fileToDataUrl(first.file);
        await offerAnalysis({ kind: 'image', dataUrl: b, name: first.name, mime: first.type, size: first.size });
      } else {
        await infoSheet({ icon: '📄', title: 'Datei ausgewählt', body: `${first.name} · ${humanSize(first.size)}\nTyp: ${first.type}` });
      }
    } else if (id === 'paste') {
      const ok = await confirmSheet({ icon: '📋', title: 'Kopierten Inhalt übernehmen?', body: 'Ich lese nur, was du jetzt freigibst.', confirmLabel: 'Einfügen' });
      if (!ok) return;
      const text = await readClipboard();
      if (text) { sendContextToAgent('clipboard', text); await infoSheet({ icon: '📋', title: 'Übernommen', body: text.slice(0, 600) }); }
    } else if (id === 'share') {
      await shareContent({ title: 'Engelmann Voice Agent', text: 'Sprich mit dem Engelmann KI-Agenten:', url: location.origin });
    } else if (id === 'mute') {
      const app = window.LKApp;
      if (!app || !app.isStarted || !app.isStarted()) { toast('Voice-Agent ist nicht aktiv', { icon: 'ℹ️' }); return; }
      muted = !muted;
      await app.setMuted(muted);
      toast(muted ? 'Mikrofon stumm' : 'Mikrofon aktiv', { icon: muted ? '🔇' : '🎤' });
    } else if (id === 'install') {
      await installer.trigger();
    }
  } catch (e) {
    toast(String(e && e.message || e), { icon: '⚠️' });
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    r.readAsDataURL(file);
  });
}

async function offerAnalysis(media) {
  const ok = await confirmSheet({ icon: '✨', title: 'Soll ich das analysieren?', body: `${media.name} · ${humanSize(media.size)}`, confirmLabel: 'Analysieren' });
  if (!ok) return;
  const closing = toast('Analysiere…', { icon: '⏳', duration: 60000 });
  try {
    const text = await analyzeMedia({ kind: media.kind, dataUrl: media.dataUrl, name: media.name, mime: media.mime, prompt: 'Beschreibe knapp und hilfreich auf Deutsch, was hier zu sehen ist.' });
    closing.remove();
    if (text) {
      sendContextToAgent(media.kind, text);
      await infoSheet({ icon: '✨', title: 'Analyse', body: text.slice(0, 1200) });
    }
  } catch (e) {
    closing.remove();
    await infoSheet({ icon: '⚠️', title: 'Analyse nicht möglich', body: String(e && e.message || e) });
  }
}

async function shareOrKeep(file) {
  const ok = await confirmSheet({ icon: '📤', title: 'Video teilen?', body: 'Du kannst das Video direkt teilen oder behalten.', confirmLabel: 'Teilen', cancelLabel: 'Behalten' });
  if (ok) await shareContent({ title: 'Video', files: [file] });
}

// Hands context to the live agent (best-effort; surfaced to the user regardless).
function sendContextToAgent(kind, text) {
  try { window.LKApp && window.LKApp.publishData && window.LKApp.publishData({ type: 'user_context', kind, text: String(text).slice(0, 4000) }, 'app'); } catch {}
}

// ---- Agent-initiated capability requests (contextual popups) ----------------
// Ready for when the agent publishes {type:'tool_request', id, tool, prompt}.
function handleAgentData(msg) {
  if (!msg || msg.type !== 'tool_request') return;
  const labels = {
    getLocation: 'deinen Standort verwenden',
    takePhoto: 'ein Foto aufnehmen',
    recordVideo: 'ein Video aufnehmen',
    pickFile: 'eine Datei auswählen',
    pasteFromClipboard: 'den kopierten Inhalt übernehmen',
    shareContent: 'etwas teilen',
  };
  const what = labels[msg.tool] || 'eine Funktion nutzen';
  confirmSheet({ icon: '🤝', title: 'Darf ich ' + what + '?', body: msg.prompt || '', confirmLabel: 'Ja' }).then(async (ok) => {
    const reply = (payload) => { try { window.LKApp.publishData({ type: 'tool_result', id: msg.id, tool: msg.tool, ok: ok && !payload?.error, ...payload }, 'app'); } catch {} };
    if (!ok) return reply({ declined: true });
    try {
      if (msg.tool === 'getLocation') { const c = await getLocationContext(); reply({ result: toAgentPayload(c) }); }
      else if (msg.tool === 'takePhoto') { const p = await capturePhoto(); reply({ result: p ? { name: p.name, size: p.size } : null }); }
      else if (msg.tool === 'pickFile') { const d = await pickDocuments({ multiple: false }); reply({ result: d[0] ? { name: d[0].name, size: d[0].size, type: d[0].type } : null }); }
      else if (msg.tool === 'pasteFromClipboard') { const t = await readClipboard(); reply({ result: t || null }); }
      else if (msg.tool === 'shareContent') { const done = await shareContent({ title: 'Engelmann', text: msg.text, url: msg.url }); reply({ result: { shared: done } }); }
      else reply({ error: 'unknown tool' });
    } catch (e) { reply({ error: String(e && e.message || e) }); }
  });
}

// ---- Bootstrap --------------------------------------------------------------
async function boot() {
  const env = summary();
  log('capabilities', env);
  document.documentElement.dataset.standalone = String(env.standalone);

  registerServiceWorker();
  const installer = initInstallPrompt();

  injectTrayCss();
  const fab = document.createElement('button');
  fab.className = 'ek-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Funktionen öffnen');
  fab.textContent = '＋';
  fab.addEventListener('click', () => openTray(installer));
  document.body.appendChild(fab);

  // Wire agent->browser tool requests as soon as the LiveKit bridge exists.
  waitForLKApp().then((app) => { if (app && app.setDataHandler) app.setDataHandler(handleAgentData); });

  // Location first (so the greeting can use it), but never block the voice start
  // for more than ~4s (e.g. if the user ignores the location prompt).
  if (env.isMobile || caps.geolocation) {
    await Promise.race([primeLocation(), new Promise((r) => setTimeout(r, 4000))]);
  }
  await initVoice();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
