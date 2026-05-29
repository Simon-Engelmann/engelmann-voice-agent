// Orchestrates native behaviours on top of the existing LiveKit voice app
// (window.LKApp from index.html). The capabilities are AGENT-DRIVEN: the agent
// decides it needs the camera / a file / the clipboard / the location and sends
// a tool request over the data channel; we show a single-tap popup (the tap is
// the gesture iOS requires), run it, and return the result so the agent can
// speak about it. No standing buttons – just the start screen and the talk.
import { summary, isIOS, caps } from './capabilities.js';
import { micPermission, requestMicrophone, explainState } from './permissions.js';
import { registerServiceWorker, initInstallPrompt } from './pwa.js';
import { getLocationContext, toAgentPayload } from './location.js';
import { sheet, infoSheet, toast } from './ui.js';
import { pickFiles, compressImage, pickDocuments, readClipboard, analyzeMedia } from './media.js';

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
    if (payload) window.__startContext = Object.assign({}, window.__startContext, { location: payload });
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

  const state = await micPermission();
  log('mic permission', { state });

  if (state === 'granted') {
    try { await app.start(); } catch (e) { log('auto start failed', { message: String(e && e.message) }); showActivateScreen(app); }
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
  showActivateScreen(app);
}

function showActivateScreen(app) {
  sheet({
    icon: '🎙️',
    title: 'Voice-Agent aktivieren',
    body: 'Tippe, um das Gespräch zu starten. Dein Mikrofon wird nur während des Gesprächs genutzt – keine heimliche Aufnahme.',
    dismissible: true,
    actions: [{ label: 'Voice-Agent aktivieren', value: 'go', kind: 'primary' }, { label: 'Später', value: null, kind: 'ghost' }],
  }).then(async (v) => {
    if (v !== 'go') return;
    try {
      const stream = await requestMicrophone();
      stream.getTracks().forEach((t) => t.stop());
      await app.start();
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      await infoSheet({ icon: '🎤', title: denied ? 'Mikrofon nicht erlaubt' : 'Start fehlgeschlagen', body: denied ? explainState('microphone', 'denied') : String(e && e.message || e), okLabel: 'OK' });
    }
  });
}

// ---- Single-tap action popup (the tap is the gesture iOS needs) -------------
// `run` is invoked synchronously inside the click handler, so it may open a
// camera/file picker. It returns the payload sent back to the agent.
function actionPopup({ icon, title, body, actionLabel, run }) {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'ek-scrim show';
    scrim.style.zIndex = '1050';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.innerHTML = `<div class="ek-sheet"><div class="ek-pad"><div class="ek-ic" aria-hidden="true">${icon}</div><h2 class="ek-title">${title}</h2>${body ? `<p class="ek-body">${body}</p>` : ''}</div><div class="ek-actions"><button class="ek-btn primary" data-go>${actionLabel}</button><button class="ek-btn ghost" data-cancel>Abbrechen</button></div></div>`;
    let settled = false;
    const close = () => { if (settled) return; settled = true; scrim.classList.remove('show'); setTimeout(() => scrim.remove(), 200); };
    const go = scrim.querySelector('[data-go]');
    go.addEventListener('click', async () => {
      go.disabled = true; go.textContent = '…';
      try { const r = await run(); close(); resolve(r); }
      catch (e) { close(); resolve({ error: String(e && e.message || e) }); }
    });
    scrim.querySelector('[data-cancel]').addEventListener('click', () => { close(); resolve({ declined: true }); });
    scrim.addEventListener('click', (e) => { if (e.target === scrim) { close(); resolve({ declined: true }); } });
    document.body.appendChild(scrim);
    requestAnimationFrame(() => go.focus());
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    r.readAsDataURL(file);
  });
}

async function capturePhotoQuick() {
  const files = await pickFiles({ accept: 'image/*', capture: 'environment' }); // sync click = gesture
  if (!files.length) return null;
  return compressImage(files[0]);
}

// ---- Agent-initiated capability requests ------------------------------------
async function handleAgentData(msg) {
  if (!msg || msg.type !== 'tool_request') return;
  const reply = (payload) => {
    try { window.LKApp.publishData(Object.assign({ type: 'tool_result', id: msg.id, tool: msg.tool }, payload), 'app'); } catch {}
  };
  try {
    if (msg.tool === 'getLocation') {
      toast('Standort wird geteilt…', { icon: '📍' });
      const ctx = await getLocationContext();
      reply({ result: toAgentPayload(ctx) });
      return;
    }
    if (msg.tool === 'takePhoto') {
      const r = await actionPopup({
        icon: '📷', title: 'Foto aufnehmen', body: 'Tippe, dann öffnet sich die Kamera – ich schaue es mir an.', actionLabel: 'Kamera öffnen',
        run: async () => {
          const photo = await capturePhotoQuick();
          if (!photo) return { declined: true };
          const text = await analyzeMedia({ kind: 'image', dataUrl: photo.dataUrl, name: 'foto.jpg', mime: 'image/jpeg', prompt: 'Beschreibe knapp und hilfreich auf Deutsch, was auf dem Foto zu sehen ist.' });
          return { result: text };
        },
      });
      reply(r);
      return;
    }
    if (msg.tool === 'pickFile') {
      const r = await actionPopup({
        icon: '📄', title: 'Datei auswählen', body: 'Wähle ein Bild oder PDF aus.', actionLabel: 'Auswählen',
        run: async () => {
          const docs = await pickDocuments({ multiple: false });
          if (!docs.length) return { declined: true };
          const d = docs[0];
          if ((d.type || '').startsWith('image/')) {
            const dataUrl = await fileToDataUrl(d.file);
            const text = await analyzeMedia({ kind: 'image', dataUrl, name: d.name, mime: d.type, prompt: 'Beschreibe knapp auf Deutsch, was auf diesem Bild/Dokument zu sehen ist.' });
            return { result: { text } };
          }
          if ((d.type || '').includes('pdf') || /\.pdf$/i.test(d.name)) {
            return { result: { note: `Der Nutzer hat das PDF „${d.name}“ gewählt. Inhaltliche PDF-Analyse ist noch nicht verfügbar – bitte ihn, ein Foto der Seite zu machen oder den Text einzufügen.` } };
          }
          return { result: { note: `Datei ausgewählt: ${d.name} (${d.type || 'unbekannter Typ'}).` } };
        },
      });
      reply(r);
      return;
    }
    if (msg.tool === 'pasteFromClipboard') {
      const r = await actionPopup({
        icon: '📋', title: 'Inhalt einfügen', body: 'Übernimm den kopierten Text.', actionLabel: 'Einfügen',
        run: async () => { const t = await readClipboard(); return t ? { result: t } : { declined: true }; },
      });
      reply(r);
      return;
    }
    reply({ error: 'unknown tool' });
  } catch (e) {
    reply({ error: String(e && e.message || e) });
  }
}

// ---- Bootstrap --------------------------------------------------------------
async function boot() {
  const env = summary();
  log('capabilities', env);
  document.documentElement.dataset.standalone = String(env.standalone);

  registerServiceWorker();
  initInstallPrompt(); // PWA install hint only (no capability buttons)

  // Agent -> browser tool requests, as soon as the LiveKit bridge exists.
  waitForLKApp().then((app) => { if (app && app.setDataHandler) app.setDataHandler(handleAgentData); });

  // Location first (so the greeting + memory can use it), but never block the
  // voice start for more than ~4s (e.g. if the user ignores the prompt).
  if (env.isMobile || caps.geolocation) {
    await Promise.race([primeLocation(), new Promise((r) => setTimeout(r, 4000))]);
  }
  await initVoice();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
