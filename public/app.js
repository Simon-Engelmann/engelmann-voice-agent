const DEFAULT_INSTRUCTIONS = 'Du bist Simons deutscher Voice-Agent. Sprich kurz, klar, nüchtern und trocken-humorig. Sprich mit deutscher Aussprache und deutscher Satzmelodie. Keine englischen Füllwörter. Keine KI-Floskeln. Maximal 1 bis 3 Sätze.';
const SIMLI_SDK_URL = 'https://esm.sh/simli-client@latest';

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
let remoteAudio = null;
let dragStartY = 0;
let currentAiBubble = null;
let connecting = false;
let stopSpeakingTimer = null;

let simliClient = null;
let simliAudio = null;
let simliReady = false;
let simliFailed = false;
let pendingAssistantTrack = null;
let manualBridgeStarted = false;
let firstAssistantAudioSeen = false;
let manualQueue = [];
let audioContext = null;
let assistantSource = null;
let assistantProcessor = null;
let assistantSilenceGain = null;

window.addEventListener('error', (event) => console.warn(event.error || event.message));
window.addEventListener('unhandledrejection', (event) => console.warn(event.reason));

startApp();

function startApp() {
  setStatus('Lade Simli...');
  initSimliSafe();
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
  chatLog.scrollTop = chatLog.scrollHeight;
}

function markSpeaking() {
  clearTimeout(stopSpeakingTimer);
  stage.classList.add('speaking');
  root.style.setProperty('--pulse', '.28');
}

function markSilentSoon() {
  clearTimeout(stopSpeakingTimer);
  stopSpeakingTimer = setTimeout(() => {
    stage.classList.remove('speaking');
    root.style.setProperty('--pulse', '.12');
  }, 700);
}

async function initSimliSafe() {
  try {
    const sessionResponse = await fetch('/simli/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'fasttalk' })
    });

    const session = await sessionResponse.json().catch(() => ({}));
    if (!sessionResponse.ok || !session.session_token) {
      throw new Error(session.error || session.message || JSON.stringify(session));
    }

    const sdk = await import(SIMLI_SDK_URL);
    const SimliClient = sdk.SimliClient;
    const LogLevel = sdk.LogLevel || { INFO: 'info', DEBUG: 'debug' };
    if (!SimliClient) throw new Error('SimliClient nicht gefunden.');

    simliVideo.autoplay = true;
    simliVideo.playsInline = true;
    simliVideo.muted = true;
    simliVideo.setAttribute('playsinline', '');

    simliAudio = document.createElement('audio');
    simliAudio.id = 'simliAudio';
    simliAudio.autoplay = true;
    simliAudio.playsInline = true;
    simliAudio.muted = false;
    simliAudio.setAttribute('playsinline', '');
    document.body.appendChild(simliAudio);

    simliClient = new SimliClient(
      session.session_token,
      simliVideo,
      simliAudio,
      null,
      LogLevel.INFO || LogLevel.DEBUG,
      'livekit'
    );

    simliClient.on('start', () => {
      simliReady = true;
      simliFailed = false;
      hideAvatarMessage();
      simliVideo.classList.add('show');
      if (remoteAudio) remoteAudio.muted = true;
      setStatus('Simli aktiv', 'ok');
      attachSimliToAssistantTrack();
      flushManualQueue();
    });

    simliClient.on('speaking', () => markSpeaking());
    simliClient.on('silent', () => markSilentSoon());
    simliClient.on('stop', () => {
      simliReady = false;
      setStatus('Simli getrennt', 'bad');
    });
    simliClient.on('error', (message) => showSimliError(message));
    simliClient.on('startup_error', (message) => showSimliError(message));

    await simliClient.start();
  } catch (error) {
    showSimliError(error?.message || String(error));
  }
}

function showSimliError(message) {
  simliFailed = true;
  simliReady = false;
  if (remoteAudio) remoteAudio.muted = false;
  const text = String(message || 'Unbekannter Simli Fehler');
  showAvatarMessage('Simli nicht verbunden.\n' + text);
  setStatus('Simli Fehler', 'bad');
  console.warn('Simli error:', text);
}

