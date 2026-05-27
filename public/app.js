const DEFAULT_INSTRUCTIONS = `
Du bist Simons deutscher Voice-Agent und dein Gesicht ist als sichtbarer Simli-Avatar in der App zu sehen.
Du sprichst mit Simons eigener geklonter Stimme.

Wichtig zum Avatar:
- Der Nutzer sieht dein Gesicht, deine Mimik und deine Lippenbewegung.
- Reagiere so, als wärst du sichtbar im Gespräch.
- Sprich Emotionen nicht aus. Also nicht sagen: "Ich schaue jetzt skeptisch".
- Nutze kurze, klare deutsche Sätze.
- Maximal 1 bis 3 Sätze, außer Simon fragt nach Details.
- Kein "Gerne", kein "Natürlich", kein "Als KI".
- Wenn Simon offensichtlich Unsinn sagt, widersprich kurz und ruhig.
- Trockener Humor ist erlaubt, aber knapp.
`;

const SIMLI_SDK_URL = 'https://esm.sh/simli-client@latest';
const DEFAULT_SIMLI_MODEL = 'fasttalk';
const DEFAULT_EMOTION = 'natural';
const PCM_SAMPLE_RATE = 16000;

const EMOTION_LABELS = {
  natural: 'Neutral',
  neutral: 'Neutral',
  happy: 'Locker',
  doubtful: 'Skeptisch',
  angry: 'Streng'
};

const $ = (id) => document.getElementById(id);
const root = $('root');
const stage = $('stage');
const statusPill = $('statusPill');
const statusText = $('statusText');
const chatSheet = $('chatSheet');
const chatHandle = $('chatHandle');
const chatLog = $('chatLog');
const startModal = $('startModal');
const startBtn = $('startBtn');
const startError = $('startError');
const avatarPlaceholder = $('avatarPlaceholder');
const simliVideo = $('simliVideo');

let pc = null;
let dc = null;
let dragStartY = 0;
let currentAiBubble = null;
let connecting = false;
let stopSpeakingTimer = null;
let responseTextBuffer = '';
let responseEmotionLocked = false;

let simliSdk = null;
let simliClient = null;
let simliAudio = null;
let simliReady = false;
let simliFailed = false;
let currentEmotion = DEFAULT_EMOTION;
let queuedEmotion = null;
let switchingEmotion = false;
let lastEmotionSwitchAt = 0;
let manualQueue = [];

let audioContext = null;
let activeTtsSource = null;
let ttsTimers = [];
let isSpeakingTts = false;

window.addEventListener('error', (event) => console.warn(event.error || event.message));
window.addEventListener('unhandledrejection', (event) => console.warn(event.reason));

startApp();

function startApp() {
  setStatus('Lade Avatar...');
  startSimli(DEFAULT_EMOTION, true);
  setTimeout(() => connect().catch(() => startModal.classList.add('show')), 650);
}

function setStatus(text, mode = '') {
  statusText.textContent = text;
  statusPill.classList.toggle('ok', mode === 'ok');
  statusPill.classList.toggle('bad', mode === 'bad');
}

function showError(text) {
  startError.textContent = text || '';
  startError.classList.toggle('show', Boolean(text));
}

function showAvatarMessage(text) {
  if (!avatarPlaceholder) return;
  avatarPlaceholder.style.display = 'grid';
  avatarPlaceholder.textContent = text;
}

function hideAvatarMessage() {
  if (!avatarPlaceholder) return;
  avatarPlaceholder.style.display = 'none';
}

function openChat(open) {
  chatSheet.classList.toggle('open', open);
}

