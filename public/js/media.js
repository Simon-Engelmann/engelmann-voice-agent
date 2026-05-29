// Device media + sharing capabilities. Every action is user-initiated and
// visible (no silent capture). iOS limits are handled with honest fallbacks.
import { caps } from './capabilities.js';
import { sheet, toast, infoSheet } from './ui.js';

export function humanSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

// Opens a transient <input type=file>. Resolves with File[] (possibly empty).
export function pickFiles({ accept = '', multiple = false, capture = null } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    if (multiple) input.multiple = true;
    if (capture) input.setAttribute('capture', capture);
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let done = false;
    const finish = (files) => { if (done) return; done = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => finish([...(input.files || [])]));
    // If the user cancels, there is no reliable event on all browsers; clean up on focus return.
    window.addEventListener('focus', () => setTimeout(() => finish([]), 1200), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

// Compress an image client-side before upload/analysis.
export function compressImage(file, { maxDim = 1600, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Bild konnte nicht verarbeitet werden.'));
          const reader = new FileReader();
          reader.onload = () => resolve({ blob, dataUrl: reader.result, width: w, height: h });
          reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
          reader.readAsDataURL(blob);
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden.')); };
    img.src = url;
  });
}

// Apple-near media preview with Retake / Confirm. mediaType: 'image'|'video'.
function previewConfirm({ src, mediaType, caption }) {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'ek-scrim show';
    scrim.style.zIndex = '1050';
    const media = mediaType === 'video'
      ? `<video src="${src}" controls playsinline style="width:100%;border-radius:14px;max-height:46dvh;background:#000"></video>`
      : `<img src="${src}" alt="Vorschau" style="width:100%;border-radius:14px;max-height:46dvh;object-fit:contain;background:#000">`;
    scrim.innerHTML = `<div class="ek-sheet"><div class="ek-pad"><h2 class="ek-title">Vorschau</h2>${media}${caption ? `<p class="ek-body">${caption}</p>` : ''}</div><div class="ek-actions"><button class="ek-btn primary" data-v="ok">Verwenden</button><button class="ek-btn ghost" data-v="retake">Neu aufnehmen</button><button class="ek-btn ghost" data-v="cancel">Abbrechen</button></div></div>`;
    const close = (v) => { scrim.classList.remove('show'); setTimeout(() => scrim.remove(), 220); resolve(v); };
    scrim.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => close(b.dataset.v)));
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close('cancel'); });
    document.body.appendChild(scrim);
  });
}

// Take/choose a photo (rear camera on mobile), compress, preview, confirm.
export async function capturePhoto({ analyzePrompt } = {}) {
  const files = await pickFiles({ accept: 'image/*', capture: 'environment' });
  if (!files.length) return null;
  let processed;
  try {
    processed = await compressImage(files[0]);
  } catch (e) {
    toast(String(e.message || e), { icon: '⚠️' });
    return null;
  }
  while (true) {
    const choice = await previewConfirm({ src: processed.dataUrl, mediaType: 'image', caption: `${processed.width}×${processed.height} · ${humanSize(processed.blob.size)}` });
    if (choice === 'ok') {
      return { dataUrl: processed.dataUrl, blob: processed.blob, name: files[0].name || 'foto.jpg', size: processed.blob.size, analyzePrompt };
    }
    if (choice === 'retake') {
      const again = await pickFiles({ accept: 'image/*', capture: 'environment' });
      if (!again.length) return null;
      try { processed = await compressImage(again[0]); } catch { return null; }
      continue;
    }
    return null;
  }
}

const MAX_VIDEO = 80 * 1024 * 1024; // 80 MB guard
export async function captureVideo() {
  const files = await pickFiles({ accept: 'video/*', capture: 'environment' });
  if (!files.length) return null;
  const file = files[0];
  if (file.size > MAX_VIDEO) {
    await infoSheet({ icon: '🎬', title: 'Video zu groß', body: `Das Video ist ${humanSize(file.size)}. Bitte ein kürzeres (max. ${humanSize(MAX_VIDEO)}) wählen.` });
    return null;
  }
  const src = URL.createObjectURL(file);
  const choice = await previewConfirm({ src, mediaType: 'video', caption: `${file.name} · ${humanSize(file.size)}` });
  setTimeout(() => URL.revokeObjectURL(src), 1000);
  return choice === 'ok' ? { file, name: file.name, size: file.size } : null;
}

// Universal file picker with type/size summary.
export async function pickDocuments({ multiple = true } = {}) {
  const accept = 'application/pdf,image/*,video/*,audio/*,text/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
  const files = await pickFiles({ accept, multiple });
  return files.map((f) => ({ file: f, name: f.name, size: f.size, type: f.type || 'unbekannt' }));
}

// Clipboard import: prefer the real API (needs a user gesture), fall back to a
// manual paste field. Never reads silently.
export async function readClipboard() {
  if (caps.clipboardRead) {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) return text;
    } catch {
      // permission denied or not available -> fall through to manual paste
    }
  }
  return manualPaste();
}

function manualPaste() {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'ek-scrim show';
    scrim.style.zIndex = '1050';
    scrim.innerHTML = `<div class="ek-sheet"><div class="ek-pad"><div class="ek-ic">📋</div><h2 class="ek-title">Inhalt einfügen</h2><p class="ek-body">Füge den kopierten Text hier ein.</p><textarea style="width:100%;min-height:120px;border-radius:12px;border:1px solid rgba(0,0,0,.15);padding:10px;font:inherit;font-size:15px;resize:vertical" placeholder="Hier einfügen…"></textarea></div><div class="ek-actions"><button class="ek-btn primary" data-v="ok">Übernehmen</button><button class="ek-btn ghost" data-v="cancel">Abbrechen</button></div></div>`;
    const ta = scrim.querySelector('textarea');
    const close = (v) => { scrim.classList.remove('show'); setTimeout(() => scrim.remove(), 220); resolve(v); };
    scrim.querySelector('[data-v="ok"]').addEventListener('click', () => close(ta.value.trim() || null));
    scrim.querySelector('[data-v="cancel"]').addEventListener('click', () => close(null));
    document.body.appendChild(scrim);
    setTimeout(() => ta.focus(), 80);
  });
}

// Web Share with graceful fallbacks (copy link / download / explain).
export async function shareContent({ title, text, url, files } = {}) {
  if (files && files.length && caps.canShare) {
    try {
      if (navigator.canShare({ files })) { await navigator.share({ title, text, files }); return true; }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
  }
  if (caps.webShare && (text || url || title)) {
    try { await navigator.share({ title, text, url }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return false; }
  }
  // Fallbacks
  if (url && caps.clipboardWrite) {
    try { await navigator.clipboard.writeText(url); toast('Link kopiert', { icon: '🔗' }); return true; } catch {}
  }
  if (files && files.length) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(files[0]);
    a.download = files[0].name || 'datei';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Datei wird heruntergeladen', { icon: '⬇️' });
    return true;
  }
  await infoSheet({ icon: 'ℹ️', title: 'Teilen', body: 'Teilen wird hier nicht direkt unterstützt. Kopiere den Inhalt manuell.' });
  return false;
}

// Sends an image (dataUrl) or PDF to the server for AI analysis.
export async function analyzeMedia({ kind, dataUrl, name, mime, prompt }) {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, dataUrl, name, mime, prompt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const reason = data && data.error ? data.error : `Fehler ${res.status}`;
    if (data && data.fallback) { await infoSheet({ icon: '📄', title: 'Analyse', body: reason }); return null; }
    throw new Error(reason);
  }
  return data.text || '';
}
