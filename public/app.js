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
const avatarFrame = $('avatarFrame');
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
let simliStarted = false;
let simliFailed = false;
let simliQueue = [];
let simliSending = false;
let firstAssistantAudioSeen = false;

let audioContext = null;
let assistantSource = null;
let assistantProcessor = null;
let assistantZeroGain = null;

window.addEventListener('error', (event) => failSoft(event.error || event.message));
window.addEventListener('unhandledrejection', (event) => failSoft(event.reason));

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

function failSoft(error) {
  console.warn(error);
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
      body: JSON.stringify({})
    });
    const session = await sessionResponse.json().catch(() => ({}));

    if (!sessionResponse.ok || !session.session_token) {
      throw new Error(session.error || JSON.stringify(session));
    }

    const iceResponse = await fetch('/simli/ice');
    const iceData = await iceResponse.json().catch(() => []);
    const iceServers = Array.isArray(iceData) ? iceData : (iceData.iceServers || iceData.ice_servers || []);

    const sdk = await import(SIMLI_SDK_URL);
    const SimliClient = sdk.SimliClient;
    const LogLevel = sdk.LogLevel || { INFO: 'info', DEBUG: 'debug' };
    if (!SimliClient) throw new Error('SimliClient nicht gefunden.');

    simliAudio = document.createElement('audio');
    simliAudio.autoplay = true;
    simliAudio.playsInline = true;
    simliAudio.muted = true;
    simliAudio.setAttribute('playsinline', '');
    document.body.appendChild(simliAudio);

    simliVideo.autoplay = true;
    simliVideo.playsInline = true;
    simliVideo.muted = true;
    simliVideo.setAttribute('playsinline', '');

    simliClient = new SimliClient(
      session.session_token,
      simliVideo,
      simliAudio,
      iceServers,
      LogLevel.INFO || LogLevel.DEBUG,
      'p2p'
    );

    simliClient.on('start', () => {
      simliReady = true;
      simliStarted = true;
      simliFailed = false;
      avatarPlaceholder.style.display = 'none';
      simliVideo.classList.add('show');
      setStatus('Simli bereit', 'ok');
      flushSimliQueue();
    });

    simliClient.on('speaking', () => {
      markSpeaking();
      simliVideo.classList.add('show');
    });

    simliClient.on('silent', () => markSilentSoon());

    simliClient.on('stop', () => {
      simliReady = false;
      setStatus('Simli getrennt', 'bad');
    });

    await simliClient.start();
  } catch (error) {
    simliFailed = true;
    simliReady = false;
    avatarPlaceholder.textContent = 'Simli nicht verbunden. Stimme läuft ohne Avatar-Sync.';
    setStatus('Simli Fehler', 'bad');
    console.warn('Simli init failed:', error);
  }
}

function feedSimliPcm16(pcm16) {
  if (!pcm16 || !pcm16.length || simliFailed) return;

  if (!simliReady || !simliClient) {
    if (simliQueue.length < 80) simliQueue.push(pcm16);
    return;
  }

  try {
    simliClient.sendAudioData(pcm16);
  } catch (error) {
    console.warn('Simli sendAudioData failed:', error);
  }
}

function flushSimliQueue() {
  if (simliSending) return;
  simliSending = true;
  try {
    while (simliQueue.length && simliReady && simliClient) {
      simliClient.sendAudioData(simliQueue.shift());
    }
  } catch (error) {
    console.warn('Simli queue failed:', error);
  } finally {
    simliSending = false;
  }
}

function clearSimliBuffer() {
  simliQueue = [];
  try {
    if (simliClient?.ClearBuffer) simliClient.ClearBuffer();
    if (simliClient?.clearBuffer) simliClient.clearBuffer();
  } catch (_) {}
}

function base64ToInt16Array(base64) {
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
  if (!input || !input.length) return new Int16Array(0);
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

function startAssistantAudioBridge(remoteStream) {
  try {
    stopAssistantAudioBridge();

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    audioContext = audioContext || new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

    assistantSource = audioContext.createMediaStreamSource(remoteStream);
    assistantProcessor = audioContext.createScriptProcessor(2048, 1, 1);
    assistantZeroGain = audioContext.createGain();
    assistantZeroGain.gain.value = 0;

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
      feedSimliPcm16(pcm16k);
    };

    assistantSource.connect(assistantProcessor);
    assistantProcessor.connect(assistantZeroGain);
    assistantZeroGain.connect(audioContext.destination);
  } catch (error) {
    console.warn('Assistant audio bridge failed:', error);
  }
}

function stopAssistantAudioBridge() {
  try { assistantProcessor?.disconnect(); } catch (_) {}
  try { assistantSource?.disconnect(); } catch (_) {}
  try { assistantZeroGain?.disconnect(); } catch (_) {}
  assistantProcessor = null;
  assistantSource = null;
  assistantZeroGain = null;
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

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    remoteAudio = remoteAudio || document.createElement('audio');
    remoteAudio.autoplay = true;
    remoteAudio.playsInline = true;
    remoteAudio.muted = false;
    remoteAudio.setAttribute('playsinline', '');
    document.body.appendChild(remoteAudio);

    pc = new RTCPeerConnection();

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      remoteAudio.srcObject = remoteStream;
      remoteAudio.play().catch(() => {});
      startAssistantAudioBridge(remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus(simliReady ? 'Simli aktiv' : 'Sprich jetzt', 'ok');
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') setStatus('Verbindung weg', 'bad');
    };

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    dc = pc.createDataChannel('oai-events');
    dc.onopen = () => {
      setStatus(simliReady ? 'Simli aktiv' : 'Sprich jetzt', 'ok');
      bubble('system', simliReady ? 'Simli aktiv. Stimme läuft.' : 'Stimme läuft.');

      const greetings = [
        'Begrüße Simon kurz: Moin Simon. Ich bin wach. Mehr kann man technisch kaum verlangen.',
        'Begrüße Simon kurz: Hi Simon. System läuft, Laune stabil, Rest verhandeln wir.',
        'Begrüße Simon kurz: Simon, da bist du ja. Ich habe schon mal so getan, als wäre ich produktiv.'
      ];

      const greeting = greetings[Math.floor(Math.random() * greetings.length)];
      setTimeout(() => {
        try {
          dc.send(JSON.stringify({ type: 'response.create', response: { instructions: greeting } }));
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
  stopAssistantAudioBridge();
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
    try {
      feedSimliPcm16(resamplePcm16(base64ToInt16Array(msg.delta), 24000, 16000));
    } catch (_) {}
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