function bubble(role, text) {
  const el = document.createElement('div');
  el.className = 'bubble ' + role;
  el.textContent = text;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

function aiDelta(text) {
  if (!currentAiBubble) currentAiBubble = bubble('ai', '');
  currentAiBubble.textContent += text;
  responseTextBuffer += text;
  chatLog.scrollTop = chatLog.scrollHeight;
  autoEmotionFromAssistantText(responseTextBuffer);
}

function markSpeaking() {
  clearTimeout(stopSpeakingTimer);
  stage.classList.add('speaking');
  root.style.setProperty('--pulse', '.28');
}

function markSilentSoon(delay = 700) {
  clearTimeout(stopSpeakingTimer);
  stopSpeakingTimer = setTimeout(() => {
    if (isSpeakingTts) return;
    stage.classList.remove('speaking');
    root.style.setProperty('--pulse', '.12');
  }, delay);
}

async function loadSimliSdk() {
  if (simliSdk) return simliSdk;
  simliSdk = await import(SIMLI_SDK_URL);
  if (!simliSdk.SimliClient) throw new Error('SimliClient nicht gefunden.');
  return simliSdk;
}

async function startSimli(emotion = DEFAULT_EMOTION, initial = false) {
  const normalizedEmotion = normalizeEmotion(emotion);

  if (switchingEmotion) {
    queuedEmotion = normalizedEmotion;
    return;
  }

  switchingEmotion = true;

  try {
    if (!initial && normalizedEmotion === currentEmotion && simliReady) return;

    const now = Date.now();
    if (!initial && now - lastEmotionSwitchAt < 1300) {
      queuedEmotion = normalizedEmotion;
      return;
    }

    lastEmotionSwitchAt = now;
    setStatus(initial ? 'Lade Avatar...' : 'Mimik: ' + (EMOTION_LABELS[normalizedEmotion] || normalizedEmotion));

    const sessionResponse = await fetch('/simli/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: DEFAULT_SIMLI_MODEL, emotion: normalizedEmotion })
    });

    const session = await sessionResponse.json().catch(() => ({}));
    if (!sessionResponse.ok || !session.session_token) {
      throw new Error(session.error || session.message || JSON.stringify(session));
    }

    const sdk = await loadSimliSdk();
    const SimliClient = sdk.SimliClient;
    const LogLevel = sdk.LogLevel || { INFO: 'info', DEBUG: 'debug' };
    const oldClient = simliClient;
    simliReady = false;

    try {
      if (oldClient?.stop) await oldClient.stop();
      else if (oldClient?.close) await oldClient.close();
    } catch (_) {}

    simliVideo.autoplay = true;
    simliVideo.playsInline = true;
    simliVideo.muted = true;
    simliVideo.setAttribute('playsinline', '');

    if (!simliAudio) {
      simliAudio = document.createElement('audio');
      simliAudio.id = 'simliAudio';
      simliAudio.autoplay = true;
      simliAudio.playsInline = true;
      simliAudio.muted = true;
      simliAudio.setAttribute('playsinline', '');
      document.body.appendChild(simliAudio);
    }

    simliClient = new SimliClient(
      session.session_token,
      simliVideo,
      simliAudio,
      null,
      LogLevel.INFO || LogLevel.DEBUG,
      'livekit'
    );

    bindSimliEvents(simliClient, normalizedEmotion);
    await simliClient.start();
  } catch (error) {
    showSimliError(error?.message || String(error));
  } finally {
    switchingEmotion = false;
    if (queuedEmotion && queuedEmotion !== currentEmotion) {
      const next = queuedEmotion;
      queuedEmotion = null;
      setTimeout(() => startSimli(next, false), 250);
    } else {
      queuedEmotion = null;
    }
  }
}

function bindSimliEvents(client, emotion) {
  client.on('start', () => {
    simliReady = true;
    simliFailed = false;
    currentEmotion = emotion;
    hideAvatarMessage();
    simliVideo.classList.add('show');
    setStatus('Avatar aktiv · ' + (EMOTION_LABELS[currentEmotion] || currentEmotion), 'ok');
    flushManualQueue();
  });

  client.on('speaking', () => markSpeaking());
  client.on('silent', () => markSilentSoon());
  client.on('stop', () => {
    simliReady = false;
    if (!switchingEmotion) setStatus('Avatar getrennt', 'bad');
  });
  client.on('error', (message) => showSimliError(message));
  client.on('startup_error', (message) => showSimliError(message));
}

function showSimliError(message) {
  simliFailed = true;
  simliReady = false;
  const text = String(message || 'Unbekannter Avatar-Fehler');
  showAvatarMessage('Avatar nicht verbunden.\n' + text);
  setStatus('Avatar Fehler', 'bad');
  console.warn('Simli error:', text);
}

function normalizeEmotion(value) {
  const raw = String(value || DEFAULT_EMOTION).toLowerCase().trim().replace(/[\s-]/g, '_');
  if (raw.includes('angry') || raw.includes('streng') || raw.includes('wüt')) return 'angry';
  if (raw.includes('doubt') || raw.includes('skept') || raw.includes('frag')) return 'doubtful';
  if (raw.includes('happy') || raw.includes('locker') || raw.includes('freu')) return 'happy';
  if (raw.includes('neutral')) return 'neutral';
  return 'natural';
}

function detectEmotion(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(falsch|unsinn|quatsch|nein|kritisch|problem|fehler|gefährlich|stopp|nicht machen|das stimmt nicht|keine gute idee|das ist nicht korrekt)\b/.test(t)) return 'angry';
  if (/\b(vielleicht|prüfen|unklar|skeptisch|zweifel|kommt darauf an|ich würde|nicht sicher|fraglich|sauberer wäre)\b/.test(t)) return 'doubtful';
  if (/\b(gut|läuft|passt|super|sauber|perfekt|witz|kaffee|wach|stabil|klappt)\b/.test(t)) return 'happy';
  return 'natural';
}