function attachSimliToAssistantTrack() {
  if (!simliClient || !simliReady || !pendingAssistantTrack || simliFailed) return;

  try {
    if (typeof simliClient.listenToMediastreamTrack === 'function') {
      simliClient.listenToMediastreamTrack(pendingAssistantTrack);
      if (remoteAudio) remoteAudio.muted = true;
      setStatus('Simli aktiv', 'ok');
      return;
    }
  } catch (error) {
    console.warn('listenToMediastreamTrack failed:', error);
  }

  startManualAssistantAudioBridge(pendingAssistantTrack);
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
    if (manualQueue.length < 80) manualQueue.push(bytes);
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

function base64ToPcm16(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Int16Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

function floatToPcm16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
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

function startManualAssistantAudioBridge(track) {
  if (manualBridgeStarted || !track) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    audioContext = audioContext || new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

    const stream = new MediaStream([track]);
    assistantSource = audioContext.createMediaStreamSource(stream);
    assistantProcessor = audioContext.createScriptProcessor(2048, 1, 1);
    assistantSilenceGain = audioContext.createGain();
    assistantSilenceGain.gain.value = 0;

    assistantProcessor.onaudioprocess = (event) => {
      const samples = event.inputBuffer.getChannelData(0);
      let level = 0;
      for (let i = 0; i < samples.length; i += 8) level += Math.abs(samples[i]);
      level = level / (samples.length / 8);
      if (level > 0.006) {
        markSpeaking();
        firstAssistantAudioSeen = true;
      }

      const pcm = floatToPcm16(samples);
      const pcm16k = resamplePcm16(pcm, audioContext.sampleRate || 48000, 16000);
      sendPcm16ToSimli(pcm16k);
    };

    assistantSource.connect(assistantProcessor);
    assistantProcessor.connect(assistantSilenceGain);
    assistantSilenceGain.connect(audioContext.destination);
    manualBridgeStarted = true;
  } catch (error) {
    console.warn('Manual Simli bridge failed:', error);
  }
}

function stopManualBridge() {
  try { assistantProcessor?.disconnect(); } catch (_) {}
  try { assistantSource?.disconnect(); } catch (_) {}
  try { assistantSilenceGain?.disconnect(); } catch (_) {}
  assistantProcessor = null;
  assistantSource = null;
  assistantSilenceGain = null;
  manualBridgeStarted = false;
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

    remoteAudio = remoteAudio || document.createElement('audio');
    remoteAudio.autoplay = true;
    remoteAudio.playsInline = true;
    remoteAudio.muted = simliReady;
    remoteAudio.setAttribute('playsinline', '');
    document.body.appendChild(remoteAudio);

    pc = new RTCPeerConnection();

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      const remoteTrack = remoteStream?.getAudioTracks?.()[0];
      pendingAssistantTrack = remoteTrack || null;

      remoteAudio.srcObject = remoteStream;
      remoteAudio.muted = simliReady;
      remoteAudio.play().catch(() => {});

      if (pendingAssistantTrack) attachSimliToAssistantTrack();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus(simliReady ? 'Simli aktiv' : 'Sprich jetzt', 'ok');
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') setStatus('Verbindung weg', 'bad');
    };

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    dc = pc.createDataChannel('oai-events');
    dc.onopen = () => {
      setStatus(simliReady ? 'Simli aktiv' : 'Sprich jetzt', 'ok');
      bubble('system', simliReady ? 'Simli aktiv. Stimme läuft über Avatar.' : 'Stimme läuft. Simli noch nicht bereit.');

      const greetings = [
        'Begrüße Simon kurz: Moin Simon. Ich bin wach. Mehr kann man technisch kaum verlangen.',
        'Begrüße Simon kurz: Hi Simon. System läuft, Laune stabil, Rest verhandeln wir.',
        'Begrüße Simon kurz: Simon, da bist du ja. Ich habe schon mal so getan, als wäre ich produktiv.'
      ];

      const greeting = greetings[Math.floor(Math.random() * greetings.length)];
      setTimeout(() => {
        try { dc.send(JSON.stringify({ type: 'response.create', response: { instructions: greeting } })); } catch (_) {}
      }, 500);
    };

    dc.onerror = () => setStatus('DataChannel-Fehler', 'bad');
    dc.onmessage = (event) => handleRealtime(event.data);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResp = await fetchWithTimeout('/rtc-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: offer.sdp, instructions: DEFAULT_INSTRUCTIONS, voice: 'coral' })
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
  stopManualBridge();
  clearSimliBuffer();
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

function handleRealtime(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return; }
  const type = msg.type || '';

  if (type === 'input_audio_buffer.speech_started' || type === 'conversation.interrupted') clearSimliBuffer();
  if (type === 'response.created' || type === 'response.audio.delta') markSpeaking();
  if (type === 'response.audio.delta' && msg.delta && !firstAssistantAudioSeen) {
    try { sendPcm16ToSimli(resamplePcm16(base64ToPcm16(msg.delta), 24000, 16000)); } catch (_) {}
  }
  if (type === 'response.audio.done') markSilentSoon();
  if (type === 'response.audio_transcript.delta' && msg.delta) aiDelta(msg.delta);
  if (type === 'response.output_text.delta' && msg.delta) aiDelta(msg.delta);
  if (type === 'response.audio_transcript.done' || type === 'response.output_text.done' || type === 'response.done') {
    currentAiBubble = null;
    markSilentSoon();
  }
  if (type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) bubble('me', msg.transcript);
  if (type === 'error') bubble('system', msg.error?.message || JSON.stringify(msg));
}

function startTap(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {});
  if (simliAudio) simliAudio.play().catch(() => {});
  if (remoteAudio) remoteAudio.play().catch(() => {});
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