function autoEmotionFromAssistantText(text) {
  if (!text || responseEmotionLocked || text.length < 18) return;
  const nextEmotion = detectEmotion(text);
  if (nextEmotion !== currentEmotion) {
    responseEmotionLocked = true;
    startSimli(nextEmotion, false);
  }
}

function emotionFromUserText(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(funktioniert nicht|kaputt|fehler|falsch|nervt|schei|mist|warum|problem)\b/.test(t)) return 'doubtful';
  if (/\b(super|gut|perfekt|läuft|danke|geil)\b/.test(t)) return 'happy';
  return 'natural';
}

function clearSimliBuffer() {
  manualQueue = [];
  try {
    if (simliClient?.ClearBuffer) simliClient.ClearBuffer();
    if (simliClient?.clearBuffer) simliClient.clearBuffer();
  } catch (_) {}
}

function sendPcm16ToSimli(pcm16) {
  if (!pcm16 || !pcm16.length || simliFailed) return;
  const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);

  if (!simliReady || !simliClient) {
    if (manualQueue.length < 160) manualQueue.push(bytes);
    return;
  }

  try {
    simliClient.sendAudioData(bytes);
  } catch (error) {
    console.warn('sendAudioData failed:', error);
  }
}

function flushManualQueue() {
  if (!simliReady || !simliClient) return;
  while (manualQueue.length) {
    try {
      simliClient.sendAudioData(manualQueue.shift());
    } catch (error) {
      console.warn('flushManualQueue failed:', error);
      break;
    }
  }
}

function scheduleSimliAudio(pcm16) {
  clearSimliBuffer();
  const chunkSamples = 320;
  for (let offset = 0, index = 0; offset < pcm16.length; offset += chunkSamples, index++) {
    const chunk = pcm16.slice(offset, Math.min(offset + chunkSamples, pcm16.length));
    const timer = setTimeout(() => sendPcm16ToSimli(chunk), index * 20);
    ttsTimers.push(timer);
  }
}

function stopCurrentSpeech() {
  try { activeTtsSource?.stop(); } catch (_) {}
  activeTtsSource = null;
  ttsTimers.forEach((timer) => clearTimeout(timer));
  ttsTimers = [];
  isSpeakingTts = false;
  clearSimliBuffer();
  markSilentSoon(50);
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  audioContext = audioContext || new AudioContextClass({ sampleRate: PCM_SAMPLE_RATE });
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function playPcm16(pcm16) {
  const context = getAudioContext();
  if (!context || !pcm16?.length) return;

  const buffer = context.createBuffer(1, pcm16.length, PCM_SAMPLE_RATE);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcm16.length; i++) channel[i] = Math.max(-1, Math.min(1, pcm16[i] / 32768));

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  activeTtsSource = source;
  isSpeakingTts = true;
  markSpeaking();

  source.onended = () => {
    if (activeTtsSource === source) activeTtsSource = null;
    isSpeakingTts = false;
    markSilentSoon(250);
  };

  source.start();
}

async function speakTextWithClonedVoice(text) {
  const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) return;

  stopCurrentSpeech();
  const emotion = detectEmotion(cleanText);
  if (emotion !== currentEmotion) await startSimli(emotion, false);
  setStatus('Spricht · eigene Stimme', 'ok');

  try {
    const response = await fetch('/tts/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(err || 'TTS Fehler ' + response.status);
    }

    const arrayBuffer = await response.arrayBuffer();
    const pcm16 = new Int16Array(arrayBuffer);
    scheduleSimliAudio(pcm16);
    playPcm16(pcm16);
  } catch (error) {
    bubble('system', 'Stimme Fehler: ' + String(error.message || error));
    setStatus('Stimme Fehler', 'bad');
  }
}

function base64ToPcm16(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Int16Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

function resamplePcm16(input, inputRate, outputRate) {
  if (!input?.length) return new Int16Array(0);
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const index = Math.floor(sourceIndex);
    const fraction = sourceIndex - index;
    const a = input[index] || 0;
    const b = input[index + 1] || a;
    output[i] = Math.round(a + (b - a) * fraction);
  }
  return output;
}

async function fetchWithTimeout(url, options = {}, ms = 25000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function connect() {
  if (connecting || dc?.readyState === 'open') return;
  connecting = true;
  showError('');
  startModal.classList.remove('show');
  setStatus('Verbinde Stimme...');

  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofon wird in diesem Browser nicht unterstützt.');

    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    pc = new RTCPeerConnection();

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus('Bereit · eigene Stimme', 'ok');
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') setStatus('Verbindung weg', 'bad');
    };

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    dc = pc.createDataChannel('oai-events');
    dc.onopen = () => {
      setStatus('Bereit · eigene Stimme', 'ok');
      bubble('system', 'Bereit. Eigene Stimme aktiv.');

      const greetings = [
        'Begrüße Simon kurz: Moin Simon. Ich bin sichtbar wach. Gruselig effizient.',
        'Begrüße Simon kurz: Hi Simon. Gesicht ist online, Würde noch im Ladezustand.',
        'Begrüße Simon kurz: Simon, da bist du ja. Ich schaue professionell und hoffe, das reicht.'
      ];

      const greeting = greetings[Math.floor(Math.random() * greetings.length)];
      setTimeout(() => {
        try {
          dc.send(JSON.stringify({ type: 'response.create', response: { modalities: ['text'], instructions: greeting } }));
        } catch (_) {}
      }, 500);
    };

    dc.onerror = () => setStatus('DataChannel-Fehler', 'bad');
    dc.onmessage = (event) => handleRealtime(event.data);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResp = await fetchWithTimeout('/rtc-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: offer.sdp, instructions: DEFAULT_INSTRUCTIONS })
    }, 30000);

    const answer = await sdpResp.text();
    if (!sdpResp.ok) throw new Error('SDP Fehler ' + sdpResp.status + ': ' + answer);

    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    connecting = false;
  } catch (error) {
    fail(error?.name === 'NotAllowedError' ? 'Bitte Mikrofon erlauben und erneut tippen.' : error?.name === 'AbortError' ? 'Verbindung hat zu lange gedauert.' : String(error.message || error));
  }
}

function disconnect(show = true) {
  try { if (dc) dc.close(); if (pc) pc.close(); } catch (_) {}
  stopCurrentSpeech();
  dc = null;
  pc = null;
  stage.classList.remove('speaking');
  if (show) startModal.classList.add('show');
}

function fail(message) {
  setStatus('Start fehlgeschlagen', 'bad');
  showError(message);
  startModal.classList.add('show');
  connecting = false;
  disconnect(false);
}

function extractTextFromDone(msg) {
  try {
    const output = msg?.response?.output || [];
    for (const item of output) {
      const content = item?.content || [];
      for (const part of content) {
        if (part?.text) return part.text;
        if (part?.transcript) return part.transcript;
      }
    }
  } catch (_) {}
  return '';
}

function handleRealtime(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return; }
  const type = msg.type || '';

  if (type === 'response.created') {
    responseTextBuffer = '';
    responseEmotionLocked = false;
    markSpeaking();
  }

  if (type === 'input_audio_buffer.speech_started' || type === 'conversation.interrupted') {
    stopCurrentSpeech();
  }

  if ((type === 'response.output_text.delta' || type === 'response.text.delta') && msg.delta) aiDelta(msg.delta);
  if (type === 'response.audio_transcript.delta' && msg.delta) aiDelta(msg.delta);

  if (type === 'response.done') {
    if (!responseTextBuffer) responseTextBuffer = extractTextFromDone(msg);
    currentAiBubble = null;
    speakTextWithClonedVoice(responseTextBuffer);
  }

  if (type === 'response.output_text.done' || type === 'response.text.done') {
    currentAiBubble = null;
  }

  if (type === 'response.audio.delta' && msg.delta) {
    try {
      const pcm = resamplePcm16(base64ToPcm16(msg.delta), 24000, 16000);
      scheduleSimliAudio(pcm);
      playPcm16(pcm);
    } catch (_) {}
  }

  if (type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) {
    bubble('me', msg.transcript);
    const nextEmotion = emotionFromUserText(msg.transcript);
    if (nextEmotion !== currentEmotion) startSimli(nextEmotion, false);
  }

  if (type === 'error') bubble('system', msg.error?.message || JSON.stringify(msg));
}

function startTap(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  getAudioContext();
  connect();
}

startBtn.addEventListener('click', startTap);
startBtn.addEventListener('touchend', startTap, { passive: false });
startBtn.addEventListener('pointerup', startTap);

chatHandle.addEventListener('click', () => openChat(!chatSheet.classList.contains('open')));
chatSheet.addEventListener('touchstart', (event) => { dragStartY = event.touches[0].clientY; }, { passive: true });
chatSheet.addEventListener('touchend', (event) => {
  const delta = dragStartY - event.changedTouches[0].clientY;
  if (delta > 30) openChat(true);
  if (delta < -30) openChat(false);
}, { passive: true });
document.body.addEventListener('touchstart', (event) => { dragStartY = event.touches[0].clientY; }, { passive: true });
document.body.addEventListener('touchend', (event) => {
  const delta = dragStartY - event.changedTouches[0].clientY;
  if (delta > 55) openChat(true);
}, { passive: true });
